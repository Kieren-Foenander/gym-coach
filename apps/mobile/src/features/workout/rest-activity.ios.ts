import Constants, { ExecutionEnvironment } from "expo-constants"
import type { LiveActivity } from "expo-widgets"
import type { RestActivityProps } from "./RestActivity"

/**
 * The rest countdown as a Live Activity, on the Lock Screen and in the Dynamic Island.
 * It needs the app's own build: Expo Go has no widget extension to draw it, so there this does nothing.
 */

export type RestCountdown = RestActivityProps

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient

let current: LiveActivity<RestActivityProps> | null = null

// Loaded on first use, and never in Expo Go, where the module behind it does not exist.
const factory = () => {
  const loaded: typeof import("./RestActivity") = require("./RestActivity")

  return loaded.default
}

export const endRestActivity = (): void => {
  const activity = current

  current = null

  if (activity) void activity.end("immediate").catch(() => undefined)
}

export const showRestActivity = (rest: RestCountdown): void => {
  if (inExpoGo) return

  try {
    // Once the rest has run out iOS marks the activity as out of date, and it then reads "Go".
    const staleAt = new Date(rest.endsAt)

    if (current) {
      void current.update(rest, staleAt).catch(() => undefined)

      return
    }

    current = factory().start(rest, undefined, staleAt)
  } catch {
    // Live Activities can be switched off in Settings. The notification and the countdown in the app still work.
    current = null
  }
}
