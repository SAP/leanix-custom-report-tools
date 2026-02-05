import antfu from '@antfu/eslint-config';

export default antfu({
  lessOpinionated: true,
  stylistic: {
    overrides: {
      'n/prefer-global/process': ['error', 'always'],
      'node/prefer-global/buffer': ['error', 'always'],
      'style/comma-dangle': ['error', 'never'],
      'style/semi': ['error', 'always'],
      'no-console': 'warn'
    }
  },
  ignores: ['**/test-app/**', '**/test-app']
});
