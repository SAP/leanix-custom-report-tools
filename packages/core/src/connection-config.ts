import type { ConnectionConfig } from './models/connection-config';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';
import { connectionConfigSchema } from './models/connection-config';
import { getProjectLxrJsonPath, getUserLxrJsonPath } from './constants';
import { initProxy } from './proxy';

function readLxrJson(path: string): ConnectionConfig {
  return connectionConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

function saveLxrJson(path: string, config: ConnectionConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function readConnectionConfig(): {
  config: ConnectionConfig;
  path: string;
} | null {
  const path = resolveConnectionConfigPath();
  if (!existsSync(path)) return null;
  const config = readLxrJson(path);

  // Ensure proxy is initialized on read
  initProxy(config.proxyURL);

  return { config, path };
}

function connectionConfigDescription(path: string): string {
  const isUserLevel = path === getUserLxrJsonPath();
  return isUserLevel
    ? 'This file is managed by LeanIX Custom Report Tools. It is shared across all custom reports on this machine. To log out, run: npm run logout'
    : 'This file is managed by LeanIX Custom Report Tools. To log out, run: npm run logout';
}

function resolveConnectionConfigPath(): string {
  // Project-level file takes precedence; default to user-level if absent
  const projectPath = getProjectLxrJsonPath();
  return existsSync(projectPath) ? projectPath : getUserLxrJsonPath();
}

export function saveConnectionConfig(
  config: ConnectionConfig,
  path = resolveConnectionConfigPath()
): string {
  saveLxrJson(path, {
    _description: connectionConfigDescription(path),
    ...config
  });
  return path;
}

export function clearConnectionConfig(): void {
  const path = resolveConnectionConfigPath();
  const existing = readLxrJson(path);
  if (!existing) return;
  const { host, proxyURL } = existing;
  // Keep the file if there's anything worth preserving (host/proxy config); otherwise delete it.
  if (host !== undefined || proxyURL !== undefined) {
    saveLxrJson(path, {
      _description: connectionConfigDescription(path),
      host,
      proxyURL
    });
  } else {
    unlinkSync(path);
  }
}
