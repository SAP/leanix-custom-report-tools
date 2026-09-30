var path = require('path');
module.exports = {
  entry: './src/index.js',
  mode: 'development',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'report.[chunkhash].js'
  },
  module: { rules: [] },
  plugins: [],
  devServer: { server: 'https' }
};
