import type { Credentials } from './models/leanix-credentials';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';

// Mock node:os so homedir() can be overridden per-test (must be before first import of index)
jest.mock('node:os', () => {
  const actual = jest.requireActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: jest.fn(() => actual.homedir()) };
});

// Mock node-fetch (ESM default export)
jest.mock('node-fetch', () => ({ __esModule: true, default: jest.fn() }));

// Mock oauth module — keep all real implementations except runOAuthFlow to prevent browser opening
jest.mock('@lxr/core/oauth', () => ({
  ...jest.requireActual('@lxr/core/oauth'),
  runOAuthFlow: jest.fn().mockRejectedValue(new Error('OAuth flow not available in unit tests'))
}));

import {
  deleteUserCredentials,
  deriveCodeChallenge,
  generateCodeVerifier,
  getHostFromAccessToken,
  readUserCredentials,
  refreshAccessToken,
  writeUserCredentials
} from '@lxr/core/index';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFakeJwt(payload: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    exp: 9999999999,
    iss: 'https://test.leanix.net',
    jti: 'jti-123',
    sub: 'sub-123',
    instanceUrl: 'https://test.leanix.net',
    principal: { permission: { workspaceName: 'test-ws', workspaceId: 'ws-1' } },
    ...payload
  })).toString('base64url');
  return `${header}.${body}.fakesig`;
}

const makeCredentials = (overrideOauth: Partial<NonNullable<Credentials['oauth']>> = {}): Credentials => ({
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

// ── PKCE helpers ───────────────────────────────────────────────────────────

describe('generateCodeVerifier', () => {
  it('returns a base64url string of 43 characters', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(verifier.length).toBe(43);
  });

  it('returns a different value each call', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe('deriveCodeChallenge', () => {
  it('returns a consistent base64url SHA-256 of the verifier', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = deriveCodeChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(challenge).toBe(deriveCodeChallenge(verifier));
  });

  it('produces a different challenge for a different verifier', () => {
    expect(deriveCodeChallenge('abc')).not.toBe(deriveCodeChallenge('xyz'));
  });
});

// ── getHostFromAccessToken ─────────────────────────────────────────────────

describe('getHostFromAccessToken', () => {
  it('extracts the hostname from instanceUrl in the JWT', () => {
    const token = makeFakeJwt({ instanceUrl: 'https://customer.leanix.net' });
    expect(getHostFromAccessToken(token)).toBe('customer.leanix.net');
  });

  it('strips protocol and path', () => {
    const token = makeFakeJwt({ instanceUrl: 'https://my-workspace.leanix.net/some/path' });
    expect(getHostFromAccessToken(token)).toBe('my-workspace.leanix.net');
  });
});

// ── credential storage ─────────────────────────────────────────────────────

describe('credential storage', () => {
  let tmpDir: string;
  const realTmpdir = jest.requireActual<typeof import('node:os')>('node:os').tmpdir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(realTmpdir(), 'lxr-cred-test-'));
    (os.homedir as jest.Mock).mockReturnValue(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  describe('readUserCredentials', () => {
    it('returns null when credentials file does not exist', () => {
      expect(readUserCredentials()).toBeNull();
    });

    it('returns null and logs warning for invalid JSON', () => {
      mkdirSync(join(tmpDir, '.leanix'), { recursive: true });
      writeFileSync(join(tmpDir, '.leanix', 'credentials'), 'not valid json');
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      expect(readUserCredentials()).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('returns parsed credentials for a valid file', () => {
      const creds = makeCredentials();
      writeUserCredentials(creds);
      expect(readUserCredentials()).toEqual(creds);
    });
  });

  describe('writeUserCredentials', () => {
    it('creates directory and writes credentials as JSON', () => {
      const creds = makeCredentials();
      writeUserCredentials(creds);
      expect(readUserCredentials()).toEqual(creds);
    });
  });

  describe('deleteUserCredentials', () => {
    it('deletes the credentials file', () => {
      writeUserCredentials(makeCredentials());
      expect(readUserCredentials()).not.toBeNull();
      deleteUserCredentials();
      expect(readUserCredentials()).toBeNull();
    });

    it('is a no-op when the file does not exist', () => {
      expect(() => deleteUserCredentials()).not.toThrow();
    });
  });
});

// ── refreshAccessToken ─────────────────────────────────────────────────────

describe('refreshAccessToken', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = (require('node-fetch') as { default: jest.Mock }).default;
    fetchMock.mockReset();
  });

  it('returns updated credentials on a successful refresh', async () => {
    const newToken = makeFakeJwt({ instanceUrl: 'https://test.leanix.net' });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: newToken,
        refresh_token: 'new-refresh',
        expires_in: 3600
      })
    });

    const result = await refreshAccessToken(makeCredentials());
    expect(result).not.toBeNull();
    expect(result!.oauth!.access_token).toBe(newToken);
    expect(result!.oauth!.refresh_token).toBe('new-refresh');
    expect(result!.oauth!.expires_at).toBeGreaterThan(Date.now());
  });

  it('returns null on 401 (invalid_client / expired)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    expect(await refreshAccessToken(makeCredentials())).toBeNull();
  });

  it('returns null on 400 (bad request)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
    expect(await refreshAccessToken(makeCredentials())).toBeNull();
  });
});

// ── resolveAccessToken auth resolution order ───────────────────────────────

import { resolveAccessToken } from '@lxr/core/index';

describe('resolveAccessToken', () => {
  let tmpDir: string;
  const realTmpdir = jest.requireActual<typeof import('node:os')>('node:os').tmpdir;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(realTmpdir(), 'lxr-resolve-test-'));
    (os.homedir as jest.Mock).mockReturnValue(tmpDir);
    fetchMock = (require('node-fetch') as { default: jest.Mock }).default;
    fetchMock.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('uses lxr.json apitoken path when apitoken and host are set', async () => {
    const accessToken = makeFakeJwt({ instanceUrl: 'https://lxrjson.leanix.net' });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: ''
      })
    });

    const result = await resolveAccessToken({ host: 'lxrjson.leanix.net', apitoken: 'mytoken' });
    expect(result.host).toBe('lxrjson.leanix.net');
    expect(result.bearerToken).toBe(accessToken);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses valid cached credentials without any network call', async () => {
    const creds = makeCredentials({ expires_at: Date.now() + 3600 * 1000 });
    writeUserCredentials(creds);

    const result = await resolveAccessToken();
    expect(result.bearerToken).toBe(creds.oauth!.access_token);
    expect(result.host).toBe(creds.host);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes expired token and returns new bearer token', async () => {
    const expiredCreds = makeCredentials({ expires_at: Date.now() - 1000 });
    writeUserCredentials(expiredCreds);

    const newToken = makeFakeJwt({ instanceUrl: 'https://test.leanix.net' });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: newToken,
        refresh_token: 'new-refresh',
        expires_in: 3600
      })
    });

    const result = await resolveAccessToken();
    expect(result.bearerToken).toBe(newToken);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls through to OAuth flow when refresh fails (no browser opened)', async () => {
    const expiredCreds = makeCredentials({ expires_at: Date.now() - 1000 });
    writeUserCredentials(expiredCreds);

    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });

    // runOAuthFlow is mocked to throw — browser must NOT be opened
    await expect(resolveAccessToken()).rejects.toThrow('OAuth flow not available in unit tests');

    // Verify the refresh was attempted first
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/token');
  });
});
