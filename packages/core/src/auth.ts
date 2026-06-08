import type { Credentials } from './models/leanix-credentials';
import { readCredentials, saveCredentials } from './credentials';
import { refreshAccessToken, runOAuthFlow } from './oauth';

export type ResolvedAuth = {
  bearerToken: string;
  host: string;
  proxyURL?: string;
  expiresAt?: number;
};

// Treat tokens as expired this many seconds before they actually expire, to avoid using a token that expires mid-request.
export const EXP_BUFFER_SECONDS = 300;

async function exchangeApiToken(
  host: string,
  apitoken: string
): Promise<string> {
  const uri = `https://${host}/services/mtm/v1/oauth2/token?grant_type=client_credentials`;
  const res = await fetch(uri, {
    method: 'post',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`apitoken:${apitoken}`).toString('base64')}`
    }
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
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
  const newCreds = await runOAuthFlow(undefined, proxyURL);
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
