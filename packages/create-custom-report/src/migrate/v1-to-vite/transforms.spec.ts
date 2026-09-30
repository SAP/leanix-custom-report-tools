// packages/create-custom-report/src/migrate/v1-to-vite/transforms.spec.ts
import { describe, expect, it } from 'vitest';
import {
  formatSummary,
  generateViteConfig,
  getAdapter,
  rewritePackageJson,
  type MigrationSummary
} from './transforms';

// ── adapters ──────────────────────────────────────────────────────────────────

describe('framework adapters', () => {
  it('vanilla has no framework plugin and no extra deps', () => {
    const a = getAdapter('vanilla');
    expect(a.pluginImport).toBeNull();
    expect(a.pluginCall).toBeNull();
    expect(a.devDeps).toEqual({});
    expect(a.deps).toEqual({});
  });

  it('react adapter carries the vite react plugin as a devDep', () => {
    const a = getAdapter('react');
    expect(a.pluginImport).toBe("import react from '@vitejs/plugin-react';");
    expect(a.pluginCall).toBe('react()');
    expect(a.devDeps['@vitejs/plugin-react']).toBe('^6.0.3');
  });

  it('vue adapter carries the vite vue plugin as a devDep', () => {
    const a = getAdapter('vue');
    expect(a.pluginCall).toBe('vue()');
    expect(a.devDeps['@vitejs/plugin-vue']).toBe('^6.0.0');
  });

  it('angular adapter carries the analog vite plugin as a devDep', () => {
    const a = getAdapter('angular');
    expect(a.pluginCall).toBe('angular()');
    expect(a.devDeps['@analogjs/vite-plugin-angular']).toBe('^1.10.0');
  });
});

// ── rewritePackageJson ────────────────────────────────────────────────────────

const OLD_PKG = {
  name: 'lix-report-keyfacts',
  version: '1.0.0',
  description: 'dashboard about key facts',
  leanixReport: {
    id: 'custom.report.data.lix',
    title: 'Key Facts and Data Quality',
    defaultConfig: {}
  },
  leanixReportingCli: { distPath: 'dist', buildCommand: 'webpack' },
  scripts: { dev: 'webpack serve', build: 'webpack', start: 'lxr start' },
  dependencies: { '@leanix/reporting': '^0.4.148', lodash: '^4.17.21' },
  devDependencies: {
    webpack: '^5.104.1',
    'webpack-cli': '^5.1.4',
    'babel-loader': '^9.2.1',
    '@babel/core': '^7.25.8'
  }
};

describe('rewritePackageJson', () => {
  it('captures the old report id and drops it from the new block', () => {
    const { pkg, oldReportId } = rewritePackageJson(
      OLD_PKG,
      getAdapter('vanilla')
    );
    expect(oldReportId).toBe('custom.report.data.lix');
    expect(pkg.leanixReport.id).toBeUndefined();
  });

  it('produces new leanixReport block with uploadVersion 2', () => {
    const { pkg } = rewritePackageJson(OLD_PKG, getAdapter('vanilla'));
    expect(pkg.leanixReport).toEqual({
      title: 'Key Facts and Data Quality',
      aiAssisted: false,
      defaultConfig: {},
      uploadVersion: 2
    });
  });

  it('removes the leanixReportingCli block', () => {
    const { pkg } = rewritePackageJson(OLD_PKG, getAdapter('vanilla'));
    expect(pkg.leanixReportingCli).toBeUndefined();
  });

  it('adds vite + leanix vite-plugin, leaves other deps untouched', () => {
    const { pkg } = rewritePackageJson(OLD_PKG, getAdapter('vanilla'));
    expect(pkg.devDependencies.vite).toBe('^8.1.3');
    expect(pkg.devDependencies['@sap/vite-plugin-leanix-custom-report']).toBe(
      '^9.0.3'
    );
    expect(pkg.devDependencies.webpack).toBe('^5.104.1');
    expect(pkg.dependencies.lodash).toBe('^4.17.21');
  });

  it('rewrites scripts to the vite set', () => {
    const { pkg } = rewritePackageJson(OLD_PKG, getAdapter('vanilla'));
    expect(pkg.scripts).toEqual({
      dev: 'vite',
      build: 'vite build',
      upload: 'vite build --mode upload',
      login: 'lxr login',
      logout: 'lxr logout'
    });
  });

  it('returns null oldReportId when leanixReport has no id', () => {
    const { oldReportId } = rewritePackageJson(
      { ...OLD_PKG, leanixReport: { title: 'Key Facts', defaultConfig: {} } },
      getAdapter('vanilla')
    );
    expect(oldReportId).toBeNull();
  });

  it('preserves existing defaultConfig', () => {
    const { pkg } = rewritePackageJson(
      {
        ...OLD_PKG,
        leanixReport: {
          ...OLD_PKG.leanixReport,
          defaultConfig: { someKey: 'someValue' }
        }
      },
      getAdapter('vanilla')
    );
    expect(pkg.leanixReport.defaultConfig).toEqual({ someKey: 'someValue' });
  });

  it('adds react vite plugin devDep, leaves existing runtime versions alone', () => {
    const { pkg } = rewritePackageJson(
      {
        ...OLD_PKG,
        dependencies: {
          ...OLD_PKG.dependencies,
          react: '^19',
          'react-dom': '^19'
        }
      },
      getAdapter('react')
    );
    expect(pkg.devDependencies['@vitejs/plugin-react']).toBe('^6.0.3');
    expect(pkg.dependencies.react).toBe('^19');
  });

  it('adds adapter deps not already present, leaves existing versions alone', () => {
    const { pkg } = rewritePackageJson(
      {
        ...OLD_PKG,
        dependencies: { ...OLD_PKG.dependencies, 'some-lib': '^1.0.0' }
      },
      {
        ...getAdapter('vanilla'),
        deps: { 'some-lib': '^2.0.0', 'new-lib': '^1.0.0' }
      }
    );
    expect(pkg.dependencies['some-lib']).toBe('^1.0.0');
    expect(pkg.dependencies['new-lib']).toBe('^1.0.0');
  });
});

// ── generateViteConfig ────────────────────────────────────────────────────────

describe('generateViteConfig', () => {
  it('vanilla: only the leanix plugin', () => {
    const out = generateViteConfig(getAdapter('vanilla'));
    expect(out).toContain(
      "import leanix from '@sap/vite-plugin-leanix-custom-report';"
    );
    expect(out).toContain('plugins: [leanix()]');
    expect(out).not.toContain('@vitejs/plugin-react');
  });

  it('react: react plugin before leanix', () => {
    const out = generateViteConfig(getAdapter('react'));
    expect(out).toContain("import react from '@vitejs/plugin-react';");
    expect(out).toContain('plugins: [react(), leanix()]');
  });

  it('vue: vue plugin before leanix', () => {
    const out = generateViteConfig(getAdapter('vue'));
    expect(out).toContain("import vue from '@vitejs/plugin-vue';");
    expect(out).toContain('plugins: [vue(), leanix()]');
  });

  it('angular: analog plugin before leanix', () => {
    const out = generateViteConfig(getAdapter('angular'));
    expect(out).toContain(
      "import angular from '@analogjs/vite-plugin-angular';"
    );
    expect(out).toContain('plugins: [angular(), leanix()]');
  });

  it('output ends with a trailing newline', () => {
    expect(generateViteConfig(getAdapter('vanilla')).endsWith('\n')).toBe(true);
  });
});

// ── formatSummary ───────────────────────────────────────────────────────────────

describe('formatSummary', () => {
  const BASE: MigrationSummary = {
    framework: 'vanilla',
    changedFiles: ['package.json', 'vite.config.js', 'webpack.config.js'],
    webpackDeleted: true,
    oldReportId: 'custom.report.data.lix',
    packageName: 'lix-report-keyfacts'
  };

  it('includes the id→name upload-identity warning when oldReportId is set', () => {
    const out = formatSummary(BASE);
    expect(out).toContain('custom.report.data.lix');
    expect(out).toContain('lix-report-keyfacts');
    expect(out.toLowerCase()).toContain('upload');
  });

  it('omits the identity warning when there was no old id', () => {
    expect(formatSummary({ ...BASE, oldReportId: null })).not.toContain(
      'custom.report.data.lix'
    );
  });

  it('mentions git recovery when webpack was deleted', () => {
    expect(formatSummary(BASE)).toContain('restore the file from git');
  });

  it('always prints next steps', () => {
    const out = formatSummary(BASE);
    expect(out).toContain('npm install');
    expect(out).toContain('npm run dev');
  });
});
