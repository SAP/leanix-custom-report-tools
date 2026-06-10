import * as oauth from 'oauth4webapi';
import type { ConnectionConfig } from './models/connection-config';
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

type AuthCode = { code: string; state: string };

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

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  return { port, server, waitForCode: () => codePromise };
}

async function discover(issuer: string): Promise<oauth.AuthorizationServer> {
  const issuerUrl = new URL(issuer);
  const res = await fetch(
    `${issuer}/.well-known/oauth-authorization-server/services/mcp-server/v1`
  );
  return oauth.processDiscoveryResponse(issuerUrl, res);
}

export async function refreshAccessToken(
  config: ConnectionConfig
): Promise<ConnectionConfig | null> {
  const { client_id, client_secret, refresh_token, issuer } =
    config.oauth ?? {};
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
    const as = await discover(OAUTH_BASE_URL);

    // 2. Register OAuth client
    // TODO: replace with fixed pre-registered client ID once
    // https://github.com/leanix/mcp-server/pull/975 lands.
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
    const client_id = reg.client_id;
    if (typeof reg.client_secret !== 'string' || !reg.client_secret) {
      throw new Error(
        'Dynamic client registration did not return a client_secret'
      );
    }
    const client_secret = reg.client_secret;
    const registration_access_token = reg.registration_access_token as
      | string
      | undefined;

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

    // 5. Build and return workspace config
    const host = getHostFromAccessToken(tokens.access_token);
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
