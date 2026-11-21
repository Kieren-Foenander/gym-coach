import { View } from "react-native"
import { formatHealthValue, HEALTH_METRIC_INFO, localDay, summariseHealth, type HealthMetric } from "~/domain/health"
import { Display, SectionTitle, Text } from "@/components/ui"
import { useCall } from "@/data/calls"

/** The numbers that say how recovered someone is. Activity and fitness are left to the coach. */
const SHOWN: ReadonlyArray<HealthMetric> = ["sleep", "restingHeartRate", "hrv", "steps"]

// Older than this and it says nothing about today.
const FRESH_DAYS = 2

const DAY_MS = 86_400_000

const dayLabel = (day: string, now: number) => {
  if (day === localDay(now)) return "Today"

  if (day === localDay(now - DAY_MS)) return "Yesterday"

  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })
}

/** Last night's sleep, resting heart rate, HRV and steps from Apple Health, next to what is usual. Hidden without data. */
export function RecoveryCard({ now }: { readonly now: number }) {
  const { data } = useCall("getHealth", {})
  const oldest = localDay(now - FRESH_DAYS * DAY_MS)

  const summary = summariseHealth(data?.daily ?? []).filter(
    (item) => SHOWN.includes(item.metric) && item.latestDay >= oldest,
  )

  if (summary.length === 0) return null

  return (
    <>
      <SectionTitle>Recovery</SectionTitle>
      <View className="flex-row flex-wrap gap-2">
        {summary.map((item) => {
          const info = HEALTH_METRIC_INFO[item.metric]
          // Today's steps are still adding up, so next to a whole day's usual they would always look low.
          const soFar = item.metric === "steps" && item.latestDay === localDay(now)

          return (
            <View key={item.metric} className="w-[48.5%] rounded-2xl bg-surface px-3 py-3">
              <Display numberOfLines={1} adjustsFontSizeToFit className="tabular-nums">
                {formatHealthValue(item.metric, item.latest)}
                {item.metric === "sleep" ? null : <Display className="text-base text-muted"> {info.unit}</Display>}
              </Display>
              <Text numberOfLines={1} className="pt-1 text-xs text-muted">
                {info.label} · {soFar ? "Today so far" : dayLabel(item.latestDay, now)}
              </Text>
              <Text numberOfLines={1} className="text-xs text-faint tabular-nums">
                {item.usual === null || soFar ? " " : `Usually ${formatHealthValue(item.metric, item.usual)}`}
              </Text>
            </View>
          )
        })}
      </View>
      <Text className="pt-2 text-sm text-faint">From Apple Health.</Text>
    </>
  )
}
