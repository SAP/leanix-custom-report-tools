export default {
  presets: [
    '@babel/preset-typescript',
    [
      '@babel/preset-env',
      {
        targets: {
          node: '18.0.0'
        }
      }
    ]
  ]
};
