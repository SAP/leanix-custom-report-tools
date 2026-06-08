import type { AccessToken } from '@lxr/core/models/access-token';
import type { CustomReportMetadata } from '@lxr/core/models/custom-report-metadata';
import type { JwtClaims } from '@lxr/core/models/jwt-claims';
import type { LeanIXCredentials } from '@lxr/core/models/leanix-credentials';
import type { AddressInfo } from 'node:net';
import type { Logger, Plugin, ResolvedConfig } from 'vite';
import { openAsBlob } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import {
  createBundle,
  getAccessToken,
  getAccessTokenClaims,
  getLaunchUrl,
  npmPackBundle,
  pollReportState,
  readLxrJson,
  readMetadataJson,
  ReportStateError,
  uploadBundle,
  uploadReportV2,
  writeReportMetadata
} from '@lxr/core/index';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { ZodError } from 'zod';
import { resolveHostname } from './helpers';

export interface LeanIXPluginOptions {
  packageJsonPath?: string;
}

export default function leanixPlugin(
  pluginOptions?: LeanIXPluginOptions
): Plugin[] {
  let logger: Logger;
  let accessToken: AccessToken | null = null;
  let claims: JwtClaims | null = null;
  let shouldUpload: boolean = false;
  let loadWorkspaceCredentials: boolean = false;
  let credentials: LeanIXCredentials = { host: '', apitoken: '' };
  let viteDevServerUrl: string;
  let launchUrl: string;
  let relayServer: ReturnType<typeof createHttpServer> | null = null;
  let devMetadata: CustomReportMetadata | null = null;
  let projectRoot: string = '';

  const lxrPlugin: Plugin = {
    name: 'vite-plugin-leanix-custom-report',
    enforce: 'post',
    apply: undefined,

    async config(config, env) {
      shouldUpload = env.mode === 'upload';
      loadWorkspaceCredentials = env.command === 'serve' || shouldUpload;
      if (loadWorkspaceCredentials) {
        config.base = '';
        config.server = { ...(config.server ?? {}), host: true, cors: true };
        try {
          credentials = await readLxrJson();
        } catch (error) {
          logger = logger ?? console;
          const code = (error as { code: string })?.code ?? null;
          if (code === 'ENOENT') {
            logger.error(
              '💥 Error: "lxr.json" file not found in your project root'
            );
          } else {
            logger?.error(error as string);
          }

          process.exit(1);
        }
      }
    },

    async configResolved(resolvedConfig: ResolvedConfig) {
      logger = resolvedConfig.logger;
      projectRoot = resolvedConfig.root;
      devMetadata = await readMetadataJson(
        join(resolvedConfig.root, 'package.json')
      ).catch(() => null);
      if (loadWorkspaceCredentials) {
        try {
          if (
            typeof credentials.proxyURL === 'string' &&
            credentials.proxyURL.length > 0
          ) {
            logger?.info(`  Using proxy: ${credentials.proxyURL}`);
          }
          accessToken = await getAccessToken(credentials);
          claims = getAccessTokenClaims(accessToken);
          if (claims !== null) {
            logger?.info(
              `  Using workspace: ${claims.principal.permission.workspaceName}`
            );
          }
        } catch (err) {
          logger?.error(err === 401 ? '💥 Invalid SAP LeanIX API token' : `${err}`);
          process.exit(1);
        }
      }
    },

    configureServer(viteDevServer) {
      const { httpServer, config } = viteDevServer;

      if (httpServer === null) {
        return;
      }

      const targetHost = credentials.host;
      const targetOrigin = `https://${targetHost}`;
      const workspaceName = claims?.principal.permission.workspaceName ?? '';

      // Start HTTP relay server with proxy middleware
      // The relay proxies requests from localhost to the LeanIX backend, enabling local development
      // of custom reports within the pathfinder-web shell.
      // The launch URL includes the workspace name in the path (e.g., localhost/{workspaceName}/reporting/dev)
      // so that the remote nginx correctly sets <base href="/{workspaceName}/">.
      // For requests without workspace prefix (e.g., /reporting/...), we prepend the workspace name.
      relayServer = createHttpServer(
        createProxyMiddleware({
          target: targetOrigin,
          changeOrigin: true,
          secure: true,
          on: {
            proxyReq: (proxyReq, req) => {
              // Rewrite Origin header: localhost -> LeanIX host
              proxyReq.setHeader('Origin', targetOrigin);

              // Rewrite Referer header: replace localhost prefix with LeanIX host
              const referer = req.headers.referer;
              if (referer) {
                const refererUrl = new URL(referer);
                const newReferer = `${targetOrigin}${refererUrl.pathname}${refererUrl.search}`;
                proxyReq.setHeader('Referer', newReferer);
              }

              // Pathfinder-web on localhost unfortunately sometimes generates URLs without the workspace prefix
              // So we prepend the workspace name to paths that need it
              // Root-level paths like /frontends/, /services/, /favicon, etc. should pass through unchanged
              const originalPath = proxyReq.path;
              const rootPaths = [
                '/frontends/',
                '/services/',
                '/favicon.ico',
                '/lx-frontend-meta.json',
                '/Shibboleth.sso/'
              ];
              const isRootPath = rootPaths.some((p) =>
                originalPath.startsWith(p)
              );
              const hasWorkspacePrefix = originalPath.startsWith(
                `/${workspaceName}/`
              );
              if (!isRootPath && !hasWorkspacePrefix && req.method === 'GET') {
                proxyReq.path = `/${workspaceName}${originalPath}`;
              }
            },
            proxyRes: (proxyRes, req) => {
              // Rewrite CORS headers to allow localhost origin
              const requestOrigin = req.headers.origin;
              if (requestOrigin) {
                proxyRes.headers['access-control-allow-origin'] = requestOrigin;
                proxyRes.headers['access-control-allow-credentials'] = 'true';
              }
            }
          }
        })
      );

      // Port 4200 is explicitly listed in backend services' corsAllowlist, which is required so that
      // pathfinder-web can call them directly (absolute URLs bypass the relay proxy).
      relayServer.listen(4200, () => {
        httpServer.once('listening', () => {
          if (accessToken === null) {
            throw new Error('Missing AccessToken');
          }

          const { name: hostname } = resolveHostname(config.server.host);
          const port = (httpServer.address() as AddressInfo).port;
          viteDevServerUrl = `http://${hostname}:${port}`;

          const relayPort = (relayServer!.address() as AddressInfo).port;
          const relayUrl = `http://${hostname}:${relayPort}`;

          launchUrl = getLaunchUrl(
            viteDevServerUrl,
            accessToken.accessToken,
            relayUrl,
            devMetadata?.title
          );

          // Override Vite's resolved URLs BEFORE they are printed
          viteDevServer.resolvedUrls = {
            local: [launchUrl],
            network: []
          };
          viteDevServer.printUrls = () => {
            logger.info(
              `  Your SAP LeanIX Custom Report is running at:\n  ${launchUrl}\n`
            );
          };
        });
      });
    },

    closeWatcher() {
      if (relayServer) {
        relayServer.close();
        relayServer = null;
      }
    },

    // Rollup hook: called after all files have been written to disk.
    // On a normal build we only write lxreport.json metadata alongside the output.
    // On upload mode we also package and ship the bundle to the workspace.
    async writeBundle(options, _outputBundle) {
      // Read and validate metadata from package.json
      let metadata: CustomReportMetadata | undefined;
      try {
        metadata = await readMetadataJson(pluginOptions?.packageJsonPath);
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          const path: string = err.path;
          logger?.error(`💥 Could not find metadata file at "${path}"`);
          logger?.warn('🙋 Have you initialized this project?"');
        } else if (err instanceof ZodError) {
          const issues = err.issues;
          logger.error(
            `\n💥 Found ${issues.length} errors while validating metadata`
          );
          let i = 0;
          for (const issue of issues) {
            i++;
            if (issue.code === 'invalid_type') {
              const { code, expected, path, message } = issue;
              logger?.error(
                `💥 #${i} ${message} ${path} - ${code}, expected ${expected}`
              );
            } else {
              const { code, path, message } = issue;
              logger?.error(`💥 #${i} ${message} ${path} - ${code}`);
            }
          }
        } else {
          logger.error(`💥 Unknown error`, err);
        }
        process.exit(1);
      }

      // Guard: output.file mode is not supported (custom reports always use output.dir)
      if (options.dir === undefined) {
        logger?.error('💥 No output directory configured.');
        process.exit(1);
      }

      if (!shouldUpload) {
        writeReportMetadata(metadata, options.dir);
        return;
      }

      const { accessToken: bearerToken } = accessToken!;
      const { store } = credentials;
      const { name, version } = metadata;

      // v2 upload (Reports Service): opt-in via leanixReport.uploadVersion = 2 in package.json
      if (metadata.uploadVersion === 2) {
        logger?.warn('⚠️  Using EXPERIMENTAL v2 upload (Reports Service).');
        if (claims === null) {
          throw new Error('Cannot upload: missing access token claims.');
        }
        const { workspaceName } = claims.principal.permission;
        try {
          const tarball = await npmPackBundle(projectRoot);
          const bundle = await openAsBlob(tarball);
          logger?.info(
            `Uploading "${name}" v${version} to workspace "${workspaceName}" via Reports Service...`
          );
          const { customReportVersionId } = await uploadReportV2({
            host: credentials.host,
            bearerToken,
            bundle
          });
          logger?.info(`  customReportVersionId: ${customReportVersionId}`);
          await pollReportState({
            host: credentials.host,
            customReportVersionId,
            bearerToken,
            onUpdate: (state) => logger?.info(`  state: ${state}`)
          });
          logger?.info('🚀 Upload complete.');
        } catch (err: any) {
          logger?.error('💥 Error during upload to Reports Service...');
          if (err instanceof ReportStateError) {
            if (err.status === 'VULNERABLE' && err.securityScan !== null) {
              logger?.error('🛡  Scan result:');
              logger?.error(JSON.stringify(err.securityScan, null, 2));
            } else if (err.buildLog) {
              const lines = err.buildLog.split('\n');
              const MAX_LINES = 50;
              const tail = lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines;
              logger?.error('📜 Build log:');
              if (lines.length > MAX_LINES) {
                logger?.error(`  … (showing last ${MAX_LINES} of ${lines.length} lines)`);
              }
              for (const line of tail) {
                logger?.error(`  ${line}`);
              }
            }
          }
          logger?.error(`💣 ${err}`);
          process.exit(1);
        }
        return;
      }

      // Write lxreport.json to dist/ (legacy v1 upload only)
      writeReportMetadata(metadata, options.dir);

      const { id } = metadata;
      // Upload mode: package the dist and upload to the workspace
      const bundlePath = await createBundle(options.dir);
      const bundle = await openAsBlob(bundlePath);
      try {
        if (claims !== null) {
          if (typeof store?.assetId === 'string') {
            logger.info(
              `😅 Deploying asset id ${store.assetId} to ${store.host ?? 'store.leanix.net'}...`
            );
          } else {
            logger.info(
              `😅 Uploading report ${id} with version "${version}" to workspace "${claims.principal.permission.workspaceName}"...`
            );
          }
        }
        const result = await uploadBundle({
          bundle,
          bearerToken,
          store
        });
        if (result.status === 'ERROR') {
          logger?.error(
            '💥 Error while uploading project to workpace, check your "package.json" file...'
          );
          logger?.error(JSON.stringify(result, null, 2));
          process.exit(1);
        }
        if (typeof store?.assetId === 'string') {
          logger.info(
            `😅 Asset id ${store.assetId} has been deployed to ${store.host ?? 'store.leanix.net'}...`
          );
        } else if (claims !== null) {
          logger?.info(
            `🥳 Report "${id}" with version "${version}" was uploaded to workspace "${claims.principal.permission.workspaceName}"!`
          );
        }
      } catch (err: any) {
        logger?.error('💥 Error while uploading project to workpace...');
        logger?.error(`💣 ${err}`);
        process.exit(1);
      }
    }
  };
  return [lxrPlugin];
}
