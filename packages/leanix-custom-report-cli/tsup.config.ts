import { defineConfig } from 'tsup';

export default defineConfig({
  name: 'cli',
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  platform: 'node',
  clean: true,
  splitting: false,
  dts: false,
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "module"; const require = createRequire(import.meta.url);'
  }
});
