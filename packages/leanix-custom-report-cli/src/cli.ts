import { login, logout } from './commands/login.js';
import { mcp } from './commands/mcp.js';

const command = process.argv[2];
if (command === 'login') {
  login().catch((err) => {
    console.error(`Login failed: ${err?.message ?? err}`);
    process.exit(1);
  });
} else if (command === 'logout') {
  logout();
} else if (command === 'mcp') {
  mcp().catch((err) => {
    console.error(`MCP failed: ${err?.message ?? err}`);
    process.exit(1);
  });
} else {
  console.error(`Usage: lxr <login|logout|mcp>`);
  process.exit(1);
}
