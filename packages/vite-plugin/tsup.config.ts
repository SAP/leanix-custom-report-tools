import { defineConfig } from 'tsup';

export default defineConfig([
  {
    name: 'vite-plugin',
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    platform: 'node',
    clean: true,
    splitting: false,
    dts: true,
    esbuildOptions: (options, context) => {
      if (context.format === 'cjs') {
        // Flatten the default export onto module.exports for the CommonJS
        // build only. Applying this footer to the ESM output produces an
        // invalid ES module (a stray `module.exports` alongside real `export`
        // statements), which breaks any ESM consumer of the plugin.
        // @see https://github.com/evanw/esbuild/issues/1182#issuecomment-1011414271
        options.footer = {
          js: 'module.exports = module.exports.default;'
        };
      }
      if (context.format === 'esm') {
        // Bundled dependencies use dynamic `require()`, which is undefined in a
        // native ES module. Re-create it from import.meta.url so those calls
        // resolve at runtime instead of hitting esbuild's throwing shim.
        options.banner = {
          js: "import { createRequire as __lxrCreateRequire } from 'module'; const require = __lxrCreateRequire(import.meta.url);"
        };
      }
    }
  },
  {
    name: 'cli',
    entry: { cli: 'src/cli.ts' },
    format: ['cjs'],
    platform: 'node',
    clean: false,
    splitting: false,
    dts: false,
    banner: { js: '#!/usr/bin/env node' }
  }
]);
