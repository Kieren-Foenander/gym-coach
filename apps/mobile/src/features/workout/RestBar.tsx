import * as Haptics from "expo-haptics"
import { useEffect, useState } from "react"
import { Pressable, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { REST_STEP_SECONDS, restElapsed } from "~/domain/rest"
import { testIds } from "~/domain/test-ids"
import { formatClock } from "~/format"
import { ChevronDownIcon, ChevronUpIcon } from "@/components/icons"
import { Button, Display, Eyebrow, Text } from "@/components/ui"
import { useNow } from "@/lib/useNow"
import { colors } from "@/theme"
import { setSoundEnabled, soundEnabled } from "./rest-alert"
import { adjustCurrentRest, clearRest, refreshRestAlert, setRestMinimised, useRest, useRestMinimised } from "./rest-timer"

/** How long the "rest over" message stays up. */
const REST_OVER_MS = 6000

/** Room to leave under the content while the full timer or the "Go" message is showing. */
const REST_BAR_SPACE = 150

/** Room to leave under the content while the timer is minimised to a strip. */
const REST_STRIP_SPACE = 76

/** How much room the content needs to leave at the bottom for the rest bar right now. */
export const useRestSpace = () => {
  const rest = useRest()
  const minimised = useRestMinimised()
  const now = useNow(rest !== null)

  if (rest === null || now - rest.endsAt >= REST_OVER_MS) return 0

  return minimised && now < rest.endsAt ? REST_STRIP_SPACE : REST_BAR_SPACE
}

/**
 * The countdown between sets, floating over the bottom of the workout, then a "Go" message when it runs out.
 * Minimised, it is a strip that fills up as the rest runs out, and a tap on it brings the full timer back.
 */
export function RestBar() {
  const insets = useSafeAreaInsets()
  const rest = useRest()
  const minimised = useRestMinimised()
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

  const fill = `${restElapsed(rest, now) * 100}%` as const

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
      ) : minimised ? (
        <Pressable
          testID={testIds.workout.restExpand}
          accessibilityRole="button"
          accessibilityLabel={`Rest, ${formatClock(left)} left. Show the timer`}
          onPress={() => setRestMinimised(false)}
          className="h-14 flex-row items-center gap-3 overflow-hidden rounded-full border border-white/10 bg-surface px-5"
        >
          <View className="absolute inset-y-0 left-0 bg-accent/20" style={{ width: fill }} />
          <Eyebrow className="text-xs text-accent">Rest</Eyebrow>
          <Display testID={testIds.workout.rest} accessibilityRole="timer" className="text-3xl tabular-nums">
            {formatClock(left)}
          </Display>
          <View className="ml-auto">
            <ChevronUpIcon size={20} color={colors.muted} />
          </View>
        </Pressable>
      ) : (
        <View className="overflow-hidden rounded-3xl border border-white/10 bg-surface">
          <View className="flex-row items-end justify-between gap-3 px-4 pt-3">
            <View>
              <Eyebrow className="text-xs text-accent">Rest</Eyebrow>
              <Display testID={testIds.workout.rest} accessibilityRole="timer" className="text-5xl tabular-nums">
                {formatClock(left)}
              </Display>
            </View>
            <View className="flex-row items-center gap-1">
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: sound }}
                onPress={toggleSound}
                className="min-h-11 justify-center px-1"
              >
                <Text className="text-sm font-semibold text-muted">
                  Sound: <Text className={sound ? "text-sm font-semibold text-accent" : "text-sm font-semibold"}>{sound ? "on" : "off"}</Text>
                </Text>
              </Pressable>
              <Pressable
                testID={testIds.workout.restMinimise}
                accessibilityRole="button"
                accessibilityLabel="Minimise the timer"
                hitSlop={4}
                onPress={() => setRestMinimised(true)}
                className="size-11 items-center justify-center rounded-full"
              >
                <ChevronDownIcon size={20} color={colors.muted} />
              </Pressable>
            </View>
          </View>
          {/* Three equal buttons on their own row, so they fit the narrowest phone. */}
          <View className="flex-row gap-1.5 px-4 pt-2 pb-3">
            <Button className="flex-1" testID={testIds.workout.restLess} accessibilityLabel="30 seconds less" onPress={() => adjustCurrentRest(-REST_STEP_SECONDS)}>
              −30s
            </Button>
            <Button className="flex-1" testID={testIds.workout.restMore} accessibilityLabel="30 seconds more" onPress={() => adjustCurrentRest(REST_STEP_SECONDS)}>
              +30s
            </Button>
            <Button className="flex-1" onPress={clearRest}>
              Skip
            </Button>
          </View>
          {/* Fills up as the rest runs out, the same as the minimised strip. */}
          <View className="h-1 bg-raised">
            <View className="h-full bg-accent" style={{ width: fill }} />
          </View>
        </View>
      )}
    </View>
  )
}
