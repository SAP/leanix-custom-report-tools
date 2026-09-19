// packages/create-custom-report/src/migrate/v1-to-vite/fixtures.spec.ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { copySync } from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FrameworkId } from './transforms';
import { detectFramework, runV1Migration } from './migration';

const FIXTURES_ROOT = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'test-fixtures',
  'v1-to-vite'
);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'migrate-fixtures-'));
});
afterEach(() => {
  if (existsSync(dir)) rmSync(dir, { recursive: true });
});

const cases: Array<{ name: FrameworkId; pluginCall: string | null }> = [
  { name: 'vanilla', pluginCall: null },
  { name: 'react', pluginCall: 'react()' },
  { name: 'vue', pluginCall: 'vue()' },
  { name: 'angular', pluginCall: 'angular()' }
];

describe('fixtures migrate correctly for all four frameworks', () => {
  for (const c of cases) {
    it(`${c.name} fixture`, () => {
      const work = join(dir, c.name);
      copySync(join(FIXTURES_ROOT, c.name), work);

      const pkg = JSON.parse(readFileSync(join(work, 'package.json'), 'utf-8'));
      const framework = detectFramework(pkg).framework as FrameworkId;
      const summary = runV1Migration(work, pkg, framework);
      expect(summary.framework).toBe(c.name);

      const viteConfig = readFileSync(join(work, 'vite.config.js'), 'utf-8');
      if (c.pluginCall) {
        expect(viteConfig).toContain(`plugins: [${c.pluginCall}, leanix()]`);
      } else {
        expect(viteConfig).toContain('plugins: [leanix()]');
      }

      const migrated = JSON.parse(
        readFileSync(join(work, 'package.json'), 'utf-8')
      );
      expect(migrated.leanixReport.uploadVersion).toBe(2);
      expect(
        migrated.devDependencies['@sap/vite-plugin-leanix-custom-report']
      ).toBe('^9.0.3');
    });
  }
});
