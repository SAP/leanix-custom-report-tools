import type { Credentials } from './models/leanix-credentials';
import type { RequestInit } from 'node-fetch';
import fetch from 'node-fetch';
import { deleteUserCredentials, readUserCredentials, writeUserCredentials } from './credentials';
import { refreshAccessToken, runOAuthFlow } from './oauth';

export type ResolvedAuth = {
  bearerToken: string;
  host: string;
  proxyURL?: string;
};

const EXP_BUFFER_SECONDS = 300;

async function exchangeApiToken(host: string, apitoken: string, proxyURL?: string): Promise<string> {
  const uri = `https://${host}/services/mtm/v1/oauth2/token?grant_type=client_credentials`;
  const options: RequestInit = {
    method: 'post',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`apitoken:${apitoken}`).toString('base64')}`
    }
  };
  if (proxyURL) {
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    options.agent = new HttpsProxyAgent(new URL(proxyURL));
  }
  const res = await fetch(uri, options);
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

async function tryResolve(
  creds: Credentials,
  effectiveProxy?: string,
  onRefresh?: (refreshed: Credentials) => void
): Promise<{ bearerToken: string; host: string } | null> {
  if (creds.apitoken && creds.host) {
    const bearerToken = await exchangeApiToken(creds.host, creds.apitoken, effectiveProxy);
    return { bearerToken, host: creds.host };
  }

  const { oauth } = creds;
  if (!oauth || !creds.host) return null;

  const isExpired = Date.now() >= oauth.expires_at - EXP_BUFFER_SECONDS * 1000;
  if (!isExpired) {
    return { bearerToken: oauth.access_token, host: creds.host };
  }

  console.log('[lxr] Access token expired, refreshing...');
  const refreshed = await refreshAccessToken(creds, effectiveProxy);
  if (refreshed?.oauth && refreshed.host) {
    onRefresh?.(refreshed);
    return { bearerToken: refreshed.oauth.access_token, host: refreshed.host };
  }

  return null;
}

export async function resolveAccessToken(
  lxrJson?: Credentials,
  proxyURL?: string
): Promise<ResolvedAuth> {
  const userCreds = readUserCredentials();
  const effectiveProxy =
    proxyURL ??
    lxrJson?.proxyURL ??
    process.env.HTTPS_PROXY ??
    process.env.HTTP_PROXY ??
    userCreds?.proxyURL;

  // 1. Project-level credentials (lxr.json)
  if (lxrJson) {
    const result = await tryResolve(lxrJson, effectiveProxy);
    if (result) {
      return { ...result, proxyURL: effectiveProxy };
    }
  }

  // 2. User credentials (~/.leanix/credentials)
  if (userCreds) {
    const result = await tryResolve(userCreds, effectiveProxy, (refreshed) => {
      writeUserCredentials(refreshed);
    });
    if (result) {
      const host = lxrJson?.host ?? result.host;
      return { bearerToken: result.bearerToken, host, proxyURL: effectiveProxy };
    }
    console.log('[lxr] Session expired, re-authenticating...');
    deleteUserCredentials();
  }

  // 3. Full OAuth flow via gateway
  console.log('No credentials found. Opening browser to log in to LeanIX...');
  const newCreds = await runOAuthFlow(undefined, effectiveProxy);
  const host = lxrJson?.host ?? newCreds.host!;
  return { bearerToken: newCreds.oauth!.access_token, host, proxyURL: effectiveProxy };
}
