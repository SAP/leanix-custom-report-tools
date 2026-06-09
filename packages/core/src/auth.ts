import * as oauth from 'oauth4webapi';
import type { Credentials } from './models/leanix-credentials';
import {
  clearCredentials,
  readCredentials,
  saveCredentials
} from './credentials';
import { getUserLxrJsonPath, OAUTH_BASE_URL } from './constants';
import {
  deregisterOAuthClient,
  refreshAccessToken,
  runOAuthFlow
} from './oauth';

export type ResolvedAuth = {
  bearerToken: string;
  host: string;
  proxyURL?: string;
  expiresAt?: number;
};

// Treat tokens as expired this many seconds before they actually expire, to avoid using a token that expires mid-request.
export const EXP_BUFFER_SECONDS = 300;

export async function login(
  proxyURL?: string
): Promise<{ credentials: Credentials; path: string }> {
  const entry = readCredentials();
  if (entry) clearCredentials(entry.path);
  const credentials = await runOAuthFlow(
    undefined,
    proxyURL,
    entry?.credentials.oauth
  );
  const path = entry?.path ?? getUserLxrJsonPath();
  saveCredentials(credentials, path);
  return { credentials, path };
}

export async function logout(): Promise<{ path: string } | null> {
  const entry = readCredentials();
  if (!entry) return null;
  const { client_id, registration_access_token, issuer } =
    entry.credentials.oauth ?? {};
  if (client_id && registration_access_token) {
    try {
      await deregisterOAuthClient(
        issuer ?? OAUTH_BASE_URL,
        client_id,
        registration_access_token
      );
    } catch (err: unknown) {
      console.warn(
        `Warning: could not deregister OAuth client: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  clearCredentials(entry.path);
  return { path: entry.path };
}

async function exchangeApiToken(
  host: string,
  apitoken: string
): Promise<string> {
  const as: oauth.AuthorizationServer = {
    issuer: `https://${host}`,
    token_endpoint: `https://${host}/services/mtm/v1/oauth2/token`
  };
  const client: oauth.Client = { client_id: 'apitoken' };
  const res = await oauth.clientCredentialsGrantRequest(
    as,
    client,
    oauth.ClientSecretBasic(apitoken),
    new URLSearchParams()
  );
  const tokens = await oauth.processClientCredentialsResponse(as, client, res);
  return tokens.access_token;
}

async function tryResolve(
  creds: Credentials,
  onRefresh?: (refreshed: Credentials) => void
): Promise<{ bearerToken: string; host: string; expiresAt?: number } | null> {
  if (creds.apitoken && creds.host) {
    const bearerToken = await exchangeApiToken(creds.host, creds.apitoken);
    return { bearerToken, host: creds.host };
  }

  const { oauth } = creds;
  if (!oauth || !creds.host) return null;

  const isExpired = Date.now() >= oauth.expires_at - EXP_BUFFER_SECONDS * 1000;
  if (!isExpired) {
    return {
      bearerToken: oauth.access_token,
      host: creds.host,
      expiresAt: oauth.expires_at
    };
  }

  console.log('Access token expired, refreshing...');
  const refreshed = await refreshAccessToken(creds);
  if (refreshed?.oauth && refreshed.host) {
    onRefresh?.(refreshed);
    return {
      bearerToken: refreshed.oauth.access_token,
      host: refreshed.host,
      expiresAt: refreshed.oauth.expires_at
    };
  }

  return null;
}

export async function resolveAccessToken(): Promise<ResolvedAuth> {
  const entry = readCredentials();
  const proxyURL = entry?.credentials.proxyURL;

  if (entry) {
    const result = await tryResolve(entry.credentials, (refreshed) =>
      saveCredentials(refreshed, entry.path)
    );
    if (result) return { ...result, proxyURL };
    console.log('Session expired, re-authenticating...');
  }

  console.log('No credentials found. Opening browser to log in to LeanIX...');
  const newCreds = await runOAuthFlow(
    undefined,
    proxyURL,
    entry?.credentials.oauth
  );
  if (entry) {
    saveCredentials({ ...entry.credentials, ...newCreds }, entry.path);
  } else {
    saveCredentials(newCreds);
  }
  return {
    bearerToken: newCreds.oauth!.access_token,
    host: newCreds.host!,
    proxyURL,
    expiresAt: newCreds.oauth!.expires_at
  };
}
