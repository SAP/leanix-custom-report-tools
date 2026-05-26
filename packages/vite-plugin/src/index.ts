import type { CustomReportMetadata } from '@lxr/core/models/custom-report-metadata';
import type { JwtClaims } from '@lxr/core/models/jwt-claims';
import type { Credentials } from '@lxr/core/models/leanix-credentials';
import type { ResolvedAuth } from '@lxr/core/index';
import type { AddressInfo } from 'node:net';
import type { Logger, Plugin, ResolvedConfig } from 'vite';
import { openAsBlob } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import {
  createBundle,
  decodeBearerToken,
  getLaunchUrl,
  readLxrJson,
  readMetadataJson,
  resolveAccessToken,
  uploadBundle,
  writeReportMetadata
} from '@lxr/core/index';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ZodError } from 'zod';
import { resolveHostname } from './helpers';

export interface LeanIXPluginOptions {
  packageJsonPath?: string;
}

export default function leanixPlugin(
  pluginOptions?: LeanIXPluginOptions
): Plugin[] {
  let logger: Logger;
  let resolvedAuth: ResolvedAuth | null = null;
  let claims: JwtClaims | null = null;
  let shouldUpload: boolean = false;
  let loadWorkspaceCredentials: boolean = false;
  let lxrJson: Credentials | null = null;
  let viteDevServerUrl: string;
  let launchUrl: string;
  let relayServer: ReturnType<typeof createHttpServer> | null = null;
  let devMetadata: CustomReportMetadata | null = null;

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
          lxrJson = await readLxrJson();
        } catch (error) {
          const code = (error as { code: string })?.code ?? null;
          if (code !== 'ENOENT') {
            logger = logger ?? console;
            logger.error(error as string);
            process.exit(1);
          }
          lxrJson = null;
        }
      }
    },

    async configResolved(resolvedConfig: ResolvedConfig) {
      logger = resolvedConfig.logger;
      devMetadata = await readMetadataJson(
        join(resolvedConfig.root, 'package.json')
      ).catch(() => null);
      if (loadWorkspaceCredentials) {
        try {
          resolvedAuth = await resolveAccessToken(lxrJson ?? undefined);
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
          logger?.error(err === 401 ? '💥 Invalid LeanIX API token' : `${err}`);
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
          agent: resolvedAuth?.proxyURL
            ? new HttpsProxyAgent(resolvedAuth.proxyURL)
            : undefined,
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
              const rootPaths = ['/frontends/', '/services/', '/favicon.ico', '/lx-frontend-meta.json', '/Shibboleth.sso/'];
              const isRootPath = rootPaths.some(p => originalPath.startsWith(p));
              const hasWorkspacePrefix = originalPath.startsWith(`/${workspaceName}/`);
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
          if (resolvedAuth === null) {
            throw new Error('Missing resolved auth');
          }

          const { name: hostname } = resolveHostname(config.server.host);
          const port = (httpServer.address() as AddressInfo).port;
          viteDevServerUrl = `http://${hostname}:${port}`;

          const relayPort = (relayServer!.address() as AddressInfo).port;
          const relayUrl = `http://${hostname}:${relayPort}`;

          launchUrl = getLaunchUrl(
            viteDevServerUrl,
            resolvedAuth.bearerToken,
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
              `  Your LeanIX Custom Report is running at:\n  ${launchUrl}\n`
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

      // Write lxreport.json to dist/
      writeReportMetadata(metadata, options.dir);
      if (!shouldUpload) {
        return;
      }

      // Upload mode: package the dist and upload to the workspace
      const bundlePath = await createBundle(options.dir);
      const bundle = await openAsBlob(bundlePath);
      try {
        const bearerToken = resolvedAuth!.bearerToken;
        const proxyURL = resolvedAuth?.proxyURL;
        const { id, version } = metadata;
        if (claims !== null) {
          logger.info(
            `😅 Uploading report ${id} with version "${version}" to workspace "${claims.principal.permission.workspaceName}"...`
          );
        }
        const result = await uploadBundle({
          bundle,
          bearerToken,
          proxyURL
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
