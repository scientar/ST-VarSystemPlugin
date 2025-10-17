const path = require("node:path");

module.exports = {
  entry: path.resolve(__dirname, "src/index.ts"),
  target: "node",
  mode: "production",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "index.js",
    libraryTarget: "commonjs2",
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  externalsPresets: { node: true },
  externals: {
    "better-sqlite3": "commonjs2 better-sqlite3",
  },
  devtool: "source-map",
};
