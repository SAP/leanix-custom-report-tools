import { homedir } from 'node:os';
import { join } from 'node:path';

export const LXR_JSON_FILENAME = 'lxr.json';

const getConfigDir = (): string => {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? homedir(), 'leanix');
  }
  return join(homedir(), '.leanix');
};

export const getProjectLxrJsonPath = (): string =>
  join(process.cwd(), LXR_JSON_FILENAME);

export const getUserLxrJsonPath = (): string =>
  join(getConfigDir(), LXR_JSON_FILENAME);

export const OAUTH_BASE_URL = 'https://mcp.leanix.net';
