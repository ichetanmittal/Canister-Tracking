const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const dfxJson = require("./dfx.json");
const dotenv = require('dotenv');

// Load environment variables from .env file
const env = dotenv.config().parsed || {};

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
      publicPath: "/",
    },
    module: {
      rules: [
        {
          test: /\.(js|ts)x?$/,
          loader: "babel-loader",
          exclude: /node_modules/,
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: path.join(__dirname, "src", "frontend", "src", "index.html"),
        filename: "index.html",
        cache: false,
        chunks: ["index"],
      }),
      new webpack.EnvironmentPlugin({
        NODE_ENV: 'production',
        CANISTER_ID_INTERNET_IDENTITY: env.CANISTER_ID_INTERNET_IDENTITY || 'rdmx6-jaaaa-aaaaa-aaadq-cai',
        CANISTER_ID_FRONTEND: env.CANISTER_ID_FRONTEND || '4tutm-pyaaa-aaaag-at2ta-cai',
        CANISTER_ID_CANISTER_TRACKING_PLATFORM_BACKEND: env.CANISTER_ID_CANISTER_TRACKING_PLATFORM_BACKEND || '42xyq-zqaaa-aaaag-at2sq-cai',
        DFX_NETWORK: env.DFX_NETWORK || 'ic',
      }),
      new webpack.ProvidePlugin({
        Buffer: [require.resolve("buffer/"), "Buffer"],
        process: require.resolve("process/browser"),
      }),
    ],
  };
}

module.exports = generateWebpackConfig();
