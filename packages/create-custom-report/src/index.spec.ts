import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirpSync, readdirSync, statSync, writeFileSync } from 'fs-extra';
import { generate as uuid } from 'short-uuid';
import pkg from '../package.json' with { type: 'json' };

const CLI_PATH = resolve(
  __dirname,
  '..',
  Object.values(pkg.bin as Record<string, string>)[0]
);
const projectName = 'test-app';
let tempDir: string;

const run = (
  args: string[],
  options: { cwd?: string; input?: string; reject?: boolean } = {}
) => {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      ...options,
      encoding: 'utf8'
    });
    return { stdout, stderr: '', exitCode: 0, failed: false };
  } catch (e: any) {
    return {
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      exitCode: e.status || 1,
      failed: true
    };
  }
};

// Helper to create a non-empty directory
const createNonEmptyDir = (): void => {
  const projectDir = join(tempDir, projectName);
  // Create the temporary directory
  mkdirpSync(projectDir);

  // Create a package.json file
  const pkgJson = join(projectDir, 'package.json');
  writeFileSync(pkgJson, '{ "foo": "bar" }');
};

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

beforeEach(() => {
  // Create a fresh temp directory for each test
  tempDir = mkdtempSync(join(tmpdir(), 'create-custom-report-test-'));
});

afterEach(() => {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true });
  }
});

it('prompts for the project name if none supplied', () => {
  const { stdout } = run([]);
  expect((stdout as string)?.includes('Project name:')).toBe(true);
});

it('asks to overwrite non-empty target directory', () => {
  createNonEmptyDir();
  const { stdout } = run([projectName], { cwd: tempDir });
  expect(
    (stdout as string)?.includes(
      `Target directory "${projectName}" is not empty.`
    )
  ).toBe(true);
});

it('successfully creates a project based on react-ts template', async () => {
  const title = uuid();
  const description = uuid();

  const args = [
    '--overwrite',
    '--skipAuth',
    '--title',
    title,
    '--description',
    description
  ];

  const { exitCode } = run([projectName, ...args], { cwd: tempDir });
  expect(exitCode).toBe(0);

  const projectDir = join(tempDir, projectName);
  const generatedFiles = getAllFiles(projectDir).sort();
  expect(generatedFiles).toEqual(expectedFiles);

  const pkg = getPackageJson(projectDir);
  expect(pkg.name).toEqual(projectName);
  expect(pkg.author).toBeUndefined();
  expect(pkg.description).toEqual(description);
  expect(pkg.version).toEqual('0.0.0');
  expect(pkg?.leanixReport?.id).toBeUndefined();
  expect(pkg?.leanixReport?.title).toEqual(title);
  expect(typeof pkg?.leanixReport.defaultConfig).toEqual('object');

  expect(existsSync(join(projectDir, '.vscode', 'mcp.json'))).toBe(true);
  expect(existsSync(join(projectDir, '.mcp.json'))).toBe(true);
});

it('omitting --title still prompts for it', () => {
  const { stdout } = run([projectName, '--skipAuth', '--description', uuid()], {
    cwd: tempDir
  });
  expect((stdout as string)?.includes('Report title')).toBe(true);
});

// ---------------------------------------------------------------------------
// G. --help prints usage reference and exits with code 0
// ---------------------------------------------------------------------------

it('--help prints usage and exits with code 0', () => {
  const { exitCode, stdout } = run(['--help']);

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

  // v1-only flags must NOT appear
  const removedFlags = [
    '--id',
    '--author',
    '--host',
    '--apitoken',
    '--packageName',
    '--v2',
    '--setupMcpServers'
  ];
  for (const flag of removedFlags) {
    expect((stdout as string)?.includes(flag)).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// H. Author and report ID are never prompted or written
// ---------------------------------------------------------------------------

it('does not prompt for author', () => {
  const { stdout } = run(
    [projectName, '--skipAuth', '--title', uuid(), '--description', uuid()],
    { cwd: tempDir }
  );
  expect((stdout as string)?.includes('Author of the report')).toBe(false);
});

it('does not prompt for report id', () => {
  const { stdout } = run(
    [projectName, '--skipAuth', '--title', uuid(), '--description', uuid()],
    { cwd: tempDir }
  );
  expect((stdout as string)?.includes('Unique id for this report')).toBe(false);
});
