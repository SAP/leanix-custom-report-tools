import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readdirSync, statSync } from 'fs-extra';
import { generate as uuid } from 'short-uuid';
import { CLI_PATH, runCli } from '../test-helpers/cli-runner';

let tempDir: string;

// Returns file paths relative to dir, recursively
const getAllFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((file) => {
    const abs = `${dir}/${file}`;
    return statSync(abs).isDirectory()
      ? getAllFiles(abs).map((f) => `${file}/${f}`)
      : [file];
  });

const getPackageJson = (dirPath: string): any =>
  JSON.parse(readFileSync(join(dirPath, 'package.json')).toString());

// React TypeScript template plus generated files: '.mcp.json', '.vscode/mcp.json'
const expectedFiles = [
  ...getAllFiles(resolve(CLI_PATH, '..', 'templates', 'react-ts')),
  '.mcp.json',
  '.vscode/mcp.json'
]
  .map((file) => (file === '_gitignore' ? '.gitignore' : file))
  .sort();

// Shared assertion: scaffolded directory contains the expected files
// and package.json reflects the supplied title/description.
function assertScaffolded(
  dir: string,
  projectName: string,
  title: string,
  description: string
): void {
  const projectDir = join(dir, projectName);
  const generatedFiles = getAllFiles(projectDir).sort();
  expect(generatedFiles).toEqual(expectedFiles);

  const generatedPkg = getPackageJson(projectDir);
  expect(generatedPkg.name).toEqual(projectName);
  expect(generatedPkg.description).toEqual(description);
  expect(generatedPkg.version).toEqual('0.0.0');
  expect(generatedPkg?.leanixReport?.title).toEqual(title);
  expect(typeof generatedPkg?.leanixReport?.defaultConfig).toEqual('object');

  expect(existsSync(join(projectDir, '.mcp.json'))).toBe(true);
  expect(existsSync(join(projectDir, '.vscode', 'mcp.json'))).toBe(true);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'create-custom-report-test-'));
});

afterEach(() => {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true });
  }
});

describe('scaffolding', () => {
  it('CLI flags (non-interactive)', () => {
    const projectName = `test-${uuid().toLowerCase()}`;
    const title = uuid();
    const description = uuid();

    const { exitCode } = runCli(
      [
        projectName,
        '--overwrite',
        '--skipAuth',
        '--title',
        title,
        '--description',
        description
      ],
      tempDir
    );

    expect(exitCode).toBe(0);
    assertScaffolded(tempDir, projectName, title, description);
  });

  it('interactive prompts via prompts.inject', () => {
    const projectName = `test-${uuid().toLowerCase()}`;
    const title = uuid();
    const description = uuid();

    // Pre-create the target dir so the overwrite prompt fires.
    mkdirSync(join(tempDir, projectName));

    // Answer order matches the prompts in src/index.ts:
    //   1. Project name
    //   2. Overwrite confirmation (true — dir exists)
    //   3. Report title
    //   4. Report description
    // The proxy prompt is skipped (--skipAuth set).
    const { exitCode } = runCli(['--skipAuth'], tempDir, [
      projectName,
      true,
      title,
      description
    ]);

    expect(exitCode).toBe(0);
    assertScaffolded(tempDir, projectName, title, description);
  });
});

describe('overwrite', () => {
  it('--overwrite flag scaffolds over an existing directory', () => {
    const projectName = `test-${uuid().toLowerCase()}`;
    const title = uuid();
    const description = uuid();

    mkdirSync(join(tempDir, projectName));

    const { exitCode } = runCli(
      [
        projectName,
        '--overwrite',
        '--skipAuth',
        '--title',
        title,
        '--description',
        description
      ],
      tempDir
    );

    expect(exitCode).toBe(0);
    assertScaffolded(tempDir, projectName, title, description);
  });

  it('prompt: user accepts → project scaffolded', () => {
    const projectName = `test-${uuid().toLowerCase()}`;
    const title = uuid();
    const description = uuid();

    mkdirSync(join(tempDir, projectName));

    const { exitCode } = runCli(
      [
        projectName,
        '--skipAuth',
        '--title',
        title,
        '--description',
        description
      ],
      tempDir,
      [true]
    );

    expect(exitCode).toBe(0);
    assertScaffolded(tempDir, projectName, title, description);
  });

  it('prompt: user declines → exits with code 1', () => {
    const projectName = `test-${uuid().toLowerCase()}`;
    mkdirSync(join(tempDir, projectName));

    const { exitCode } = runCli([projectName, '--skipAuth'], tempDir, [false]);

    expect(exitCode).toBe(1);
  });
});

describe('--help', () => {
  it('prints usage and exits with code 0', () => {
    const { exitCode, stdout } = runCli(['--help']);

    expect(exitCode).toBe(0);

    const flags = [
      '--title',
      '--description',
      '--proxyURL',
      '--overwrite',
      '--skipAuth',
      '--help'
    ];
    for (const flag of flags) {
      expect((stdout as string)?.includes(flag)).toBe(true);
    }
  });
});
