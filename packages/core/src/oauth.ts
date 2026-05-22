import type { Credentials } from './models/leanix-credentials';
import type { RequestInit } from 'node-fetch';
import { createHash, randomBytes } from 'node:crypto';
import open from 'open';
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { jwtDecode } from 'jwt-decode';
import fetch from 'node-fetch';
import type { JwtClaims } from '@lxr/core/models/jwt-claims';
import { readUserCredentials, writeUserCredentials } from './credentials';

const OAUTH_BASE_URL = 'https://mcp.leanix.net/services/mcp-server/v1/oauth';

function createProxyAgent(proxyURL: string): HttpsProxyAgent<string> {
  return new HttpsProxyAgent(new URL(proxyURL));
}

export function getHostFromAccessToken(accessToken: string): string {
  const claims: JwtClaims = jwtDecode(accessToken);
  return new URL(claims.instanceUrl).hostname;
}

export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function deriveCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function startCallbackServer(): {
  port: number;
  waitForCode: () => Promise<{ code: string; state: string }>;
} {
  let resolveCode!: (v: { code: string; state: string }) => void;
  let rejectCode!: (e: Error) => void;
  const codePromise = new Promise<{ code: string; state: string }>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (code && state) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h2>Login successful! You can close this tab.</h2></body></html>');
      resolveCode({ code, state });
    } else {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing code or state');
      rejectCode(new Error('OAuth callback missing code or state'));
    }
    server.close();
  });

  server.listen(0);
  const port = (server.address() as { port: number }).port;
  return { port, waitForCode: () => codePromise };
}

export async function openBrowser(url: string): Promise<boolean> {
  try {
    await open(url);
    return true;
  } catch {
    return false;
  }
}

export async function registerOAuthClient(
  oauthBaseUrl: string,
  redirectUri: string,
  proxyURL?: string
): Promise<{ client_id: string; client_secret: string }> {
  const options: RequestInit = {
    method: 'post',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'LeanIX Custom Report Tools',
      redirect_uris: [redirectUri]
    })
  };
  if (proxyURL) options.agent = createProxyAgent(proxyURL);
  const res = await fetch(`${oauthBaseUrl}/register`, options);
  if (!res.ok) throw new Error(`OAuth client registration failed: ${res.status}`);
  const data = (await res.json()) as { client_id: string; client_secret: string };
  return { client_id: data.client_id, client_secret: data.client_secret };
}

export async function refreshAccessToken(
  credentials: Credentials,
  proxyURL?: string
): Promise<Credentials | null> {
  const { client_id, client_secret, refresh_token } = credentials.oauth ?? {};
  if (!client_id || !client_secret || !refresh_token) return null;

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token,
    client_id,
    client_secret
  });
  const options: RequestInit = {
    method: 'post',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  };
  if (proxyURL) options.agent = createProxyAgent(proxyURL);
  const res = await fetch(`${OAUTH_BASE_URL}/token`, options);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    ...credentials,
    oauth: {
      client_id,
      client_secret,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000
    }
  };
}

export async function runOAuthFlow(
  oauthBaseUrl = OAUTH_BASE_URL,
  proxyURL?: string
): Promise<Credentials> {
  const existing = readUserCredentials();
  let client_id = existing?.oauth?.client_id;
  let client_secret = existing?.oauth?.client_secret;

  const { port, waitForCode } = startCallbackServer();
  const redirectUri = `http://localhost:${port}/callback`;

  if (!client_id || !client_secret) {
    const reg = await registerOAuthClient(oauthBaseUrl, redirectUri, proxyURL);
    client_id = reg.client_id;
    client_secret = reg.client_secret;
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = deriveCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString('hex');

  const authorizeUrl = new URL(`${oauthBaseUrl}/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', client_id);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);

  const opened = await openBrowser(authorizeUrl.toString());
  if (!opened) {
    console.log(`\nOpen this URL in your browser to log in:\n${authorizeUrl.toString()}\n`);
  }

  const { code, state: returnedState } = await waitForCode();
  if (returnedState !== state) {
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }

  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id,
    client_secret
  });
  const tokenOptions: RequestInit = {
    method: 'post',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString()
  };
  if (proxyURL) tokenOptions.agent = createProxyAgent(proxyURL);
  const tokenRes = await fetch(`${oauthBaseUrl}/token`, tokenOptions);
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`);
  }
  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const host = getHostFromAccessToken(tokenData.access_token);
  const credentials: Credentials = {
    _description:
      'This file is managed by LeanIX Custom Report Tools. It contains your login credentials and is shared across all custom reports on this machine. To log out, run: npm run logout',
    host,
    oauth: {
      client_id,
      client_secret,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + tokenData.expires_in * 1000
    },
    ...(proxyURL ? { proxyURL } : {})
  };
  writeUserCredentials(credentials);
  return credentials;
}
