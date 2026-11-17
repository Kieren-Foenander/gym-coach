import * as Notifications from "expo-notifications"
import { Platform } from "react-native"
import { storage } from "@/data/storage"

/**
 * The alert when a rest ends. It is a notification scheduled on the phone at the moment
 * the set is logged, so it arrives on time with the app closed, the phone locked, or no signal.
 */

const SOUND_KEY = "gym.restSound"
const CHANNEL = "rest"
const supported = Platform.OS !== "web"

let scheduledId: string | null = null

// Scheduling takes a moment. This says which request is the latest, so an older one that finishes late is withdrawn.
let latestRequest = 0

export const soundEnabled = (): boolean => storage.get(SOUND_KEY) !== "off"

export const setSoundEnabled = (enabled: boolean) => storage.set(SOUND_KEY, enabled ? "on" : "off")

/** Sets how the alert behaves while the app is open: the sound plays, and the app shows its own "rest over" bar instead of a banner. */
export const startRestAlerts = () => {
  if (!supported) return () => undefined

  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: soundEnabled(),
        shouldSetBadge: false,
      }),
  })

  if (Platform.OS === "android") {
    void Notifications.setNotificationChannelAsync(CHANNEL, {
      name: "Rest timer",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
    })
  }

  return () => undefined
}

const allowed = async () => {
  const current = await Notifications.getPermissionsAsync()

  if (current.granted) return true

  if (!current.canAskAgain) return false

  return (await Notifications.requestPermissionsAsync()).granted
}

export const cancelRestAlert = () => {
  latestRequest += 1

  const id = scheduledId

  scheduledId = null

  if (supported && id !== null) void Notifications.cancelScheduledNotificationAsync(id)
}

/** Schedules the alert for when the rest ends, replacing any earlier one. Asks to send notifications the first time. */
export const scheduleRestAlert = async (secondsFromNow: number) => {
  cancelRestAlert()

  if (!supported) return

  const request = latestRequest

  try {
    if (!(await allowed())) return

    const id = await Notifications.scheduleNotificationAsync({
      content: { title: "Rest over", body: "Time for your next set.", sound: soundEnabled() },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, Math.round(secondsFromNow)),
        channelId: CHANNEL,
      },
    })

    if (request === latestRequest) scheduledId = id
    else void Notifications.cancelScheduledNotificationAsync(id)
  } catch {
    // Without the alert the countdown on screen still works, so a workout is never blocked by this.
  }
}
