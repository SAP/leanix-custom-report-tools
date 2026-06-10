import { login as coreLogin, logout as coreLogout } from '@lxr/core/auth';
import { getWorkspaceNameFromAccessToken } from '@lxr/core/oauth';

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
} else {
  console.error(`Usage: lxr <login|logout>`);
  process.exit(1);
}
