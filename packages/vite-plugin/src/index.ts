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
  readLxrJson,
  readMetadataJson,
  uploadBundle
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
  let accessToken: AccessToken | null = null;
  let claims: JwtClaims | null = null;
  let shouldUpload: boolean = false;
  let loadWorkspaceCredentials: boolean = false;
  let credentials: LeanIXCredentials = { host: '', apitoken: '' };
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

      const targetHost = credentials.host;
      const targetOrigin = `https://${targetHost}`;

      // Start HTTP relay server with proxy middleware
      relayServer = createHttpServer(
        createProxyMiddleware({
          target: targetOrigin,
          changeOrigin: true,
          secure: true,
          agent: credentials.proxyURL
            ? new HttpsProxyAgent(credentials.proxyURL)
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

      relayServer.listen(undefined, () => {
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

    async writeBundle(options, _outputBundle) {
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
      let bundle: Blob;
      if (metadata !== undefined && options?.dir !== undefined) {
        const bundlePath = await createBundle(metadata, options?.dir);
        bundle = await openAsBlob(bundlePath);
      } else {
        logger?.error('💥 Error while create project bundle file.');
        process.exit(1);
      }
      if (
        bundle !== undefined &&
        accessToken?.accessToken !== undefined &&
        shouldUpload
      ) {
        try {
          const { accessToken: bearerToken } = accessToken;
          const { proxyURL, store } = credentials;
          const { id, version } = metadata;
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
            proxyURL,
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
    }
  };
  return [lxrPlugin];
}
