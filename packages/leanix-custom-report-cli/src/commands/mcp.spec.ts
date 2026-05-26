import { resolveMcpAuth } from './mcp';

jest.mock('@lxr/core/index', () => ({
  EXP_BUFFER_SECONDS: 300,
  readCredentials: jest.fn(),
  resolveAccessToken: jest.fn()
}));

import { readCredentials, resolveAccessToken } from '@lxr/core/index';

const mockReadCredentials = jest.mocked(readCredentials);
const mockResolveAccessToken = jest.mocked(resolveAccessToken);

const MCP_PATH = '/services/mcp-server/v1/mcp?toolsets=inventory,custom_reports';

beforeEach(() => {
  jest.resetAllMocks();
});

describe('resolveMcpAuth', () => {
  it('uses apitoken when credentials have apitoken and host', async () => {
    mockReadCredentials.mockReturnValue({ credentials: { host: 'acme.leanix.net', apitoken: 'tok-abc' }, path: '/fake/lxr.json' });

    const result = await resolveMcpAuth();

    expect(result.mcpUrl).toBe(`https://acme.leanix.net${MCP_PATH}`);
    expect(result.authorization).toBe('Token tok-abc');
    expect(result.expiresAt).toBeUndefined();
    expect(mockResolveAccessToken).not.toHaveBeenCalled();
  });

  it('falls through to OAuth when credentials have no apitoken', async () => {
    mockReadCredentials.mockReturnValue({ credentials: { host: 'corp.leanix.net' }, path: '/fake/lxr.json' });
    mockResolveAccessToken.mockResolvedValue({ bearerToken: 'bear', host: 'corp.leanix.net', expiresAt: 9999999 });

    const result = await resolveMcpAuth();

    expect(result.authorization).toBe('Bearer bear');
    expect(result.mcpUrl).toBe(`https://corp.leanix.net${MCP_PATH}`);
    expect(result.expiresAt).toBe(9999999);
    expect(mockResolveAccessToken).toHaveBeenCalled();
  });

  it('falls through to OAuth when no credentials are present', async () => {
    mockReadCredentials.mockReturnValue(null);
    mockResolveAccessToken.mockResolvedValue({ bearerToken: 'bear', host: 'corp.leanix.net', expiresAt: 9999999 });

    const result = await resolveMcpAuth();

    expect(result.authorization).toBe('Bearer bear');
    expect(result.expiresAt).toBe(9999999);
    expect(mockResolveAccessToken).toHaveBeenCalled();
  });

  it('returns no expiresAt when OAuth resolveAccessToken omits it', async () => {
    mockReadCredentials.mockReturnValue(null);
    mockResolveAccessToken.mockResolvedValue({ bearerToken: 'bear', host: 'corp.leanix.net' });

    const result = await resolveMcpAuth();

    expect(result.expiresAt).toBeUndefined();
  });
});
