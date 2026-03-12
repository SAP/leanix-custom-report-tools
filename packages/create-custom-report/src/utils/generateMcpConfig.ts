import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface GenerateMcpConfigParams {
  targetDir: string;
  host: string;
  apitoken: string;
}

/**
 * Generates MCP configuration files with Chrome DevTools + LeanIX MCP servers.
 * Creates .vscode/mcp.json for GitHub Copilot and .mcp.json for Claude Code.
 *
 * Chrome DevTools MCP enables AI agents to:
 * - Navigate to custom report URLs
 * - Check console for JavaScript/GraphQL errors
 * - Take screenshots to verify rendering
 * - Verify reports work before declaring success
 *
 * LeanIX MCP Server enables AI agents to:
 * - Access workspace data during development
 * - Query GraphQL schema introspection
 * - Use custom report development tools
 *
 * Configuration uses:
 * - npx for automatic updates
 * - -y flag to auto-confirm
 * - @latest for always getting latest version
 * - --headless flag for Chrome DevTools (no UI disruption)
 *
 * @param params - Configuration parameters
 * @param params.targetDir - Project root directory where MCP configs will be created
 * @param params.host - LeanIX instance host (e.g., demo-eu.leanix.net)
 * @param params.apitoken - API token for LeanIX authentication
 */
export const generateMcpConfig = (params: GenerateMcpConfigParams): void => {
  const { targetDir, host, apitoken } = params;

  // Server configuration (shared between IDEs)
  const serverConfig = {
    'chrome-devtools': {
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest', '--headless']
    },
    'leanix-mcp-server': {
      command: 'npx',
      args: [
        '-y',
        'mcp-remote',
        `https://${host}/services/mcp-server/v1/mcp?toolsets=inventory,custom_reports`,
        '--header',
        `Authorization: Token ${apitoken}`
      ]
    }
  };

  // GitHub Copilot (VS Code) - uses "servers" key
  const vscodeDir = join(targetDir, '.vscode');
  if (!existsSync(vscodeDir)) {
    mkdirSync(vscodeDir, { recursive: true });
  }
  writeFileSync(
    join(vscodeDir, 'mcp.json'),
    JSON.stringify({ servers: serverConfig }, null, 2) + '\n'
  );

  // Claude Code (project root) - uses "mcpServers" key
  writeFileSync(
    join(targetDir, '.mcp.json'),
    JSON.stringify({ mcpServers: serverConfig }, null, 2) + '\n'
  );
};
