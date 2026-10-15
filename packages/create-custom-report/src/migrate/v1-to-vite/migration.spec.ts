// packages/create-custom-report/src/migrate/v1-to-vite/migration.spec.ts
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  detectFramework,
  isV1Report,
  runV1Migration,
  v1ToViteMigration
} from './migration';

// ── detectFramework ──────────────────────────────────────────────────────────
describe('detectFramework', () => {
  it('returns vanilla when no framework deps present', () => {
    expect(detectFramework({ dependencies: { lodash: '^4' } })).toEqual({
      framework: 'vanilla',
      ambiguous: false,
      signals: []
    });
  });
  it('detects react from react-dom', () => {
    const r = detectFramework({ dependencies: { 'react-dom': '^19' } });
    expect(r.framework).toBe('react');
    expect(r.ambiguous).toBe(false);
  });
  it('detects vue', () => {
    expect(detectFramework({ dependencies: { vue: '^3' } }).framework).toBe(
      'vue'
    );
  });
  it('detects angular from @angular/core', () => {
    expect(
      detectFramework({ dependencies: { '@angular/core': '^18' } }).framework
    ).toBe('angular');
  });
  it('reads devDependencies too', () => {
    expect(
      detectFramework({ devDependencies: { react: '^19' } }).framework
    ).toBe('react');
  });
  it('flags ambiguity when multiple frameworks present', () => {
    const r = detectFramework({ dependencies: { react: '^19', vue: '^3' } });
    expect(r.framework).toBeNull();
    expect(r.ambiguous).toBe(true);
    expect(r.signals.sort()).toEqual(['react', 'vue']);
  });
});

// ── isV1Report ─────────────────────────────────────────────────────────────────
describe('isV1Report', () => {
  it('true when leanixReportingCli block present', () => {
    expect(isV1Report({ leanixReportingCli: { distPath: 'dist' } })).toBe(true);
  });
  it('true when @leanix/reporting + webpack present', () => {
    expect(
      isV1Report({
        dependencies: { '@leanix/reporting': '^0.4.148' },
        devDependencies: { webpack: '^5' }
      })
    ).toBe(true);
  });
  it('false when @leanix/reporting present but no webpack (already vite)', () => {
    expect(
      isV1Report({
        dependencies: { '@leanix/reporting': '^0.4.176' },
        devDependencies: { vite: '^8' }
      })
    ).toBe(false);
  });
  it('false for an unrelated project', () => {
    expect(isV1Report({ dependencies: { express: '^4' } })).toBe(false);
  });
});

// ── runV1Migration + v1ToViteMigration ──────────────────────────────────────────
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

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'migrate-test-'));
});
afterEach(() => {
  if (existsSync(dir)) rmSync(dir, { recursive: true });
});

describe('runV1Migration', () => {
  it('migrates a vanilla report: rewrites package.json, writes vite config, deletes webpack', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify(OLD_PKG, null, 2));
    writeFileSync(join(dir, 'webpack.config.js'), STOCK_WEBPACK);

    const summary = runV1Migration(dir, OLD_PKG, 'vanilla');

    expect(summary.framework).toBe('vanilla');
    expect(summary.oldReportId).toBe('custom.report.data.lix');
    expect(summary.packageName).toBe('lix-report-keyfacts');
    expect(summary.webpackDeleted).toBe(true);

    const newPkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    expect(newPkg.leanixReport.uploadVersion).toBe(2);
    expect(newPkg.devDependencies.vite).toBe('^8.1.3');

    const viteConfig = readFileSync(join(dir, 'vite.config.js'), 'utf-8');
    expect(viteConfig).toContain('plugins: [leanix()]');

    expect(existsSync(join(dir, 'webpack.config.js'))).toBe(false);
  });

  it('deletes webpack even when customized, leaving no backup file (recover via git)', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify(OLD_PKG, null, 2));
    writeFileSync(
      join(dir, 'webpack.config.js'),
      STOCK_WEBPACK.replace(
        'devServer: {}',
        'devServer: {}, resolve: { alias: {} }'
      )
    );

    const summary = runV1Migration(dir, OLD_PKG, 'vanilla');

    expect(summary.webpackDeleted).toBe(true);
    expect(existsSync(join(dir, 'webpack.config.js'))).toBe(false);
    expect(existsSync(join(dir, 'webpack.config.js.migrated-backup'))).toBe(
      false
    );
  });

  it('honors the given framework (react adds the react vite plugin devDep)', () => {
    const reactPkg = {
      ...OLD_PKG,
      dependencies: { ...OLD_PKG.dependencies, react: '^19' }
    };
    writeFileSync(join(dir, 'package.json'), JSON.stringify(reactPkg, null, 2));
    const summary = runV1Migration(dir, reactPkg, 'react');
    expect(summary.framework).toBe('react');
    const newPkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    expect(newPkg.devDependencies['@vitejs/plugin-react']).toBe('^6.0.3');
  });
});

describe('v1ToViteMigration', () => {
  it('appliesTo is true for a v1 report, false otherwise', () => {
    expect(v1ToViteMigration.appliesTo(OLD_PKG)).toBe(true);
    expect(
      v1ToViteMigration.appliesTo({ dependencies: { express: '^4' } })
    ).toBe(false);
  });

  it('run() prompts to disambiguate and migrates using the chosen framework', async () => {
    const ambiguous = {
      ...OLD_PKG,
      dependencies: { ...OLD_PKG.dependencies, react: '^19', vue: '^3' }
    };
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify(ambiguous, null, 2)
    );
    prompts.inject(['vue']); // answer the select prompt

    await v1ToViteMigration.run({ targetDir: dir, pkg: ambiguous });

    const viteConfig = readFileSync(join(dir, 'vite.config.js'), 'utf-8');
    expect(viteConfig).toContain('plugins: [vue(), leanix()]');
  });
});
