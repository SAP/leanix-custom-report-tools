import antfu from '@antfu/eslint-config';

export default antfu({
  lessOpinionated: true,
  react: true,
  typescript: true,
  stylistic: false,
  rules: {
    'no-console': 'warn'
  }
});
