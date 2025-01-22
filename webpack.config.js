const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const dfxJson = require("./dfx.json");

// List of all aliases for canisters
const aliases = Object.entries(dfxJson.canisters).reduce(
  (acc, [name, _value]) => {
    // Get the network name, or `local` by default.
    const networkName = process.env["DFX_NETWORK"] || "local";
    const outputRoot = path.join(
      __dirname,
      ".dfx",
      networkName,
      "canisters",
      name
    );

    return {
      ...acc,
      ["dfx-generated/" + name]: path.join(outputRoot),
    };
  },
  {}
);

/**
 * Generate a webpack configuration for a canister.
 */
function generateWebpackConfig() {
  return {
    mode: "production",
    entry: {
      index: path.join(__dirname, "src", "frontend", "src", "index.js"),
    },
    devtool: "source-map",
    optimization: {
      minimize: true,
      minimizer: [new TerserPlugin()],
    },
    resolve: {
      extensions: [".js", ".ts", ".jsx", ".tsx"],
      fallback: {
        assert: require.resolve("assert/"),
        buffer: require.resolve("buffer/"),
        events: require.resolve("events/"),
        stream: require.resolve("stream-browserify/"),
        util: require.resolve("util/"),
      },
      alias: aliases,
    },
    output: {
      filename: "[name].js",
      path: path.join(__dirname, "dist", "frontend"),
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: path.join(__dirname, "src", "frontend", "src", "index.html"),
        filename: "index.html",
        cache: false,
        chunks: ["index"],
      }),
      new webpack.EnvironmentPlugin({
        NODE_ENV: "development",
        DFX_NETWORK: process.env.DFX_NETWORK || "local",
        CANISTER_ID_CANISTER_TRACKING_PLATFORM_BACKEND: dfxJson.canisters["canister-tracking-platform-backend"][process.env.DFX_NETWORK || "local"]?.canister_id,
      }),
      new webpack.ProvidePlugin({
        Buffer: [require.resolve("buffer/"), "Buffer"],
        process: require.resolve("process/browser"),
      }),
    ],
  };
}

module.exports = generateWebpackConfig();
