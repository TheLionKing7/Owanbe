/**
 * The phone app shares its rules with the web app: the scanner's cache and the pairing code live
 * in src/features/tickets and are imported from there. Metro therefore has to watch the repository
 * root and resolve react and react-native from this project only, so there is one copy of each.
 */
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
};

module.exports = config;
