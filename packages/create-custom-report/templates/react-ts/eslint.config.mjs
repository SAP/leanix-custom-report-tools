import antfu from '@antfu/eslint-config';

export default antfu({
  lessOpinionated: true,
  react: true,
  typescript: true,
  rules: {
    'no-console': 'warn'
  },
  stylistic: {
    overrides: {
      'style/comma-dangle': ['error', 'always-multiline'],
      'style/semi': ['error', 'always'],
      'style/jsx-one-expression-per-line': ['error', { allow: 'non-jsx' }]
    }
  }
});
