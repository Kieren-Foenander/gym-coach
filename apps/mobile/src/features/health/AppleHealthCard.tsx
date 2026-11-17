import { View } from "react-native"
import { HEALTH_BACKFILL_DAYS } from "~/domain/health"
import { Button, Card, ErrorNote, Text } from "@/components/ui"
import { useNow } from "@/lib/useNow"
import { healthKitAvailable } from "./apple-health"
import { connectHealth, disconnectHealth, syncHealth, useHealthSync, type HealthImported } from "./health-sync"

const WHAT_COMES_IN = [
  "Bodyweight, body fat and waist, from a smart scale or the Health app",
  "Runs, rides, swims and walks from your Apple Watch or other apps, logged as cardio",
  "Heart rate and calories for workouts you also tracked on your watch",
  "Sleep, resting heart rate, HRV, steps and VO2 max, for your coach to judge recovery",
] as const

const ago = (time: number, now: number) => {
  const minutes = Math.max(0, Math.round((now - time) / 60_000))

  if (minutes < 1) return "just now"

  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.round(minutes / 60)

  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const describeImport = (imported: HealthImported) =>
  [
    imported.measurements > 0 ? plural(imported.measurements, "measurement", "measurements") : null,
    imported.workouts > 0 ? plural(imported.workouts, "workout", "workouts") : null,
  ]
    .flatMap((part) => (part === null ? [] : [part]))
    .join(" and ")

/** Connect Apple Health, see when it last synced, sync by hand or stop. Only shown on an iPhone. */
export function AppleHealthCard() {
  const health = useHealthSync()
  const now = useNow()

  if (!healthKitAvailable()) {
    return (
      <Card>
        <Text className="text-muted">
          Apple Health needs the app’s own build of Gym. It does not work in Expo Go, or on a phone without the Health app.
        </Text>
      </Card>
    )
  }

  if (!health.connected) {
    return (
      <Card>
        <Text className="pb-3">Bring in what your iPhone and Apple Watch already record:</Text>
        <View className="gap-2 pb-4">
          {WHAT_COMES_IN.map((line) => (
            <View key={line} className="flex-row gap-2">
              <Text className="w-3 font-semibold text-accent">·</Text>
              <Text className="flex-1 text-muted">{line}</Text>
            </View>
          ))}
        </View>
        <Text className="pb-4 text-sm text-faint">
          The first sync reaches back {HEALTH_BACKFILL_DAYS} days. Gym only reads from Health and never changes anything there.
        </Text>
        <ErrorNote message={health.error} />
        <Button variant="primary" onPress={() => void connectHealth()}>
          Connect Apple Health
        </Button>
      </Card>
    )
  }

  const status = health.syncing
    ? "Syncing…"
    : health.syncedAt === null
      ? "Not synced yet"
      : `Synced ${ago(health.syncedAt, now)}`

  const lastImport = health.lastImport === null ? "" : describeImport(health.lastImport)

  return (
    <Card className="gap-3">
      <View>
        <Text className="font-semibold">{status}</Text>
        {lastImport === "" ? null : <Text className="text-sm text-muted">Last brought in {lastImport}.</Text>}
        <Text className="pt-1 text-sm text-faint">
          It syncs whenever you open the app. To choose what Gym can read, open the Health app, tap your picture, then Apps.
        </Text>
      </View>
      <ErrorNote message={health.error} />
      <View className="flex-row gap-2">
        <Button className="flex-1" disabled={health.syncing} onPress={() => void syncHealth()}>
          Sync now
        </Button>
        <Button variant="ghost" className="flex-1" disabled={health.syncing} onPress={disconnectHealth}>
          Stop syncing
        </Button>
      </View>
    </Card>
  )
}
