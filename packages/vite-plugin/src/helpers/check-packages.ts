import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PACKAGES = [
  '@sap/vite-plugin-leanix-custom-report',
  '@leanix/reporting'
] as const;

async function runNpmView(pkg: string, field: string): Promise<string> {
  const { stdout } = await execFileAsync('npm', ['view', pkg, field], {
    timeout: 10_000
  });
  return stdout.trim();
}

async function getInstalledVersion(
  projectRoot: string,
  pkg: string
): Promise<string | null> {
  try {
    const lockPath = join(projectRoot, 'package-lock.json');
    const raw = await readFile(lockPath, 'utf-8');
    const lock = JSON.parse(raw) as {
      packages?: Record<string, { version?: string }>;
    };
    const key = `node_modules/${pkg}`;
    return lock.packages?.[key]?.version ?? null;
  } catch {
    return null;
  }
}

export async function checkPackageVersions(
  projectRoot: string,
  logger: { warn: (msg: string) => void; error: (msg: string) => void }
): Promise<void> {
  const checks = await Promise.allSettled(
    PACKAGES.map(async (pkg) => {
      const installedVersion = await getInstalledVersion(projectRoot, pkg);
      if (installedVersion === null) return;

      const [latestVersion, deprecatedMessage] = await Promise.all([
        runNpmView(pkg, 'version').catch(() => null),
        runNpmView(pkg, 'deprecated').catch(() => null)
      ]);

      // npm view returns an empty string when the field is not set
      const isDeprecated =
        typeof deprecatedMessage === 'string' && deprecatedMessage.length > 0;

      if (isDeprecated) {
        logger.error(
          `\n💥 Package "${pkg}@${installedVersion}" is deprecated and no longer supported.\n` +
            `   Please upgrade by running:\n\n` +
            `     npm install ${pkg}@latest\n`
        );
        return 'deprecated';
      }

      if (latestVersion !== null && latestVersion !== installedVersion) {
        logger.warn(
          `\n⚠️  Package "${pkg}" is outdated (${installedVersion} → ${latestVersion}).\n` +
            `   Please upgrade by running:\n\n` +
            `     npm install ${pkg}@latest\n`
        );
        return 'outdated';
      }
    })
  );

  const mustBlock = checks.some(
    (result) =>
      result.status === 'fulfilled' &&
      (result.value === 'deprecated' || result.value === 'outdated')
  );

  if (mustBlock) {
    process.exit(1);
  }
}
