import * as oauth from 'oauth4webapi';
import type { Credentials } from './models/leanix-credentials';
import open from 'open';
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { jwtDecode } from 'jwt-decode';
import type { JwtClaims } from '@lxr/core/models/jwt-claims';
import { OAUTH_BASE_URL } from './constants';

export function getHostFromAccessToken(accessToken: string): string {
  const claims: JwtClaims = jwtDecode(accessToken);
  return new URL(claims.instanceUrl).hostname;
}

export function getWorkspaceNameFromAccessToken(accessToken: string): string {
  const claims: JwtClaims = jwtDecode(accessToken);
  return claims.principal.permission.workspaceName;
}

export function startCallbackServer(): {
  port: number;
  waitForCode: () => Promise<{ code: string; state: string }>;
} {
  let resolveCode!: (v: { code: string; state: string }) => void;
  let rejectCode!: (e: Error) => void;
  const codePromise = new Promise<{ code: string; state: string }>(
    (res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    }
  );

  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (code && state) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body><h2>Login successful! You can close this tab.</h2></body></html>'
      );
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

export async function deregisterOAuthClient(
  issuer: string,
  clientId: string,
  registrationAccessToken: string
): Promise<void> {
  const as = await discover(issuer);
  if (!as.registration_endpoint) return;
  const res = await fetch(
    `${as.registration_endpoint}/${encodeURIComponent(clientId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${registrationAccessToken}` }
    }
  );
  if (!res.ok && res.status !== 404)
    throw new Error(`OAuth client deregistration failed: ${res.status}`);
}

async function discover(issuer: string): Promise<oauth.AuthorizationServer> {
  const issuerUrl = new URL(issuer);
  const res = await fetch(
    `${issuer}/.well-known/oauth-authorization-server/services/mcp-server/v1`
  );
  return oauth.processDiscoveryResponse(issuerUrl, res);
}

export async function refreshAccessToken(
  credentials: Credentials
): Promise<Credentials | null> {
  const { client_id, client_secret, refresh_token, issuer } =
    credentials.oauth ?? {};
  if (!client_id || !client_secret || !refresh_token) return null;

  try {
    const as = await discover(issuer ?? OAUTH_BASE_URL);
    const client: oauth.Client = { client_id };
    const clientAuth = oauth.ClientSecretPost(client_secret);

    const res = await oauth.refreshTokenGrantRequest(
      as,
      client,
      clientAuth,
      refresh_token
    );
    const tokens = await oauth.processRefreshTokenResponse(as, client, res);

    return {
      ...credentials,
      oauth: {
        ...credentials.oauth!,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? refresh_token,
        expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000
      }
    };
  } catch {
    return null;
  }
}

export type ExistingOAuthClient = {
  client_id: string;
  client_secret: string;
  registration_access_token?: string;
};

export async function runOAuthFlow(
  oauthBaseUrl = OAUTH_BASE_URL,
  proxyURL?: string,
  existingClient?: ExistingOAuthClient
): Promise<Credentials> {
  let client_id = existingClient?.client_id;
  let client_secret = existingClient?.client_secret;
  let registration_access_token = existingClient?.registration_access_token;

  const { port, waitForCode } = startCallbackServer();
  const redirectUri = `http://localhost:${port}/callback`;

  const as = await discover(oauthBaseUrl);

  if (!client_id || !client_secret) {
    const regReq = await oauth.dynamicClientRegistrationRequest(as, {
      client_name: 'LeanIX Custom Report Tools',
      redirect_uris: [redirectUri]
    });
    // Server omits client_secret_expires_at (required by RFC 7591 §3.2.1).
    // Inject 0 (never expires) so oauth4webapi validation passes.
    const regJson = (await regReq.json()) as Record<string, unknown>;
    if (
      regJson.client_secret &&
      regJson.client_secret_expires_at === undefined
    ) {
      regJson.client_secret_expires_at = 0;
    }
    const patchedRes = new Response(JSON.stringify(regJson), {
      status: 201,
      headers: { 'content-type': 'application/json' }
    });
    const reg =
      await oauth.processDynamicClientRegistrationResponse(patchedRes);
    client_id = reg.client_id;
    if (typeof reg.client_secret !== 'string' || !reg.client_secret) {
      throw new Error(
        'Dynamic client registration did not return a client_secret'
      );
    }
    client_secret = reg.client_secret;
    registration_access_token = reg.registration_access_token as
      | string
      | undefined;
  }

  const codeVerifier = oauth.generateRandomCodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const state = oauth.generateRandomState();

  // Build authorization URL manually — oauth4webapi does not export buildAuthorizationUrl
  if (!as.authorization_endpoint) {
    throw new Error(
      'Authorization server metadata is missing authorization_endpoint'
    );
  }
  const authorizeUrl = new URL(as.authorization_endpoint);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', client_id);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);

  const opened = await openBrowser(authorizeUrl.toString());
  if (!opened) {
    console.log(
      `\nOpen this URL in your browser to log in:\n${authorizeUrl.toString()}\n`
    );
  }

  const { code, state: returnedState } = await waitForCode();

  const client: oauth.Client = { client_id };
  const clientAuth = oauth.ClientSecretPost(client_secret);

  // Build callback URLSearchParams and validate via oauth4webapi (handles state check internally)
  const callbackSearchParams = new URLSearchParams();
  callbackSearchParams.set('code', code);
  callbackSearchParams.set('state', returnedState);

  const validatedParams = oauth.validateAuthResponse(
    as,
    client,
    callbackSearchParams,
    state
  );

  const tokenRes = await oauth.authorizationCodeGrantRequest(
    as,
    client,
    clientAuth,
    validatedParams,
    redirectUri,
    codeVerifier
  );
  const tokens = await oauth.processAuthorizationCodeResponse(
    as,
    client,
    tokenRes
  );
  if (!tokens.refresh_token) {
    throw new Error('Authorization server did not return a refresh_token');
  }

  const host = getHostFromAccessToken(tokens.access_token);
  return {
    _description:
      'This file is managed by LeanIX Custom Report Tools. It contains your login credentials and is shared across all custom reports on this machine. To log out, run: npm run logout',
    host,
    oauth: {
      issuer: oauthBaseUrl,
      client_id,
      client_secret,
      registration_access_token,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000
    },
    ...(proxyURL ? { proxyURL } : {})
  };
}
