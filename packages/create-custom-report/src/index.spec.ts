import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirpSync, readdirSync, statSync, writeFileSync } from 'fs-extra';
import { generate as uuid } from 'short-uuid';
import pkg from '../package.json' with { type: 'json' };
import { parseTriStateBoolean } from './utils/parseTriStateBoolean';

const CLI_PATH = resolve(__dirname, '..', pkg.bin);
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

// Get all file names in a directory, recursively
const getAllFiles = (
  dirPath: string,
  arrayOfFiles: string[] = []
): string[] => {
  readdirSync(dirPath).forEach((file) => {
    statSync(`${dirPath}/${file}`).isDirectory()
      ? (arrayOfFiles = getAllFiles(`${dirPath}/${file}`, arrayOfFiles))
      : arrayOfFiles.push(file);
  });
  return arrayOfFiles;
};

const getPackageJson = (dirPath: string): any =>
  JSON.parse(readFileSync(join(dirPath, 'package.json')).toString());

// React TypeScript template plus 1 generated file: 'lxr.json'
// When --skipAuth is used, AGENTS.md and CLAUDE.md are excluded (they require mcpCustomReportsEnabled)
const templateFiles = [
  ...getAllFiles(resolve(CLI_PATH, '..', 'templates', 'react-ts')),
  'lxr.json'
]
  .filter((file) => file !== 'AGENTS.md' && file !== 'CLAUDE.md')
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

it('asks to overwrite non-empty current directory', () => {
  createNonEmptyDir();
  const projectDir = join(tempDir, projectName);
  const { stdout } = run(['.'], {
    cwd: projectDir,
    input: 'test-app\n',
    reject: false
  });
  expect((stdout as string)?.includes('Current directory is not empty.')).toBe(
    true
  );
});

it('successfully scaffolds a project based on react-ts template', async () => {
  const reportId = uuid();
  const author = uuid();
  const title = uuid();
  const description = uuid();
  const host = uuid();
  const apitoken = uuid();
  const proxyURL = uuid();

  const args = [
    '--overwrite',
    '--skipAuth',
    '--id',
    reportId,
    '--author',
    author,
    '--title',
    title,
    '--description',
    description,
    '--host',
    host,
    '--apitoken',
    apitoken,
    '--proxyURL',
    proxyURL
  ];

  const { stdout, stderr } = run([projectName, ...args], {
    cwd: tempDir
  });
  expect(typeof stderr).toEqual('string');

  const projectDir = join(tempDir, projectName);
  const generatedFiles = getAllFiles(projectDir).sort();

  // Assertions
  expect(
    (stdout as string)?.includes('Using React + TypeScript template')
  ).toBe(true);
  expect(generatedFiles).toEqual(templateFiles);

  const pkg = getPackageJson(projectDir);
  expect(pkg.name).toEqual(projectName);
  expect(pkg.author).toEqual(author);
  expect(pkg.description).toEqual(description);
  expect(pkg.version).toEqual('0.0.0');
  expect(pkg?.leanixReport?.id).toEqual(reportId);
  expect(pkg?.leanixReport?.title).toEqual(title);
  expect(typeof pkg?.leanixReport.defaultConfig).toEqual('object');
});

// ---------------------------------------------------------------------------
// parseTriStateBoolean unit tests
// ---------------------------------------------------------------------------

describe('parseTriStateBoolean', () => {
  it('returns true when --flag is present', () => {
    expect(parseTriStateBoolean(['--setupMcpServers'], 'setupMcpServers')).toBe(
      true
    );
  });

  it('returns false when --no-flag is present', () => {
    expect(
      parseTriStateBoolean(['--no-setupMcpServers'], 'setupMcpServers')
    ).toBe(false);
  });

  it('returns undefined when neither flag is present', () => {
    expect(
      parseTriStateBoolean(['--skipAuth', '--id', 'foo'], 'setupMcpServers')
    ).toBeUndefined();
  });

  it('prefers --flag over --no-flag when both present (first wins)', () => {
    // --flag appears first in the array
    expect(
      parseTriStateBoolean(
        ['--setupMcpServers', '--no-setupMcpServers'],
        'setupMcpServers'
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A. --packageName suppresses the package-name prompt
// ---------------------------------------------------------------------------

it('--packageName skips the package-name prompt and is used in package.json', () => {
  const customPkgName = 'my-custom-pkg';
  const args = [
    '--skipAuth',
    '--overwrite',
    '--id',
    uuid(),
    '--author',
    uuid(),
    '--title',
    uuid(),
    '--description',
    uuid(),
    '--host',
    uuid(),
    '--apitoken',
    uuid(),
    '--packageName',
    customPkgName
  ];

  const { stdout } = run([projectName, ...args], { cwd: tempDir });

  expect((stdout as string)?.includes('Package name:')).toBe(false);

  const pkg = getPackageJson(join(tempDir, projectName));
  expect(pkg.name).toEqual(customPkgName);
});

// ---------------------------------------------------------------------------
// C. --no-setupMcpServers produces no MCP config files
// ---------------------------------------------------------------------------

it('--no-setupMcpServers does not generate MCP config files', () => {
  const args = [
    '--skipAuth',
    '--overwrite',
    '--no-setupMcpServers',
    '--id',
    uuid(),
    '--author',
    uuid(),
    '--title',
    uuid(),
    '--description',
    uuid(),
    '--host',
    uuid(),
    '--apitoken',
    uuid()
  ];

  run([projectName, ...args], { cwd: tempDir });

  const projectDir = join(tempDir, projectName);
  expect(existsSync(join(projectDir, '.vscode', 'mcp.json'))).toBe(false);
  expect(existsSync(join(projectDir, '.mcp.json'))).toBe(false);
});

// ---------------------------------------------------------------------------
// D. Fully non-interactive invocation with all flags
// ---------------------------------------------------------------------------

it('fully non-interactive invocation succeeds with all flags supplied', () => {
  const reportId = uuid();
  const author = uuid();
  const title = uuid();
  const description = uuid();
  const customPkgName = 'full-non-interactive';
  const host = uuid();
  const apitoken = uuid();
  const proxyURL = uuid();

  const args = [
    '--skipAuth',
    '--overwrite',
    '--id',
    reportId,
    '--author',
    author,
    '--title',
    title,
    '--description',
    description,
    '--packageName',
    customPkgName,
    '--host',
    host,
    '--apitoken',
    apitoken,
    '--proxyURL',
    proxyURL
  ];

  const { exitCode, stdout } = run([projectName, ...args], { cwd: tempDir });

  expect(exitCode).toBe(0);

  // None of the prompt question strings should appear
  expect((stdout as string)?.includes('Project name:')).toBe(false);
  expect((stdout as string)?.includes('Package name:')).toBe(false);
  expect((stdout as string)?.includes('Unique id for this report')).toBe(false);
  expect((stdout as string)?.includes('Who is the author')).toBe(false);
  expect((stdout as string)?.includes('A title to be shown')).toBe(false);
  expect((stdout as string)?.includes('Description of your project')).toBe(
    false
  );
  expect((stdout as string)?.includes('Which host do you want')).toBe(false);
  expect((stdout as string)?.includes('API-Token for Authentication')).toBe(
    false
  );
  expect((stdout as string)?.includes('Are you behind a proxy?')).toBe(false);

  const projectDir = join(tempDir, projectName);
  const pkg = getPackageJson(projectDir);
  expect(pkg.name).toEqual(customPkgName);
  expect(pkg.author).toEqual(author);
  expect(pkg?.leanixReport?.id).toEqual(reportId);

  const lxrJson = JSON.parse(
    readFileSync(join(projectDir, 'lxr.json')).toString()
  );
  expect(lxrJson.host).toEqual(host);
  expect(lxrJson.apitoken).toEqual(apitoken);
  expect(lxrJson.proxyURL).toEqual(proxyURL);
});

// ---------------------------------------------------------------------------
// E. --proxyURL suppresses the "Are you behind a proxy?" toggle
// ---------------------------------------------------------------------------

it('--proxyURL suppresses the behind-a-proxy prompt', () => {
  // We need host + apitoken + proxyURL to trigger the suppression path.
  // Use --skipAuth so we do not actually connect.
  const args = [
    '--skipAuth',
    '--overwrite',
    '--id',
    uuid(),
    '--author',
    uuid(),
    '--title',
    uuid(),
    '--description',
    uuid(),
    '--host',
    'demo-eu.leanix.net',
    '--apitoken',
    uuid(),
    '--proxyURL',
    'http://proxy.example.com:8080'
  ];

  const { stdout } = run([projectName, ...args], { cwd: tempDir });

  expect((stdout as string)?.includes('Are you behind a proxy?')).toBe(false);
});

// ---------------------------------------------------------------------------
// F. Omitting a required flag still triggers its prompt (interactive fallback)
// ---------------------------------------------------------------------------

it('omitting --title still prompts for it', () => {
  // Provide everything except --title; the CLI will pause at that prompt.
  const { stdout } = run([
    projectName,
    '--skipAuth',
    '--id',
    uuid(),
    '--author',
    uuid(),
    '--description',
    uuid()
  ]);

  expect((stdout as string)?.includes('A title to be shown in LeanIX')).toBe(
    true
  );
});

// ---------------------------------------------------------------------------
// G. --help prints usage reference and exits with code 0
// ---------------------------------------------------------------------------

it('--help prints usage and exits with code 0', () => {
  const { exitCode, stdout } = run(['--help']);

  expect(exitCode).toBe(0);

  const flags = [
    '--id',
    '--author',
    '--title',
    '--description',
    '--packageName',
    '--host',
    '--apitoken',
    '--proxyURL',
    '--overwrite',
    '--skipAuth',
    '--setupMcpServers',
    '--help'
  ];
  for (const flag of flags) {
    expect((stdout as string)?.includes(flag)).toBe(true);
  }
});
