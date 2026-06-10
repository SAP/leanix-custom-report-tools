import { login as coreLogin, logout as coreLogout, authenticate } from '@lxr/core/auth';
import { getWorkspaceNameFromAccessToken } from '@lxr/core/oauth';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_PATH = '/services/mcp-server/v1/mcp?toolsets=inventory,custom_reports';
const EXP_BUFFER_SECONDS = 300;

async function login(): Promise<void> {
  const { config, path } = await coreLogin();
  const workspaceName = getWorkspaceNameFromAccessToken(
    config.oauth!.access_token
  );
  console.log(`Logged in to https://${config.host}/${workspaceName}`);
  console.log(`Credentials saved to ${path}`);
}

async function logout(): Promise<void> {
  const result = await coreLogout();
  if (!result) {
    console.log('Not logged in.');
    return;
  }
  console.log(`Logged out. Credentials removed from ${result.path}`);
}

async function mcp(): Promise<void> {
  const { bearerToken, host, expiresAt } = await authenticate();
  const authHeaders: Record<string, string> = { Authorization: `Bearer ${bearerToken}` };

  let refreshTimeout: ReturnType<typeof setTimeout> | undefined;

  function scheduleRefresh(currentExpiresAt: number): void {
    const delay = Math.max(currentExpiresAt - Date.now() - EXP_BUFFER_SECONDS * 1000, 0);
    refreshTimeout = setTimeout(async () => {
      try {
        const { bearerToken: newToken, expiresAt: newExpiresAt } = await authenticate();
        authHeaders.Authorization = `Bearer ${newToken}`;
        if (newExpiresAt) scheduleRefresh(newExpiresAt);
      } catch (err) {
        process.stderr.write(`Auth refresh failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }, delay);
    refreshTimeout.unref();
  }

  if (expiresAt) scheduleRefresh(expiresAt);

  const httpTransport = new StreamableHTTPClientTransport(
    new URL(`https://${host}${MCP_PATH}`),
    { requestInit: { headers: authHeaders } }
  );
  const stdioTransport = new StdioServerTransport();

  stdioTransport.onmessage = (msg) => httpTransport.send(msg);
  httpTransport.onmessage = (msg) => stdioTransport.send(msg);

  const exit = (err?: Error): void => {
    clearTimeout(refreshTimeout);
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

const command = process.argv[2];
if (command === 'login') {
  login().catch((err) => {
    console.error(`Login failed: ${err?.message ?? err}`);
    process.exit(1);
  });
} else if (command === 'logout') {
  logout().catch((err) => {
    console.error(`Logout failed: ${err?.message ?? err}`);
    process.exit(1);
  });
} else if (command === 'mcp') {
  mcp().catch((err) => {
    console.error(`MCP failed: ${err?.message ?? err}`);
    process.exit(1);
  });
} else {
  console.error(`Usage: lxr <login|logout|mcp>`);
  process.exit(1);
}
