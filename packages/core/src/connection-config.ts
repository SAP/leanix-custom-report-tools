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
  try {
    return connectionConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch (err) {
    throw new Error(
      `Failed to parse ${path}:\n${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
}

function saveLxrJson(path: string, config: ConnectionConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function resolveConnectionConfigPath(): string {
  // Project-level file takes precedence; default to user-level if absent
  const projectPath = getProjectLxrJsonPath();
  return existsSync(projectPath) ? projectPath : getUserLxrJsonPath();
}

export type ConnectionConfigFile = {
  config: ConnectionConfig;
  path: string;
};

export function readConnectionConfig(
  userOnly = false
): ConnectionConfigFile | null {
  const path = userOnly ? getUserLxrJsonPath() : resolveConnectionConfigPath();
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

export function clearConnectionConfig(
  config: ConnectionConfig,
  path = resolveConnectionConfigPath()
): void {
  // Keep the file if there's anything worth preserving (host/proxy config); otherwise delete it.
  if (config?.host !== undefined || config?.proxyURL !== undefined) {
    saveLxrJson(path, {
      _description: connectionConfigDescription(path),
      host: config.host,
      proxyURL: config.proxyURL
    });
  } else {
    unlinkSync(path);
  }
}
