import { defineConfig } from 'tsup';

export default defineConfig({
  name: 'create-custom-report',
  entry: ['src/index.ts'],
  format: ['cjs'],
  clean: true,
  splitting: false
});
