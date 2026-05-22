import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface GenerateMcpConfigParams {
  targetDir: string;
  host: string;
}

export const generateMcpConfig = (params: GenerateMcpConfigParams): void => {
  const { targetDir, host } = params;

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
        `https://${host}/services/mcp-server/v1/mcp?toolsets=inventory,custom_reports`
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
