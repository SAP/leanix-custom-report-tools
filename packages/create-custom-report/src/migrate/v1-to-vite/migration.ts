// packages/create-custom-report/src/migrate/v1-to-vite/migration.ts
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import prompts from 'prompts';
import type { Migration } from '../registry';
import type { FrameworkId, MigrationSummary } from './transforms';
import {
  formatSummary,
  generateViteConfig,
  getAdapter,
  rewritePackageJson
} from './transforms';

// ── Framework detection ───────────────────────────────────────────────────────

export interface DetectionResult {
  framework: FrameworkId | null;
  ambiguous: boolean;
  signals: FrameworkId[];
}

export function detectFramework(pkg: Record<string, any>): DetectionResult {
  const deps: Record<string, string> = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {})
  };

  const signals: FrameworkId[] = [];
  if ('react' in deps || 'react-dom' in deps) signals.push('react');
  if ('vue' in deps) signals.push('vue');
  if ('@angular/core' in deps) signals.push('angular');

  if (signals.length === 0) {
    return { framework: 'vanilla', ambiguous: false, signals: [] };
  }
  if (signals.length === 1) {
    return { framework: signals[0], ambiguous: false, signals };
  }
  return { framework: null, ambiguous: true, signals };
}

// ── v1 report guard ───────────────────────────────────────────────────────────

export function isV1Report(pkg: Record<string, any>): boolean {
  if (pkg.leanixReportingCli) return true;
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const devDeps: Record<string, string> = pkg.devDependencies ?? {};
  return (
    '@leanix/reporting' in deps &&
    ('webpack' in devDeps || 'webpack-cli' in devDeps)
  );
}

// ── Orchestrator (in-place file I/O) ────────────────────────────────────────────

export function runV1Migration(
  targetDir: string,
  pkg: Record<string, any>,
  framework: FrameworkId
): MigrationSummary {
  const adapter = getAdapter(framework);
  const changedFiles: string[] = [];

  // 1. package.json
  const { pkg: newPkg, oldReportId } = rewritePackageJson(pkg, adapter);
  writeFileSync(
    join(targetDir, 'package.json'),
    JSON.stringify(newPkg, null, 2) + '\n'
  );
  changedFiles.push('package.json');

  // 2. vite.config.js
  writeFileSync(join(targetDir, 'vite.config.js'), generateViteConfig(adapter));
  changedFiles.push('vite.config.js');

  // 3. webpack.config.js — delete unconditionally; recovery is via git.
  let webpackDeleted = false;
  const webpackPath = join(targetDir, 'webpack.config.js');
  if (existsSync(webpackPath)) {
    rmSync(webpackPath);
    webpackDeleted = true;
    changedFiles.push('webpack.config.js');
  }

  return {
    framework,
    changedFiles,
    webpackDeleted,
    oldReportId,
    packageName: newPkg.name as string
  };
}

// ── Framework resolution (prompts on ambiguity) ─────────────────────────────────

async function resolveFramework(
  pkg: Record<string, any>
): Promise<FrameworkId> {
  const detection = detectFramework(pkg);
  if (!detection.ambiguous && detection.framework !== null) {
    return detection.framework;
  }
  const answer = await prompts({
    type: 'select',
    name: 'framework',
    message:
      'Multiple frameworks detected. Which framework does this report use?',
    choices: detection.signals.map((s) => ({ title: s, value: s }))
  });
  if (!answer.framework) {
    throw new Error('Migration cancelled');
  }
  return answer.framework as FrameworkId;
}

// ── The migration ───────────────────────────────────────────────────────────────

export const v1ToViteMigration: Migration = {
  id: 'v1-to-vite',
  // v1 detection: "has webpack ⇒ v1" for now. Once we stamp a schema/version
  // marker into package.json, check that marker here first and fall back to
  // this heuristic.
  appliesTo: (pkg) => isV1Report(pkg),
  run: async ({ targetDir, pkg }) => {
    const framework = await resolveFramework(pkg);
    const summary = runV1Migration(targetDir, pkg, framework);
    console.log(formatSummary(summary));
  }
};
