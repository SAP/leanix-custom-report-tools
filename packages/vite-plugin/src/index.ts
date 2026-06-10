import type { CustomReportMetadata } from '@lxr/core/models/custom-report-metadata';
import type { JwtClaims } from '@lxr/core/models/jwt-claims';
import type { ResolvedAuth } from '@lxr/core/auth';
import type { AddressInfo } from 'node:net';
import type { Logger, Plugin, ResolvedConfig } from 'vite';
import { openAsBlob } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import {
  createBundle,
  decodeBearerToken,
  getLaunchUrl,
  npmPackBundle,
  pollReportState,
  readMetadataJson,
  ReportStateError,
  uploadBundle,
  uploadReportV2,
  writeReportMetadata
} from '@lxr/core/index';
import { resolveAccessToken } from '@lxr/core/auth';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { ZodError } from 'zod';
import { checkPackageVersions } from './helpers/check-packages';
import { resolveHostname } from './helpers/resolve-hostname';

export default function leanixPlugin(): Plugin[] {
  let logger: Logger;
  let resolvedAuth: ResolvedAuth | null = null;
  let claims: JwtClaims | null = null;
  let shouldUpload: boolean = false;
  let requiresServerConnection: boolean = false;
  let viteDevServerUrl: string;
  let launchUrl: string;
  let relayServer: ReturnType<typeof createHttpServer> | null = null;
  let metadata!: CustomReportMetadata;
  let projectRoot: string = '';

  const lxrPlugin: Plugin = {
    name: 'vite-plugin-leanix-custom-report',
    enforce: 'post',
    apply: undefined,

    async config(config, env) {
      shouldUpload = env.mode === 'upload';
      requiresServerConnection = env.command === 'serve' || shouldUpload;
      if (requiresServerConnection) {
        config.base = '';
        config.server = { ...(config.server ?? {}), host: true, cors: true };
      }
    },

    async configResolved(resolvedConfig: ResolvedConfig) {
      logger = resolvedConfig.logger;
      projectRoot = resolvedConfig.root;

      try {
        metadata = readMetadataJson(join(resolvedConfig.root, 'package.json'));
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          logger.error(`💥 Could not find metadata file at "${err.path}"`);
        } else if (err instanceof ZodError) {
          logger.error(
            `💥 Found ${err.issues.length} errors while validating metadata`
          );
          for (const issue of err.issues) {
            if (issue.code === 'invalid_type') {
              const { code, expected, path, message } = issue;
              logger.error(
                ` ${message} ${path} - ${code}, expected ${expected}`
              );
            } else {
              const { code, path, message } = issue;
              logger.error(` ${message} ${path} - ${code}`);
            }
          }
        } else {
          logger.error(`💥 Unknown error`, err);
        }
        process.exit(1);
      }

      if (requiresServerConnection) {
        await checkPackageVersions(projectRoot, logger);
        try {
          resolvedAuth = await resolveAccessToken();
          if (resolvedAuth.proxyURL) {
            logger?.info(`  Using proxy: ${resolvedAuth.proxyURL}`);
          }
          claims = decodeBearerToken(resolvedAuth.bearerToken);
          if (claims !== null) {
            logger?.info(
              `  Using workspace: ${claims.principal.permission.workspaceName}`
            );
          }
        } catch (err) {
          logger?.error(
            err === 401 ? '💥 Invalid SAP LeanIX API token' : `${err}`
          );
          process.exit(1);
        }
      }
    },

    configureServer(viteDevServer) {
      const { httpServer, config } = viteDevServer;

      if (httpServer === null) {
        return;
      }

      const targetHost = resolvedAuth?.host ?? '';
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
          const { name: hostname } = resolveHostname(config.server.host);
          const port = (httpServer.address() as AddressInfo).port;
          viteDevServerUrl = `http://${hostname}:${port}`;

          const relayPort = (relayServer!.address() as AddressInfo).port;
          const relayUrl = `http://${hostname}:${relayPort}`;

          launchUrl = getLaunchUrl(
            viteDevServerUrl,
            resolvedAuth!.bearerToken,
            relayUrl,
            metadata?.title
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
      // Guard: output.file mode is not supported (custom reports always use output.dir)
      if (options.dir === undefined) {
        logger?.error('💥 No output directory configured.');
        process.exit(1);
      }

      if (!shouldUpload) {
        writeReportMetadata(metadata, options.dir);
        return;
      }

      const bearerToken = resolvedAuth!.bearerToken;
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
            host: resolvedAuth!.host,
            bearerToken,
            bundle
          });
          logger?.info(`  customReportVersionId: ${customReportVersionId}`);
          await pollReportState({
            host: resolvedAuth!.host,
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
              const tail =
                lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines;
              logger?.error('📜 Build log:');
              if (lines.length > MAX_LINES) {
                logger?.error(
                  `  … (showing last ${MAX_LINES} of ${lines.length} lines)`
                );
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
          logger.info(
            `😅 Uploading report ${id} with version "${version}" to workspace "${claims.principal.permission.workspaceName}"...`
          );
        }
        const result = await uploadBundle({
          bundle,
          bearerToken
        });
        if (result.status === 'ERROR') {
          logger?.error(
            '💥 Error while uploading project to workpace, check your "package.json" file...'
          );
          logger?.error(JSON.stringify(result, null, 2));
          process.exit(1);
        }
        if (claims !== null) {
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
