import type { ConnectionConfig } from './models/connection-config';
import {
  clearConnectionConfig,
  readConnectionConfig,
  saveConnectionConfig,
  ConnectionConfigFile
} from './connection-config';
import { getUserLxrJsonPath } from './constants';
import { refreshAccessToken, runOAuthFlow } from './oauth';

export type ResolvedAuth = {
  bearerToken: string;
  host: string;
  proxyURL?: string;
  expiresAt?: number;
};

// Treat tokens as expired this many seconds before they actually expire, to avoid using a token that expires mid-request.
const EXP_BUFFER_SECONDS = 300;

export async function login(proxyURL?: string): Promise<ConnectionConfigFile> {
  const config = await runOAuthFlow(proxyURL);
  const path = saveConnectionConfig(config, getUserLxrJsonPath());
  return { config, path };
}

export async function logout(): Promise<{ path: string } | null> {
  const file = readConnectionConfig();
  if (!file) return null;
  clearConnectionConfig(file.config, file.path);
  return { path: file.path };
}

export async function exchangeApiToken(
  host: string,
  apitoken: string
): Promise<string> {
  // LeanIX MTM requires grant_type as a query parameter, not in the request body.
  const url = `https://${host}/services/mtm/v1/oauth2/token?grant_type=client_credentials`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`apitoken:${apitoken}`).toString('base64')}`
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status));
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

async function refreshTokenIfExpired(
  config: ConnectionConfig
): Promise<ConnectionConfig | null> {
  // API token: stateless, always valid — no refresh needed
  if (config.apitoken) return config;

  // OAuth: check expiry and refresh if needed
  const { oauth } = config;
  if (!oauth || !config.host) return null;

  const isExpired = Date.now() >= oauth.expires_at - EXP_BUFFER_SECONDS * 1000;
  if (!isExpired) return config;

  const refreshed = await refreshAccessToken(config);
  return refreshed?.oauth && refreshed.host ? refreshed : null;
}

async function resolveBearerToken(
  config: ConnectionConfig
): Promise<{ bearerToken: string; expiresAt?: number }> {
  // API token: exchange the stored API key for a short-lived bearer token
  if (config.apitoken) {
    if (!config.host) throw new Error('API token is set but host is missing');
    return {
      bearerToken: await exchangeApiToken(config.host, config.apitoken)
    };
  }

  // OAuth: access token is already in the workspace config
  return {
    bearerToken: config.oauth!.access_token,
    expiresAt: config.oauth!.expires_at
  };
}

/**
 * Authenticates against SAP LeanIX and returns a valid bearer token.
 *
 * Auth-method agnostic: works with both API token and OAuth credentials.
 *
 * @param connectionConfigFile - Optional pre-read config file to use instead of reading from disk.
 * @returns Resolved authentication.
 */
export async function authenticate(
  connectionConfigFile?: ConnectionConfigFile | null
): Promise<ResolvedAuth> {
  // 1. Resolve config — use provided file or fall back to reading from disk
  const file = connectionConfigFile ?? readConnectionConfig();
  const proxyURL = file?.config.proxyURL;

  // 2. If credentials exist, try to use them (refreshing if expired)
  const isLoggedIn = file && (file.config.apitoken || file.config.oauth);

  if (isLoggedIn) {
    const { config } = file;
    const freshConfig = await refreshTokenIfExpired(config);

    if (freshConfig) {
      saveConnectionConfig(freshConfig, file.path);
      const { bearerToken, expiresAt } = await resolveBearerToken(freshConfig);
      return { bearerToken, host: freshConfig.host!, expiresAt, proxyURL };
    }
  }

  // 3. No valid credentials — open browser OAuth flow
  console.warn('  Opening browser to log in to LeanIX...');
  const newConfig = await runOAuthFlow(proxyURL);
  saveConnectionConfig(newConfig, file?.path ?? getUserLxrJsonPath());
  return {
    bearerToken: newConfig.oauth!.access_token,
    host: newConfig.host!,
    proxyURL,
    expiresAt: newConfig.oauth!.expires_at
  };
}
