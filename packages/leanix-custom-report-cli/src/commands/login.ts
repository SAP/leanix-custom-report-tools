import {
  clearCredentials,
  getUserLxrJsonPath,
  readCredentials,
  runOAuthFlow,
  saveCredentials
} from '@lxr/core/index';

export async function login(): Promise<void> {
  const entry = readCredentials();
  const targetPath = entry?.path ?? getUserLxrJsonPath();
  const proxyURL = entry?.credentials.proxyURL;
  console.log(
    `Credentials will be saved to ${targetPath} and shared across all LeanIX custom reports on this machine.`
  );
  const credentials = await runOAuthFlow(undefined, proxyURL);
  if (entry) {
    saveCredentials({ ...entry.credentials, ...credentials }, entry.path);
  } else {
    saveCredentials(credentials);
  }
  console.log(`\nLogged in to ${credentials.host ?? 'LeanIX'}`);
}

export function logout(): void {
  const entry = readCredentials();
  if (!entry?.credentials.oauth && !entry?.credentials.apitoken) {
    console.log('Not logged in.');
    return;
  }
  clearCredentials(entry.path);
  console.log(`Logged out. Credentials removed from ${entry.path}`);
}
