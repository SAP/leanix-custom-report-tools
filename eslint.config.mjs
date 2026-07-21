import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/test-app/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/templates/**'
    ]
  },
  {
    // Node test helper preloaded via `node --import`; needs Node globals.
    files: ['packages/create-custom-report/test-helpers/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly' }
    }
  },
  {
    // Node scripts; need Node globals like `console` and `process`.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' }
    }
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-unused-expressions': 'off'
    }
  }
];
