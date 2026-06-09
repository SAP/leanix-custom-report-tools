import type { Credentials } from './models/leanix-credentials';
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

import { readCredentials, saveCredentials } from './credentials';
import { getHostFromAccessToken, refreshAccessToken } from './oauth';

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

const makeCredentials = (
  overrideOauth: Partial<NonNullable<Credentials['oauth']>> = {}
): Credentials => ({
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

// ── credential storage ─────────────────────────────────────────────────────

describe('credential storage', () => {
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

  describe('readCredentials (user file)', () => {
    it('returns null when credentials file does not exist', () => {
      expect(readCredentials()).toBeNull();
    });

    it('throws on invalid JSON', () => {
      mkdirSync(join(tmpDir, '.leanix'), { recursive: true });
      writeFileSync(join(tmpDir, '.leanix', 'lxr.json'), 'not valid json');
      expect(() => readCredentials()).toThrow();
    });

    it('returns parsed credentials for a valid file', () => {
      const creds = makeCredentials();
      saveCredentials(creds);
      expect(readCredentials()?.credentials).toEqual(creds);
    });
  });

  describe('saveCredentials', () => {
    it('creates directory and writes credentials as JSON', () => {
      const creds = makeCredentials();
      saveCredentials(creds);
      expect(readCredentials()?.credentials).toEqual(creds);
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

  it('returns updated credentials on a successful refresh', async () => {
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

    const result = await refreshAccessToken(makeCredentials());
    expect(result).not.toBeNull();
    expect(result!.oauth!.access_token).toBe(newToken);
    expect(result!.oauth!.refresh_token).toBe('new-refresh');
    expect(result!.oauth!.expires_at).toBeGreaterThan(Date.now());
  });

  it('returns null on 401 from token endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(makeDiscoveryResponse(ISSUER))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await refreshAccessToken(makeCredentials())).toBeNull();
  });

  it('returns null on 400 from token endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(makeDiscoveryResponse(ISSUER))
      .mockResolvedValueOnce(new Response(null, { status: 400 }));
    expect(await refreshAccessToken(makeCredentials())).toBeNull();
  });

  it('uses the issuer stored in credentials for discovery', async () => {
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

    const creds = makeCredentials({ issuer: customIssuer });
    await refreshAccessToken(creds);

    const discoveryCall = fetchMock.mock.calls[0][0] as string;
    expect(discoveryCall).toContain('staging.leanix.net');
  });
});

// ── resolveAccessToken auth resolution order ───────────────────────────────

import { resolveAccessToken } from './auth';

describe('resolveAccessToken', () => {
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

    const result = await resolveAccessToken();
    expect(result.host).toBe('lxrjson.leanix.net');
    expect(result.bearerToken).toBe(accessToken);
    expect(result.expiresAt).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses valid cached credentials without any network call', async () => {
    const creds = makeCredentials({ expires_at: Date.now() + 3600 * 1000 });
    saveCredentials(creds);

    const result = await resolveAccessToken();
    expect(result.bearerToken).toBe(creds.oauth!.access_token);
    expect(result.host).toBe(creds.host);
    expect(result.expiresAt).toBe(creds.oauth!.expires_at);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes expired token and returns new bearer token', async () => {
    const expiredCreds = makeCredentials({ expires_at: Date.now() - 1000 });
    saveCredentials(expiredCreds);

    const newToken = makeFakeJwt({ instanceUrl: 'https://test.leanix.net' });
    const refreshed = makeCredentials({
      expires_at: Date.now() + 3600 * 1000,
      access_token: newToken,
      refresh_token: 'new-refresh'
    });
    vi.mocked(refreshAccessToken).mockResolvedValueOnce(refreshed);

    const result = await resolveAccessToken();
    expect(result.bearerToken).toBe(newToken);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls through to OAuth flow when refresh fails (no browser opened)', async () => {
    const expiredCreds = makeCredentials({ expires_at: Date.now() - 1000 });
    saveCredentials(expiredCreds);

    vi.mocked(refreshAccessToken).mockResolvedValueOnce(null);

    // runOAuthFlow is mocked to throw — browser must NOT be opened
    await expect(resolveAccessToken()).rejects.toThrow(
      'OAuth flow not available in unit tests'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── logout ─────────────────────────────────────────────────────────────────

import { logout } from './auth';

// makeCredentials without a host so clearCredentials deletes the file (no stub preserved)
const makeCredentialsNoHost = (
  overrideOauth: Partial<NonNullable<Credentials['oauth']>> = {}
): Credentials => ({
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

  it('does nothing when no credentials exist', async () => {
    await expect(logout()).resolves.toBeNull();
  });

  it('clears credentials on logout', async () => {
    const creds = makeCredentialsNoHost();
    saveCredentials(creds);
    expect(readCredentials()).not.toBeNull();

    await logout();

    expect(readCredentials()).toBeNull();
  });

  it('clears credentials even when deregistration fails', async () => {
    const creds = makeCredentialsNoHost({
      registration_access_token: 'rat-abc'
    });
    saveCredentials(creds);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network error'))
    );
    await logout();
    vi.unstubAllGlobals();

    expect(readCredentials()).toBeNull();
  });

  it('skips deregistration when registration_access_token is absent', async () => {
    const creds = makeCredentialsNoHost(); // no registration_access_token by default
    saveCredentials(creds);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await logout();
    vi.unstubAllGlobals();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(readCredentials()).toBeNull();
  });
});
