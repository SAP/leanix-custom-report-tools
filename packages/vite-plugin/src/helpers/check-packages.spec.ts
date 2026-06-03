import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance
} from 'vitest';

vi.mock('node:child_process', () => {
  const execFile = vi.fn();
  return { execFile, default: { execFile } };
});

const { execFile } = await import('node:child_process');
const { checkPackageVersions } = await import('./check-packages');

type ExecFileCallback = (
  err: Error | null,
  out: { stdout: string; stderr: string }
) => void;

function mockNpmView(
  responses: Record<string, { stdout?: string; error?: Error }>
): void {
  vi.mocked(execFile).mockImplementation(((
    _cmd: string,
    args: readonly string[],
    _options: unknown,
    cb: ExecFileCallback
  ) => {
    const key = `${args[1]} ${args[2]}`;
    const match = responses[key];
    if (match?.error) {
      cb(match.error, { stdout: '', stderr: '' });
    } else {
      cb(null, { stdout: match?.stdout ?? '', stderr: '' });
    }
    return {} as ReturnType<typeof execFile>;
  }) as unknown as typeof execFile);
}

function writeLockFile(
  projectRoot: string,
  packages: Record<string, string>
): void {
  const lockPackages = Object.fromEntries(
    Object.entries(packages).map(([name, version]) => [
      `node_modules/${name}`,
      { version }
    ])
  );
  writeFileSync(
    join(projectRoot, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages: lockPackages })
  );
}

const PLUGIN = '@sap/vite-plugin-leanix-custom-report';
const REPORTING = '@leanix/reporting';

describe('checkPackageVersions', () => {
  let projectRoot: string;
  let logger: {
    warn: ReturnType<typeof vi.fn<(msg: string) => void>>;
    error: ReturnType<typeof vi.fn<(msg: string) => void>>;
  };
  let exitSpy: MockInstance;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'lxr-check-pkg-'));
    logger = {
      warn: vi.fn<(msg: string) => void>(),
      error: vi.fn<(msg: string) => void>()
    };
    vi.mocked(execFile).mockReset();
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    exitSpy.mockRestore();
  });

  it('does nothing when packages are up-to-date and not deprecated', async () => {
    writeLockFile(projectRoot, { [REPORTING]: '0.4.178', [PLUGIN]: '8.7.0' });
    mockNpmView({
      [`${REPORTING} version`]: { stdout: '0.4.178' },
      [`${REPORTING} deprecated`]: { stdout: '' },
      [`${PLUGIN} version`]: { stdout: '8.7.0' },
      [`${PLUGIN} deprecated`]: { stdout: '' }
    });

    await checkPackageVersions(projectRoot, logger);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('blocks with an error when an installed version is deprecated', async () => {
    writeLockFile(projectRoot, { [REPORTING]: '0.4.100' });
    mockNpmView({
      [`${REPORTING} version`]: { stdout: '0.4.178' },
      [`${REPORTING} deprecated`]: {
        stdout: 'Please upgrade — pathfinder upload endpoint will be removed.'
      }
    });

    await checkPackageVersions(projectRoot, logger);

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0][0]).toContain('deprecated');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('warns but continues when an installed version is outdated', async () => {
    writeLockFile(projectRoot, { [PLUGIN]: '8.6.0' });
    mockNpmView({
      [`${PLUGIN} version`]: { stdout: '8.7.0' },
      [`${PLUGIN} deprecated`]: { stdout: '' }
    });

    await checkPackageVersions(projectRoot, logger);

    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0][0]).toContain('outdated');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('continues silently when npm view fails (offline / registry down)', async () => {
    writeLockFile(projectRoot, { [REPORTING]: '0.4.178' });
    mockNpmView({
      [`${REPORTING} version`]: { error: new Error('ENOTFOUND') },
      [`${REPORTING} deprecated`]: { error: new Error('ENOTFOUND') }
    });

    await checkPackageVersions(projectRoot, logger);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('skips packages absent from package-lock.json', async () => {
    // No lock file — npm view should never be called.
    await checkPackageVersions(projectRoot, logger);

    expect(execFile).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
