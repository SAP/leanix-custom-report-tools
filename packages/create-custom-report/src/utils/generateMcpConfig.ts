import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';
import { execFileSync } from 'node:child_process';

interface GenerateMcpConfigParams {
  targetDir: string;
  localCliPath?: string;
}

/**
 * Picks the Playwright MCP `--browser` value at creation time so verification
 * works without forcing the user to install a browser.
 *
 * - Windows → 'msedge'   (Edge ships with Windows; zero download)
 * - macOS   → 'chrome'   if /Applications/Google Chrome.app is installed,
 *             else 'chromium' (Playwright-bundled, ~150 MB on first run)
 * - Linux   → 'chrome'   if google-chrome / google-chrome-stable is on PATH,
 *             else 'chromium' (Playwright-bundled, ~150 MB on first run)
 */
export const detectBrowser = (): string => {
  // 'win32' is Node's identifier for all Windows (32-bit and 64-bit alike)
  if (platform() === 'win32') return 'msedge';

  if (platform() === 'darwin') {
    return existsSync('/Applications/Google Chrome.app')
      ? 'chrome'
      : 'chromium';
  }

  // Linux and other Unix-likes — match what Playwright's chrome channel looks for
  for (const bin of ['google-chrome', 'google-chrome-stable']) {
    try {
      execFileSync('which', [bin], { stdio: 'ignore' });
      return 'chrome';
    } catch {
      // not installed under this name; try the next
    }
  }
  return 'chromium';
};

/**
 * Generates MCP configuration files with Playwright MCP + LeanIX MCP servers.
 * Creates .vscode/mcp.json for GitHub Copilot and .mcp.json for Claude Code.
 *
 * Playwright MCP enables AI agents to:
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
 * - --headless flag for Playwright MCP (no UI disruption)
 * - --browser detected at creation time by `detectBrowser()` above
 *
 * @param params - Configuration parameters
 * @param params.targetDir - Project root directory where MCP configs will be created
 * @param params.localCliPath - Optional path to local CLI for LeanIX MCP
 */
export const generateMcpConfig = (params: GenerateMcpConfigParams): void => {
  const { targetDir, localCliPath } = params;

  const browserArgs = ['--browser', detectBrowser()];

  const leanixMcpServer = localCliPath
    ? { command: 'node', args: [localCliPath, 'mcp'] }
    : {
        command: 'npx',
        args: ['-y', '@sap/vite-plugin-leanix-custom-report', 'mcp']
      };

  // Server configuration (shared between IDEs)
  const serverConfig = {
    playwright: {
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest', '--headless', ...browserArgs]
    },
    'leanix-mcp-server': leanixMcpServer
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
