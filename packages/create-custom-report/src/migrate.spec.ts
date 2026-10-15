import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../test-helpers/cli-runner';

let dir: string;

const OLD_PKG = {
  name: 'lix-report-keyfacts',
  version: '1.0.0',
  description: 'dashboard',
  leanixReport: {
    id: 'custom.report.data.lix',
    title: 'Key Facts',
    defaultConfig: {}
  },
  leanixReportingCli: { distPath: 'dist' },
  scripts: { build: 'webpack', start: 'lxr start' },
  dependencies: { '@leanix/reporting': '^0.4.148' },
  devDependencies: { webpack: '^5', 'webpack-cli': '^5' }
};

const STOCK_WEBPACK = `module.exports = {
  entry: './src/index.js', mode: 'development', output: {},
  module: { rules: [] }, plugins: [], devServer: {}
};`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'migrate-cli-test-'));
});
afterEach(() => {
  if (existsSync(dir)) rmSync(dir, { recursive: true });
});

describe('migrate subcommand', () => {
  it('migrates a vanilla report in place and prints the identity warning', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify(OLD_PKG, null, 2));
    writeFileSync(join(dir, 'webpack.config.js'), STOCK_WEBPACK);

    // argv: ['migrate', '.'] with cwd = dir
    const { exitCode, stdout } = runCli(['migrate', '.'], dir);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('custom.report.data.lix');
    expect(stdout).toContain('npm install');

    const newPkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    expect(newPkg.leanixReport.uploadVersion).toBe(2);
    expect(existsSync(join(dir, 'vite.config.js'))).toBe(true);
    expect(existsSync(join(dir, 'webpack.config.js'))).toBe(false);
  });

  it('exits non-zero with a friendly message for a non-v1 project', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { express: '^4' } }, null, 2)
    );

    const { exitCode, stdout, stderr } = runCli(['migrate', '.'], dir);

    expect(exitCode).toBe(1);
    expect(`${stdout}${stderr}`.toLowerCase()).toContain('not a v1');
  });
});
