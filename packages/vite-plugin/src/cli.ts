import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  deleteUserCredentials,
  runOAuthFlow
} from '@lxr/core/index';

const CREDENTIALS_PATH = join(homedir(), '.leanix', 'credentials');

async function login(): Promise<void> {
  console.log(
    'Credentials will be saved to ~/.leanix/credentials and shared across all LeanIX custom reports on this machine.'
  );
  deleteUserCredentials();
  const credentials = await runOAuthFlow();
  console.log(`\nLogged in to ${credentials.host ?? 'LeanIX'}`);
}

function logout(): void {
  if (existsSync(CREDENTIALS_PATH)) {
    deleteUserCredentials();
    console.log('Logged out. Credentials removed from ~/.leanix/credentials');
  } else {
    console.log('Not logged in.');
  }
}

const command = process.argv[2];
if (command === 'login') {
  login().catch((err) => {
    console.error(`Login failed: ${err?.message ?? err}`);
    process.exit(1);
  });
} else if (command === 'logout') {
  logout();
} else {
  console.error(`Usage: lxr <login|logout>`);
  process.exit(1);
}
