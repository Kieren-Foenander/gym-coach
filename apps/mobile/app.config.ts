import type { ExpoConfig } from "expo/config"

/**
 * One codebase, three installable apps:
 *   development   "Gym Dev": an Expo dev client that loads code from this machine
 *   preview       "Gym Preview": a standalone build for trying a branch
 *   production    "Gym": the real thing
 *
 * Set APP_VARIANT to choose. Each has its own identifier, so all three can sit on one phone.
 * None of this applies in Expo Go, which runs the code inside its own app.
 */

type AppVariant = "development" | "preview" | "production"

const resolveVariant = (value: string | undefined): AppVariant => {
  if (value === undefined || value === "") return "production"

  if (value === "development" || value === "preview" || value === "production") return value

  throw new Error("APP_VARIANT must be development, preview or production.")
}

const APP_VARIANT = resolveVariant(process.env.APP_VARIANT)

// The identifier the app is registered under with Apple and Google. Change it before the first store build if you want another.
const BASE_IDENTIFIER = process.env.GYM_APP_IDENTIFIER ?? "com.kierenfoenander.gym"

const VARIANTS = {
  development: { name: "Gym Dev", scheme: "gym-dev", identifier: `${BASE_IDENTIFIER}.dev`, icon: "./assets/icon-dev.png" },
  preview: { name: "Gym Preview", scheme: "gym-preview", identifier: `${BASE_IDENTIFIER}.preview`, icon: "./assets/icon.png" },
  production: { name: "Gym", scheme: "gym", identifier: BASE_IDENTIFIER, icon: "./assets/icon.png" },
} as const

const variant = VARIANTS[APP_VARIANT]

// Where the app looks for your account unless you type another address when signing in.
const DEFAULT_SERVER_URL = process.env.EXPO_PUBLIC_GYM_SERVER_URL ?? "https://gym.kfoenander98.workers.dev"

// A build for the end-to-end tests signs in to a server on the same machine over plain http, which an
// Android release build refuses unless allowed. Builds for the real server (https) stay refusing it.
const TEST_BUILD_PLUGINS: NonNullable<ExpoConfig["plugins"]> = DEFAULT_SERVER_URL.startsWith("http://")
  ? [["expo-build-properties", { android: { usesCleartextTraffic: true } }]]
  : []

const INK = "#08090b"
const ACCENT = "#d7ff3e"

const config: ExpoConfig = {
  name: variant.name,
  slug: "gym",
  version: "0.1.0",
  platforms: ["ios", "android"],
  scheme: variant.scheme,
  orientation: "portrait",
  icon: variant.icon,
  // The app has one look, the same dark one as the web app.
  userInterfaceStyle: "dark",
  backgroundColor: INK,
  ios: {
    bundleIdentifier: variant.identifier,
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      // The rest countdown on the Lock Screen and in the Dynamic Island.
      NSSupportsLiveActivities: true,
    },
  },
  android: {
    package: variant.identifier,
    adaptiveIcon: {
      backgroundColor: APP_VARIANT === "development" ? "#7dd3fc" : ACCENT,
      foregroundImage: "./assets/android-icon-foreground.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
  },
  plugins: [
    "expo-secure-store",
    "expo-sqlite",
    "expo-video",
    // Reads bodyweight, workouts, sleep and heart data from Apple Health. Gym never writes to Health.
    [
      "@kingstinct/react-native-healthkit",
      {
        NSHealthShareUsageDescription:
          "Gym reads your bodyweight, body fat, waist, workouts, heart rate, sleep, steps, VO2 max and the food you track to log them and to help your coach judge recovery and eating.",
        NSHealthUpdateUsageDescription: false,
        background: false,
      },
    ],
    [
      "expo-notifications",
      { icon: "./assets/notification-icon.png", color: ACCENT, defaultChannel: "rest" },
    ],
    [
      "expo-splash-screen",
      { image: "./assets/splash-icon.png", imageWidth: 160, resizeMode: "contain", backgroundColor: INK },
    ],
    // Adds the widget extension the rest countdown's Live Activity lives in. It has no Home Screen widgets yet.
    [
      "expo-widgets",
      {
        bundleIdentifier: `${variant.identifier}.widgets`,
        groupIdentifier: `group.${variant.identifier}`,
        widgets: [],
      },
    ],
    ...TEST_BUILD_PLUGINS,
  ],
  experiments: {
    reactCompiler: true,
  },
  extra: {
    appVariant: APP_VARIANT,
    defaultServerUrl: DEFAULT_SERVER_URL,
    // The EAS project builds and cloud simulator sessions run under.
    eas: { projectId: "40998394-874e-41ed-82c0-7977979091e5" },
  },
  owner: "kierenfoenander",
}

export default config
