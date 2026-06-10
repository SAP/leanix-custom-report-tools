import type { Credentials } from './models/leanix-credentials';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';
import { credentialsSchema } from './models/leanix-credentials';
import { getProjectLxrJsonPath, getUserLxrJsonPath } from './constants';
import { initProxy } from './proxy';

function readLxrJson(path: string): Credentials {
  return credentialsSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

function saveLxrJson(path: string, credentials: Credentials): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

export function readCredentials(): {
  credentials: Credentials;
  path: string;
} | null {
  const path = resolveCredentialsPath();
  if (!existsSync(path)) return null;
  const credentials = readLxrJson(path);
  initProxy(credentials.proxyURL);
  return { credentials, path };
}

function credentialsDescription(path: string): string {
  const isUserLevel = path === getUserLxrJsonPath();
  return isUserLevel
    ? 'This file is managed by LeanIX Custom Report Tools. It is shared across all custom reports on this machine. To log out, run: npm run logout'
    : 'This file is managed by LeanIX Custom Report Tools. It is scoped to this project. To log out, run: npm run logout';
}

function resolveCredentialsPath(): string {
  // Project-level file takes precedence; default to user-level if absent
  const projectPath = getProjectLxrJsonPath();
  return existsSync(projectPath) ? projectPath : getUserLxrJsonPath();
}

export function saveCredentials(
  credentials: Credentials,
  path = resolveCredentialsPath()
): string {
  saveLxrJson(path, {
    _description: credentialsDescription(path),
    ...credentials
  });
  return path;
}

export function clearCredentials(): void {
  const path = resolveCredentialsPath();
  const existing = readLxrJson(path);
  if (!existing) return;
  const { host, proxyURL } = existing;
  if (host !== undefined || proxyURL !== undefined) {
    saveLxrJson(path, {
      _description: credentialsDescription(path),
      host,
      proxyURL
    });
  } else {
    unlinkSync(path);
  }
}
