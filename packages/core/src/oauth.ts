import * as oauth from 'oauth4webapi';
import type { ConnectionConfig } from './models/connection-config';
import open from 'open';
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { jwtDecode } from 'jwt-decode';
import type { JwtClaims } from '@lxr/core/models/jwt-claims';
import { OAUTH_BASE_URL } from './constants';
import { describeError } from './errors';

export function getHostFromAccessToken(accessToken: string): string {
  const claims: JwtClaims = jwtDecode(accessToken);
  return new URL(claims.instanceUrl).hostname;
}

export function getWorkspaceNameFromAccessToken(accessToken: string): string {
  const claims: JwtClaims = jwtDecode(accessToken);
  return claims.principal.permission.workspaceName;
}

type AuthCode = {
  code: string;
  state: string;
  sendResponse: (html: string) => void;
};

export async function startCallbackServer(): Promise<{
  port: number;
  server: ReturnType<typeof createServer>;
  waitForCode: () => Promise<AuthCode>;
}> {
  let resolveCode!: (v: AuthCode) => void;
  let rejectCode!: (e: Error) => void;
  const codePromise = new Promise<AuthCode>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (code && state) {
      // Hold the response open so the caller can send it after token exchange (with the workspace redirect URL)
      resolveCode({
        code,
        state,
        sendResponse: (html: string) => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(html);
        }
      });
    } else {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing code or state');
      rejectCode(new Error('OAuth callback missing code or state'));
    }
    server.close();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  return { port, server, waitForCode: () => codePromise };
}

/**
 * Wraps a single OAuth step so any failure is reported as
 *   `Authentication failed on <step>: <reason>`
 *
 * The <reason> is the full error `cause` chain (see {@link describeError}) —
 * for HTTP failures typically `<status> <statusText>`, for network failures the
 * underlying `fetch` cause (e.g. `getaddrinfo ENOTFOUND ...`, `ECONNREFUSED`),
 * and for oauth4webapi issues its short parsing/validation message.
 */
async function authStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new Error(`Authentication failed on ${step}: ${describeError(err)}`, {
      cause: err
    });
  }
}

async function discover(issuer: string): Promise<oauth.AuthorizationServer> {
  const issuerUrl = new URL(issuer);
  const url = `${issuer}/.well-known/oauth-authorization-server/services/mcp-server/v1`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return oauth.processDiscoveryResponse(issuerUrl, res);
}

export async function refreshAccessToken(
  config: ConnectionConfig
): Promise<ConnectionConfig | null> {
  const { client_id, client_secret, refresh_token, issuer } =
    config.oauth ?? {};
  if (!client_id || !client_secret || !refresh_token) return null;

  try {
    const as = await authStep('discovery', () =>
      discover(issuer ?? OAUTH_BASE_URL)
    );
    const client: oauth.Client = { client_id };
    const clientAuth = oauth.ClientSecretPost(client_secret);

    const tokens = await authStep('token refresh', async () => {
      const res = await oauth.refreshTokenGrantRequest(
        as,
        client,
        clientAuth,
        refresh_token
      );
      return oauth.processRefreshTokenResponse(as, client, res);
    });

    return {
      ...config,
      oauth: {
        ...config.oauth!,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? refresh_token,
        expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000
      }
    };
  } catch {
    return null;
  }
}

export async function runOAuthFlow(
  proxyURL?: string
): Promise<ConnectionConfig> {
  // 1. Start local callback server
  const { port, server, waitForCode } = await startCallbackServer();
  const redirectUri = `http://localhost:${port}/callback`;

  try {
    const as = await authStep('discovery', () => discover(OAUTH_BASE_URL));

    // 2. Register OAuth client
    const reg = await authStep('client registration', async () => {
      const regReq = await oauth.dynamicClientRegistrationRequest(as, {
        client_name: 'LeanIX Custom Report Tools',
        redirect_uris: [redirectUri]
      });
      return oauth.processDynamicClientRegistrationResponse(regReq);
    });
    const client_id = reg.client_id;
    if (typeof reg.client_secret !== 'string' || !reg.client_secret) {
      throw new Error(
        'Dynamic client registration did not return a client_secret'
      );
    }
    const client_secret = reg.client_secret;
    const registration_access_token = reg.registration_access_token as
      string | undefined;

    // 3. Open browser for user login
    const codeVerifier = oauth.generateRandomCodeVerifier();
    const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
    const state = oauth.generateRandomState();

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
    await open(authorizeUrl.toString()).catch(() =>
      console.log(
        `\nOpen this URL in your browser to log in:\n${authorizeUrl}\n`
      )
    );

    // 4. Exchange authorization code for tokens
    const { code, state: returnedState, sendResponse } = await waitForCode();

    const client: oauth.Client = { client_id };
    const clientAuth = oauth.ClientSecretPost(client_secret);

    // Build callback URLSearchParams and validate via oauth4webapi (handles state check internally)
    const callbackSearchParams = new URLSearchParams();
    callbackSearchParams.set('code', code);
    callbackSearchParams.set('state', returnedState);

    const tokens = await authStep('authorization code exchange', async () => {
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
      return oauth.processAuthorizationCodeResponse(as, client, tokenRes);
    });
    if (!tokens.refresh_token) {
      throw new Error('Authorization server did not return a refresh_token');
    }

    // 5. Build and return workspace config
    const host = getHostFromAccessToken(tokens.access_token);
    const workspaceName = getWorkspaceNameFromAccessToken(tokens.access_token);
    const workspaceUrl = `https://${host}/${workspaceName}/`;
    sendResponse(
      `<html><head><meta http-equiv="refresh" content="60;url=${workspaceUrl}"></head>` +
        `<body><h2>Login successful!</h2><p>You can close this window, or we will redirect you to your LeanIX workspace in 1 minute.</p></body></html>`
    );
    return {
      host,
      oauth: {
        issuer: OAUTH_BASE_URL,
        client_id,
        client_secret,
        registration_access_token,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000
      },
      ...(proxyURL ? { proxyURL } : {})
    };
  } finally {
    server.close();
  }
}
