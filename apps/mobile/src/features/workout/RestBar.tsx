import * as Haptics from "expo-haptics"
import { useEffect, useState } from "react"
import { Pressable, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { formatClock } from "~/format"
import { Button, Display, Eyebrow, Text } from "@/components/ui"
import { useNow } from "@/lib/useNow"
import { setSoundEnabled, soundEnabled } from "./rest-alert"
import { clearRest, extendRest, refreshRestAlert, useRest } from "./rest-timer"

/** How long the "rest over" message stays up. */
const REST_OVER_MS = 6000

/** Room to leave under the content while the bar is showing. */
export const REST_BAR_SPACE = 150

/** Whether the rest bar is on screen right now, so the content under it can leave room. */
export const useRestShowing = () => {
  const rest = useRest()
  const now = useNow(rest !== null)

  return rest !== null && now - rest.endsAt < REST_OVER_MS
}

/** The countdown between sets, floating over the bottom of the workout, then a "Go" message when it runs out. */
export function RestBar() {
  const insets = useSafeAreaInsets()
  const rest = useRest()
  const now = useNow(rest !== null)
  const [sound, setSound] = useState(soundEnabled)
  const left = rest === null ? 0 : Math.ceil((rest.endsAt - now) / 1000)
  const over = rest !== null && left <= 0
  const stale = rest !== null && now - rest.endsAt >= REST_OVER_MS

  useEffect(() => {
    if (over) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }, [over])

  // The message has had its time. Clearing the rest also takes the countdown off the Lock Screen.
  useEffect(() => {
    if (stale) clearRest()
  }, [stale])

  if (rest === null || stale) return null

  const toggleSound = () => {
    setSoundEnabled(!sound)
    setSound(!sound)
    refreshRestAlert()
  }

  return (
    <View pointerEvents="box-none" className="absolute inset-x-0 px-4" style={{ bottom: Math.max(insets.bottom, 12) }}>
      {over ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Rest over. Go. Tap to dismiss."
          onPress={clearRest}
          className="flex-row items-center justify-between rounded-3xl bg-accent px-5 py-4"
        >
          <View>
            <Eyebrow className="text-xs text-accent-ink">Rest over</Eyebrow>
            <Display className="text-4xl text-accent-ink">Go</Display>
          </View>
          <Text className="text-sm font-semibold text-accent-ink">Tap to dismiss</Text>
        </Pressable>
      ) : (
        <View className="overflow-hidden rounded-3xl border border-white/10 bg-surface">
          <View className="flex-row items-center justify-between gap-3 px-4 pt-3">
            <View>
              <Eyebrow className="text-xs text-accent">Rest</Eyebrow>
              <Display accessibilityRole="timer" className="text-5xl tabular-nums">
                {formatClock(left)}
              </Display>
            </View>
            <View className="flex-row gap-2">
              <Button onPress={() => extendRest(30)}>+30s</Button>
              <Button onPress={clearRest}>Skip</Button>
            </View>
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: sound }}
            onPress={toggleSound}
            className="min-h-11 justify-center px-4"
          >
            <Text className="text-sm font-semibold text-muted">
              Sound at the end: <Text className={sound ? "text-sm font-semibold text-accent" : "text-sm font-semibold"}>{sound ? "on" : "off"}</Text>
            </Text>
          </Pressable>
          <View className="h-1 bg-raised">
            <View className="h-full bg-accent" style={{ width: `${Math.min(100, (left / rest.total) * 100)}%` }} />
          </View>
        </View>
      )}
    </View>
  )
}
