import type { Credentials } from './models/leanix-credentials';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { credentialsSchema } from './models/leanix-credentials';
import { getProjectLxrJsonPath, getUserLxrJsonPath } from './constants';

function readLxrJson(path: string): Credentials | null {
  try {
    return credentialsSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch (e: any) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

function saveLxrJson(path: string, credentials: Credentials): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

export function readCredentials(): {
  credentials: Credentials;
  path: string;
} | null {
  for (const path of [getProjectLxrJsonPath(), getUserLxrJsonPath()]) {
    const credentials = readLxrJson(path);
    if (
      credentials?.apitoken !== undefined ||
      credentials?.oauth !== undefined
    ) {
      return { credentials, path };
    }
  }
  return null;
}

export function readCredentialsPath(): { path: string; host?: string } | null {
  for (const path of [getProjectLxrJsonPath(), getUserLxrJsonPath()]) {
    const credentials = readLxrJson(path);
    if (credentials !== null) return { path, host: credentials.host };
  }
  return null;
}

export function saveCredentials(
  credentials: Credentials,
  path = getUserLxrJsonPath()
): void {
  saveLxrJson(path, credentials);
}

export function clearCredentials(path: string): void {
  const existing = readLxrJson(path);
  if (!existing) return;
  const { host, proxyURL } = existing;
  if (host !== undefined || proxyURL !== undefined) {
    saveLxrJson(path, { host, proxyURL });
  } else {
    unlinkSync(path);
  }
}
