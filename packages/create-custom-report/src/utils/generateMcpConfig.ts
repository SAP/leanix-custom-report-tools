import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface IGenerateMcpConfigParams {
  targetDir: string;
  host: string;
  apitoken: string;
}

/**
 * Generates MCP configuration files with Chrome DevTools + LeanIX MCP servers.
 * Creates .vscode/mcp.json, .claude/mcp.json, and .cline/mcp.json.
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
export const generateMcpConfig = (params: IGenerateMcpConfigParams): void => {
  const { targetDir, host, apitoken } = params;

  // Configuration with actual credentials (files are gitignored)
  const config = {
    mcpServers: {
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
    }
  };

  // GitHub Copilot (VS Code)
  const vscodeDir = join(targetDir, '.vscode');
  if (!existsSync(vscodeDir)) {
    mkdirSync(vscodeDir, { recursive: true });
  }
  writeFileSync(
    join(vscodeDir, 'mcp.json'),
    JSON.stringify(config, null, 2) + '\n'
  );

  // Claude Code (project root)
  writeFileSync(
    join(targetDir, '.mcp.json'),
    JSON.stringify(config, null, 2) + '\n'
  );

  // Cline
  const clineDir = join(targetDir, '.cline');
  if (!existsSync(clineDir)) {
    mkdirSync(clineDir, { recursive: true });
  }
  writeFileSync(
    join(clineDir, 'mcp.json'),
    JSON.stringify(config, null, 2) + '\n'
  );
};
