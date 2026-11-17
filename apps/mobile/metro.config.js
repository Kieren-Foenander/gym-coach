const path = require("node:path")
const { getDefaultConfig } = require("expo/metro-config")
const { withUniwindConfig } = require("uniwind/metro")

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname)

// The app shares the web app's plain logic: src/domain and src/format.ts at the repository root.
// Server code under src/server is only ever imported for its types, which never reach the bundle.
const sharedSource = path.resolve(__dirname, "../../src")
const ownSource = path.join(__dirname, "src")

config.watchFolders = [...new Set([...(config.watchFolders ?? []), sharedSource])]

const fallbackResolve = config.resolver.resolveRequest

// "~/" is the shared source, as it is in the web app. "@/" is this app's own source.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const target = moduleName.startsWith("~/")
    ? path.join(sharedSource, moduleName.slice(2))
    : moduleName.startsWith("@/")
      ? path.join(ownSource, moduleName.slice(2))
      : moduleName

  return (fallbackResolve ?? context.resolveRequest)(context, target, platform)
}

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
})
