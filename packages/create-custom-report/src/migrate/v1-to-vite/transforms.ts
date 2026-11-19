// packages/create-custom-report/src/migrate/v1-to-vite/transforms.ts

// ── Framework adapters ────────────────────────────────────────────────────────

export type FrameworkId = 'vanilla' | 'react' | 'vue' | 'angular';

export interface FrameworkAdapter {
  id: FrameworkId;
  pluginImport: string | null;
  pluginCall: string | null;
  deps: Record<string, string>;
  devDeps: Record<string, string>;
}

const ADAPTERS: Record<FrameworkId, FrameworkAdapter> = {
  vanilla: {
    id: 'vanilla',
    pluginImport: null,
    pluginCall: null,
    deps: {},
    devDeps: {}
  },
  react: {
    id: 'react',
    pluginImport: "import react from '@vitejs/plugin-react';",
    pluginCall: 'react()',
    deps: {},
    devDeps: { '@vitejs/plugin-react': '^6.0.3' }
  },
  vue: {
    id: 'vue',
    pluginImport: "import vue from '@vitejs/plugin-vue';",
    pluginCall: 'vue()',
    deps: {},
    devDeps: { '@vitejs/plugin-vue': '^6.0.0' }
  },
  angular: {
    id: 'angular',
    pluginImport: "import angular from '@analogjs/vite-plugin-angular';",
    pluginCall: 'angular()',
    deps: {},
    devDeps: { '@analogjs/vite-plugin-angular': '^1.10.0' }
  }
};

export function getAdapter(id: FrameworkId): FrameworkAdapter {
  return ADAPTERS[id];
}

// ── package.json rewrite ──────────────────────────────────────────────────────

const VITE_VERSION = '^8.1.3';
const VITE_PLUGIN_VERSION = '^9.0.3';

const NEW_SCRIPTS = {
  dev: 'vite',
  build: 'vite build',
  upload: 'vite build --mode upload',
  login: 'lxr login',
  logout: 'lxr logout'
};

export interface RewriteResult {
  pkg: Record<string, any>;
  oldReportId: string | null;
}

export function rewritePackageJson(
  oldPkg: Record<string, any>,
  adapter: FrameworkAdapter
): RewriteResult {
  const pkg: Record<string, any> = JSON.parse(JSON.stringify(oldPkg));
  const oldReportId: string | null = pkg.leanixReport?.id ?? null;

  delete pkg.leanixReportingCli;

  // Merge vite deps in — leave everything else (including old webpack deps) alone
  pkg.devDependencies = { ...(pkg.devDependencies ?? {}) };
  pkg.devDependencies.vite = VITE_VERSION;
  pkg.devDependencies['@sap/vite-plugin-leanix-custom-report'] =
    VITE_PLUGIN_VERSION;
  for (const [name, version] of Object.entries(adapter.devDeps)) {
    if (!(name in pkg.devDependencies)) pkg.devDependencies[name] = version;
  }

  pkg.dependencies = { ...(pkg.dependencies ?? {}) };
  for (const [name, version] of Object.entries(adapter.deps)) {
    if (!(name in pkg.dependencies)) pkg.dependencies[name] = version;
  }

  pkg.scripts = { ...NEW_SCRIPTS };

  pkg.leanixReport = {
    title: pkg.leanixReport?.title ?? '',
    aiAssisted: false,
    defaultConfig: pkg.leanixReport?.defaultConfig ?? {},
    uploadVersion: 2
  };

  return { pkg, oldReportId };
}

// ── vite.config.js generation ─────────────────────────────────────────────────

export function generateViteConfig(adapter: FrameworkAdapter): string {
  const imports: string[] = [
    "import leanix from '@sap/vite-plugin-leanix-custom-report';"
  ];
  if (adapter.pluginImport) imports.push(adapter.pluginImport);
  imports.push("import { defineConfig } from 'vite';");

  const pluginCalls = adapter.pluginCall
    ? `${adapter.pluginCall}, leanix()`
    : 'leanix()';

  return `${imports.join('\n')}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [${pluginCalls}]
});
`;
}

// ── Migration summary ─────────────────────────────────────────────────────────

export interface MigrationSummary {
  framework: FrameworkId;
  changedFiles: string[];
  webpackDeleted: boolean;
  oldReportId: string | null;
  packageName: string;
}

export function formatSummary(summary: MigrationSummary): string {
  const lines: string[] = [];

  lines.push(`Migrated to Vite (framework: ${summary.framework}).`);
  lines.push('');
  lines.push('Changed files:');
  for (const f of summary.changedFiles) lines.push(`  - ${f}`);
  lines.push('');

  if (summary.webpackDeleted) {
    lines.push(
      'Removed webpack.config.js. If you had build customizations there, restore the file from git and port them to vite.config.js manually.'
    );
  }

  if (summary.oldReportId !== null) {
    lines.push('');
    lines.push('⚠️  Upload identity changed.');
    lines.push(
      `   Previously two uploads were matched by leanixReport.id ("${summary.oldReportId}").`
    );
    lines.push(
      `   Now they are matched by the package name ("${summary.packageName}").`
    );
    lines.push(
      '   Make sure the package name is what you want before uploading, or you may fork/overwrite report versions.'
    );
  }

  lines.push('');
  lines.push('Next steps:');
  lines.push('  npm install');
  lines.push(
    '  npm run dev   # then verify the report in the SAP LeanIX shell'
  );
  lines.push('');

  return lines.join('\n');
}
