import type { ExecaSyncReturnValue, SyncOptions } from 'execa';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execaCommandSync } from 'execa';
import { mkdirpSync, readdirSync, statSync, writeFileSync } from 'fs-extra';
import { generate as uuid } from 'short-uuid';
import pkg from '../package.json' with { type: 'json' };

const CLI_PATH = resolve(__dirname, '..', pkg.bin);
const projectName = 'test-app';
let tempDir: string;

const run = (args: string[], options: SyncOptions = {}): ExecaSyncReturnValue => {
  return execaCommandSync(`node ${CLI_PATH} ${args.join(' ')}`, options);
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
const getAllFiles = (dirPath: string, arrayOfFiles: string[] = []): string[] => {
  readdirSync(dirPath).forEach((file) => {
    statSync(`${dirPath}/${file}`).isDirectory()
      ? (arrayOfFiles = getAllFiles(`${dirPath}/${file}`, arrayOfFiles))
      : arrayOfFiles.push(file);
  });
  return arrayOfFiles;
};

const getPackageJson = (dirPath: string): any => JSON.parse(readFileSync(join(dirPath, 'package.json')).toString());

// React TypeScript template plus 1 generated file: 'lxr.json'
// When --skipAuth is used, AGENTS.md and CLAUDE.md are excluded (they require mcpCustomReportsEnabled)
const templateFiles = [...getAllFiles(resolve(CLI_PATH, '..', 'templates', 'react-ts')), 'lxr.json']
  .filter(file => file !== 'AGENTS.md' && file !== 'CLAUDE.md')
  .map(file => (file === '_gitignore' ? '.gitignore' : file))
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
  expect((stdout as string)?.includes(`Target directory "${projectName}" is not empty.`)).toBe(true);
});

it('asks to overwrite non-empty current directory', () => {
  createNonEmptyDir();
  const projectDir = join(tempDir, projectName);
  const { stdout } = run(['.'], {
    cwd: projectDir,
    input: 'test-app\n',
    reject: false
  });
  expect((stdout as string)?.includes('Current directory is not empty.')).toBe(true);
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
  expect((stdout as string)?.includes('Using React + TypeScript template')).toBe(true);
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
