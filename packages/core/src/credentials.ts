import type { Credentials } from './models/leanix-credentials';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { credentialsSchema } from './models/leanix-credentials';

const getUserCredentialsPath = () => join(homedir(), '.leanix', 'credentials');

export function readUserCredentials(): Credentials | null {
  try {
    const raw = readFileSync(getUserCredentialsPath(), 'utf8');
    return credentialsSchema.parse(JSON.parse(raw));
  } catch (e: any) {
    if (e?.code !== 'ENOENT') {
      console.warn('[lxr] Could not read ~/.leanix/credentials:', e?.message ?? e);
    }
    return null;
  }
}

export function writeUserCredentials(credentials: Credentials): void {
  mkdirSync(join(homedir(), '.leanix'), { recursive: true });
  writeFileSync(getUserCredentialsPath(), JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

export function deleteUserCredentials(): void {
  try {
    unlinkSync(getUserCredentialsPath());
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e;
  }
}
