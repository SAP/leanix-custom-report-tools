import * as oauth from 'oauth4webapi';
import type { Credentials } from './models/leanix-credentials';
import {
  clearCredentials,
  readCredentials,
  saveCredentials
} from './credentials';
import { refreshAccessToken, runOAuthFlow } from './oauth';

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
  const credentials = await runOAuthFlow(proxyURL);
  const path = saveCredentials(credentials);
  return { credentials, path };
}

export async function logout(): Promise<{ path: string } | null> {
  const entry = readCredentials();
  if (!entry) return null;
  clearCredentials();
  return { path: entry.path };
}

export async function exchangeApiToken(
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

async function ensureFreshCredentials(
  creds: Credentials
): Promise<Credentials | null> {
  // API token: stateless, always valid — no refresh needed
  if (creds.apitoken) return creds;

  // OAuth: check expiry and refresh if needed
  const { oauth } = creds;
  if (!oauth || !creds.host) return null;

  const isExpired = Date.now() >= oauth.expires_at - EXP_BUFFER_SECONDS * 1000;
  if (!isExpired) return creds;

  console.log('Access token expired, refreshing...');
  const refreshed = await refreshAccessToken(creds);
  return refreshed?.oauth && refreshed.host ? refreshed : null;
}

async function resolveBearerToken(
  creds: Credentials
): Promise<{ bearerToken: string; expiresAt?: number }> {
  // API token: exchange the stored API key for a short-lived bearer token
  if (creds.apitoken) {
    if (!creds.host) throw new Error('API token is set but host is missing');
    return { bearerToken: await exchangeApiToken(creds.host, creds.apitoken) };
  }

  // OAuth: access token is already in credentials
  return {
    bearerToken: creds.oauth!.access_token,
    expiresAt: creds.oauth!.expires_at
  };
}

export async function resolveAccessToken(): Promise<ResolvedAuth> {
  const entry = readCredentials();
  const proxyURL = entry?.credentials.proxyURL;

  const isLoggedIn =
    entry && (entry.credentials.apitoken || entry.credentials.oauth);

  if (isLoggedIn) {
    const { credentials } = entry;
    const fresh = await ensureFreshCredentials(credentials);

    if (fresh) {
      saveCredentials(fresh);
      const { bearerToken, expiresAt } = await resolveBearerToken(fresh);
      return { bearerToken, host: fresh.host!, expiresAt, proxyURL };
    }

    console.log('Session expired, re-authenticating.');
  } else {
    console.log('No credentials found.');
  }

  console.log('Opening browser to log in to LeanIX...');
  const newCreds = await runOAuthFlow(proxyURL);
  saveCredentials({ ...newCreds, proxyURL });
  return {
    bearerToken: newCreds.oauth!.access_token,
    host: newCreds.host!,
    proxyURL,
    expiresAt: newCreds.oauth!.expires_at
  };
}
