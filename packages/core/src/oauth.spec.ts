import type { ConnectionConfig } from './models/connection-config';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';

// Mock node:os so homedir() can be overridden per-test (must be before first import of index)
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: vi.fn(() => actual.homedir()) };
});

// Mock open (ESM-only package, incompatible with CJS runner)
vi.mock('open', () => ({ default: vi.fn() }));

// Mock oauth module — keep all real implementations except runOAuthFlow to prevent browser opening
vi.mock('@lxr/core/oauth', async () => {
  const actual =
    await vi.importActual<typeof import('@lxr/core/oauth')>('@lxr/core/oauth');
  return {
    ...actual,
    runOAuthFlow: vi
      .fn()
      .mockRejectedValue(new Error('OAuth flow not available in unit tests')),
    refreshAccessToken: vi.fn().mockImplementation(actual.refreshAccessToken)
  };
});

import {
  readConnectionConfig,
  saveConnectionConfig
} from './connection-config';
import {
  getHostFromAccessToken,
  getWorkspaceNameFromAccessToken,
  refreshAccessToken,
  startCallbackServer
} from './oauth';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFakeJwt(payload: Record<string, unknown> = {}): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      exp: 9999999999,
      iss: 'https://test.leanix.net',
      jti: 'jti-123',
      sub: 'sub-123',
      instanceUrl: 'https://test.leanix.net',
      principal: {
        permission: { workspaceName: 'test-ws', workspaceId: 'ws-1' }
      },
      ...payload
    })
  ).toString('base64url');
  return `${header}.${body}.fakesig`;
}

const makeConnectionConfig = (
  overrideOauth: Partial<NonNullable<ConnectionConfig['oauth']>> = {}
): ConnectionConfig => ({
  _description: 'test',
  host: 'test.leanix.net',
  oauth: {
    client_id: 'client-123',
    client_secret: 'secret-456',
    access_token: makeFakeJwt(),
    refresh_token: 'refresh-abc',
    expires_at: Date.now() + 3600 * 1000,
    ...overrideOauth
  }
});

function makeDiscoveryResponse(issuer: string) {
  return new Response(
    JSON.stringify({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256']
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

// ── getHostFromAccessToken ─────────────────────────────────────────────────

describe('getHostFromAccessToken', () => {
  it('extracts the hostname from instanceUrl in the JWT', () => {
    const token = makeFakeJwt({ instanceUrl: 'https://customer.leanix.net' });
    expect(getHostFromAccessToken(token)).toBe('customer.leanix.net');
  });

  it('strips protocol and path', () => {
    const token = makeFakeJwt({
      instanceUrl: 'https://my-workspace.leanix.net/some/path'
    });
    expect(getHostFromAccessToken(token)).toBe('my-workspace.leanix.net');
  });
});

// ── getWorkspaceNameFromAccessToken ───────────────────────────────────────────

describe('getWorkspaceNameFromAccessToken', () => {
  it('extracts workspaceName from the JWT principal', () => {
    const token = makeFakeJwt({
      principal: {
        permission: { workspaceName: 'my-workspace', workspaceId: 'ws-1' }
      }
    });
    expect(getWorkspaceNameFromAccessToken(token)).toBe('my-workspace');
  });
});

// ── startCallbackServer ───────────────────────────────────────────────────────

describe('startCallbackServer', () => {
  it('resolves with code and state when callback URL contains both', async () => {
    const { port, waitForCode } = await startCallbackServer();
    const code = 'auth-code-abc';
    const state = 'state-xyz';
    await fetch(`http://localhost:${port}/?code=${code}&state=${state}`);
    const result = await waitForCode();
    expect(result).toEqual({ code, state });
  });

  it('rejects when callback URL is missing code or state', async () => {
    const { port, waitForCode } = await startCallbackServer();
    const pending = waitForCode();
    fetch(`http://localhost:${port}/?code=only-code`).catch(() => {});
    await expect(pending).rejects.toThrow(
      'OAuth callback missing code or state'
    );
  });
});

// ── workspace config storage ───────────────────────────────────────────────

describe('workspace config storage', () => {
  let tmpDir: string;
  const realTmpdir = os.tmpdir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(realTmpdir(), 'lxr-cred-test-'));
    (os.homedir as ReturnType<typeof vi.fn>).mockReturnValue(tmpDir);
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('readConnectionConfig (user file)', () => {
    it('returns null when config file does not exist', () => {
      expect(readConnectionConfig()).toBeNull();
    });

    it('throws on invalid JSON', () => {
      mkdirSync(join(tmpDir, '.leanix'), { recursive: true });
      writeFileSync(join(tmpDir, '.leanix', 'lxr.json'), 'not valid json');
      expect(() => readConnectionConfig()).toThrow();
    });

    it('returns parsed config for a valid file', () => {
      const config = makeConnectionConfig();
      saveConnectionConfig(config);
      expect(readConnectionConfig()?.config).toEqual(config);
    });
  });

  describe('saveConnectionConfig', () => {
    it('creates directory and writes config as JSON', () => {
      const config = makeConnectionConfig();
      saveConnectionConfig(config);
      expect(readConnectionConfig()?.config).toEqual(config);
    });
  });
});

// ── refreshAccessToken ─────────────────────────────────────────────────────

describe('refreshAccessToken', () => {
  const ISSUER = 'https://mcp.leanix.net';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns updated config on a successful refresh', async () => {
    const newToken = makeFakeJwt({ instanceUrl: 'https://test.leanix.net' });
    fetchMock
      .mockResolvedValueOnce(makeDiscoveryResponse(ISSUER))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: newToken,
            refresh_token: 'new-refresh',
            token_type: 'Bearer',
            expires_in: 3600
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );

    const result = await refreshAccessToken(makeConnectionConfig());
    expect(result).not.toBeNull();
    expect(result!.oauth!.access_token).toBe(newToken);
    expect(result!.oauth!.refresh_token).toBe('new-refresh');
    expect(result!.oauth!.expires_at).toBeGreaterThan(Date.now());
  });

  it('returns null on 401 from token endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(makeDiscoveryResponse(ISSUER))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await refreshAccessToken(makeConnectionConfig())).toBeNull();
  });

  it('returns null on 400 from token endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(makeDiscoveryResponse(ISSUER))
      .mockResolvedValueOnce(new Response(null, { status: 400 }));
    expect(await refreshAccessToken(makeConnectionConfig())).toBeNull();
  });

  it('uses the issuer stored in config for discovery', async () => {
    const customIssuer = 'https://staging.leanix.net';
    const newToken = makeFakeJwt({ instanceUrl: 'https://staging.leanix.net' });
    fetchMock
      .mockResolvedValueOnce(makeDiscoveryResponse(customIssuer))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: newToken,
            refresh_token: 'new-refresh',
            token_type: 'Bearer',
            expires_in: 3600
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );

    const config = makeConnectionConfig({ issuer: customIssuer });
    await refreshAccessToken(config);

    const discoveryCall = fetchMock.mock.calls[0][0] as string;
    expect(discoveryCall).toContain('staging.leanix.net');
  });
});

// ── authenticate auth resolution order ───────────────────────────────

import { authenticate } from './auth';

describe('authenticate', () => {
  let tmpDir: string;
  const realTmpdir = os.tmpdir;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(realTmpdir(), 'lxr-resolve-test-'));
    (os.homedir as ReturnType<typeof vi.fn>).mockReturnValue(tmpDir);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('uses lxr.json apitoken path when apitoken and host are set', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    writeFileSync(
      join(tmpDir, 'lxr.json'),
      JSON.stringify({ host: 'lxrjson.leanix.net', apitoken: 'mytoken' })
    );
    const accessToken = makeFakeJwt({
      instanceUrl: 'https://lxrjson.leanix.net'
    });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: ''
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const result = await authenticate();
    expect(result.host).toBe('lxrjson.leanix.net');
    expect(result.bearerToken).toBe(accessToken);
    expect(result.expiresAt).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses valid cached config without any network call', async () => {
    const config = makeConnectionConfig({
      expires_at: Date.now() + 3600 * 1000
    });
    saveConnectionConfig(config);

    const result = await authenticate();
    expect(result.bearerToken).toBe(config.oauth!.access_token);
    expect(result.host).toBe(config.host);
    expect(result.expiresAt).toBe(config.oauth!.expires_at);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes expired token and returns new bearer token', async () => {
    const expiredConfig = makeConnectionConfig({
      expires_at: Date.now() - 1000
    });
    saveConnectionConfig(expiredConfig);

    const newToken = makeFakeJwt({ instanceUrl: 'https://test.leanix.net' });
    const refreshed = makeConnectionConfig({
      expires_at: Date.now() + 3600 * 1000,
      access_token: newToken,
      refresh_token: 'new-refresh'
    });
    vi.mocked(refreshAccessToken).mockResolvedValueOnce(refreshed);

    const result = await authenticate();
    expect(result.bearerToken).toBe(newToken);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls through to OAuth flow when refresh fails (no browser opened)', async () => {
    const expiredConfig = makeConnectionConfig({
      expires_at: Date.now() - 1000
    });
    saveConnectionConfig(expiredConfig);

    vi.mocked(refreshAccessToken).mockResolvedValueOnce(null);

    // runOAuthFlow is mocked to throw — browser must NOT be opened
    await expect(authenticate()).rejects.toThrow(
      'OAuth flow not available in unit tests'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── logout ─────────────────────────────────────────────────────────────────

import { logout } from './auth';

// makeConnectionConfigNoHost: no host so clearConnectionConfig deletes the file
const makeConnectionConfigNoHost = (
  overrideOauth: Partial<NonNullable<ConnectionConfig['oauth']>> = {}
): ConnectionConfig => ({
  _description: 'test',
  oauth: {
    client_id: 'client-123',
    client_secret: 'secret-456',
    access_token: makeFakeJwt(),
    refresh_token: 'refresh-abc',
    expires_at: Date.now() + 3600 * 1000,
    ...overrideOauth
  }
});

describe('logout', () => {
  let tmpDir: string;
  const realTmpdir = os.tmpdir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(realTmpdir(), 'lxr-logout-test-'));
    (os.homedir as ReturnType<typeof vi.fn>).mockReturnValue(tmpDir);
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('does nothing when no config exists', async () => {
    await expect(logout()).resolves.toBeNull();
  });

  it('clears config on logout', async () => {
    const config = makeConnectionConfigNoHost();
    saveConnectionConfig(config);
    expect(readConnectionConfig()).not.toBeNull();

    await logout();

    expect(readConnectionConfig()).toBeNull();
  });

  it('clears config even when deregistration fails', async () => {
    const config = makeConnectionConfigNoHost({
      registration_access_token: 'rat-abc'
    });
    saveConnectionConfig(config);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network error'))
    );
    await logout();
    vi.unstubAllGlobals();

    expect(readConnectionConfig()).toBeNull();
  });

  it('skips deregistration when registration_access_token is absent', async () => {
    const config = makeConnectionConfigNoHost(); // no registration_access_token by default
    saveConnectionConfig(config);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await logout();
    vi.unstubAllGlobals();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(readConnectionConfig()).toBeNull();
  });
});
