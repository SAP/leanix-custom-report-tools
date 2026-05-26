import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Credentials } from '@lxr/core/models/leanix-credentials';
import {
  readCredentials,
  resolveAccessToken
} from '@lxr/core/index';

export type McpAuth = {
  mcpUrl: string;
  authorization: string;
  expiresAt?: number;
};

const MCP_PATH = '/services/mcp-server/v1/mcp?toolsets=inventory,custom_reports';

function apitokenAuth(creds: Credentials): McpAuth | null {
  if (!creds.apitoken || !creds.host) return null;
  return {
    mcpUrl: `https://${creds.host}${MCP_PATH}`,
    authorization: `Token ${creds.apitoken}`
  };
}

export async function resolveMcpAuth(): Promise<McpAuth> {
  const entry = readCredentials();
  if (entry) {
    const auth = apitokenAuth(entry.credentials);
    if (auth) return auth;
  }

  const resolved = await resolveAccessToken();
  return {
    mcpUrl: `https://${resolved.host}${MCP_PATH}`,
    authorization: `Bearer ${resolved.bearerToken}`,
    expiresAt: resolved.expiresAt
  };
}

export async function mcp(): Promise<void> {
  const { mcpUrl, authorization } = await resolveMcpAuth();
  const authHeaders: Record<string, string> = { Authorization: authorization };

  const httpTransport = new StreamableHTTPClientTransport(
    new URL(mcpUrl),
    { requestInit: { headers: authHeaders } }
  );
  const stdioTransport = new StdioServerTransport();

  stdioTransport.onmessage = (msg) => httpTransport.send(msg);
  httpTransport.onmessage = (msg) => stdioTransport.send(msg);

  const exit = (err?: Error) => {
    if (err) process.stderr.write(err.message + '\n');
    process.exit(err ? 1 : 0);
  };
  stdioTransport.onerror = exit;
  httpTransport.onerror = exit;
  stdioTransport.onclose = () => exit();
  httpTransport.onclose = () => exit();

  await httpTransport.start();
  await stdioTransport.start();
}
