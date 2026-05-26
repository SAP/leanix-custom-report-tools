import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface GenerateMcpConfigParams {
  targetDir: string;
  localCliPath?: string;
}

export const generateMcpConfig = (params: GenerateMcpConfigParams): void => {
  const { targetDir, localCliPath } = params;

  const leanixMcpServer = localCliPath
    ? { command: 'node', args: [localCliPath, 'mcp'] }
    : { command: 'npx', args: ['-y', '@sap/leanix-custom-report-cli', 'mcp'] };

  const serverConfig = {
    'chrome-devtools': {
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest', '--headless']
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
