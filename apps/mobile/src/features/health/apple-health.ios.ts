import Constants, { ExecutionEnvironment } from "expo-constants"
import {
  HEALTH_BACKFILL_DAYS,
  HEALTH_TOTAL_METRICS,
  localDay,
  localDaysFrom,
  sleepMinutesByDay,
  type HealthMetric,
} from "~/domain/health"
import type { BodyRecord, DailyRecord, HealthAnchors, HealthChanges, WorkoutRecord } from "./types"

/**
 * Reads Apple Health on an iPhone. It needs the app's own build: Expo Go has no HealthKit
 * module, so there `healthKitAvailable` is false and nothing here is loaded.
 *
 * Body measurements and workouts are read with anchors, so each sync only gets what was
 * added or deleted since the last one. Daily numbers are read again for the last few days,
 * because a watch keeps adding to today's steps and syncs last night's sleep late.
 */

type HealthKit = typeof import("@kingstinct/react-native-healthkit")

const DAY_MS = 86_400_000

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient

let loaded: HealthKit | null | undefined

// Loaded on first use, and never in Expo Go. Loading it where the native module is missing throws,
// so that counts as unavailable too.
const healthKit = (): HealthKit | null => {
  if (loaded !== undefined) return loaded

  if (inExpoGo) {
    loaded = null

    return loaded
  }

  try {
    const module: HealthKit = require("@kingstinct/react-native-healthkit")
    loaded = module.isHealthDataAvailable() ? module : null
  } catch {
    loaded = null
  }

  return loaded
}

const needHealthKit = (): HealthKit => {
  const module = healthKit()

  if (module === null) throw new Error("Apple Health is not available on this phone.")

  return module
}

/** Whether this build, on this phone, can read Apple Health. */
export const healthKitAvailable = (): boolean => healthKit() !== null

const BODY = [
  { kind: "weight", identifier: "HKQuantityTypeIdentifierBodyMass", unit: "kg" },
  { kind: "waist", identifier: "HKQuantityTypeIdentifierWaistCircumference", unit: "m" },
  { kind: "bodyFat", identifier: "HKQuantityTypeIdentifierBodyFatPercentage", unit: "%" },
] as const

const DAILY = [
  { metric: "steps", identifier: "HKQuantityTypeIdentifierStepCount", unit: "count", statistic: "cumulativeSum" },
  { metric: "activeEnergy", identifier: "HKQuantityTypeIdentifierActiveEnergyBurned", unit: "kcal", statistic: "cumulativeSum" },
  { metric: "restingHeartRate", identifier: "HKQuantityTypeIdentifierRestingHeartRate", unit: "count/min", statistic: "discreteAverage" },
  { metric: "hrv", identifier: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN", unit: "ms", statistic: "discreteAverage" },
  { metric: "vo2Max", identifier: "HKQuantityTypeIdentifierVO2Max", unit: "ml/(kg*min)", statistic: "discreteAverage" },
  // Food, from a tracker such as MyFitnessPal or Cronometer that writes to Health.
  { metric: "dietaryEnergy", identifier: "HKQuantityTypeIdentifierDietaryEnergyConsumed", unit: "kcal", statistic: "cumulativeSum" },
  { metric: "dietaryProtein", identifier: "HKQuantityTypeIdentifierDietaryProtein", unit: "g", statistic: "cumulativeSum" },
  { metric: "dietaryCarbs", identifier: "HKQuantityTypeIdentifierDietaryCarbohydrates", unit: "g", statistic: "cumulativeSum" },
  { metric: "dietaryFat", identifier: "HKQuantityTypeIdentifierDietaryFatTotal", unit: "g", statistic: "cumulativeSum" },
] as const

const SLEEP = "HKCategoryTypeIdentifierSleepAnalysis"
const HEART_RATE = "HKQuantityTypeIdentifierHeartRate"

// Sleep analysis values that mean asleep: unspecified, core, deep and REM. In bed (0) and awake (2) are not.
const ASLEEP = new Set([1, 3, 4, 5])

/** Asks to read everything the app uses. iOS shows its sheet only the first time, and never says what was refused. */
export const requestHealthAccess = async (): Promise<void> => {
  await needHealthKit().requestAuthorization({
    toRead: [
      ...BODY.map((item) => item.identifier),
      ...DAILY.map((item) => item.identifier),
      SLEEP,
      HEART_RATE,
      "HKWorkoutTypeIdentifier",
    ],
  })
}

const startOfDay = (time: number) => {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)

  return date
}

const roundTo = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places

const readBody = async (healthKit: HealthKit, anchors: HealthAnchors, from: Date) => {
  const body: Array<BodyRecord> = []
  const deleted: Array<string> = []
  const next: Record<string, string> = {}

  for (const item of BODY) {
    const result = await healthKit.queryQuantitySamplesWithAnchor(item.identifier, {
      limit: 0,
      unit: item.unit,
      anchor: anchors[item.kind],
      filter: { date: { startDate: from } },
    })

    for (const sample of result.samples) {
      body.push({ healthId: sample.uuid, kind: item.kind, value: sample.quantity, measuredAt: sample.startDate.getTime() })
    }

    for (const gone of result.deletedSamples) deleted.push(gone.uuid)
    next[item.kind] = result.newAnchor
  }

  return { body, deleted, anchors: next }
}

const readWorkouts = async (healthKit: HealthKit, anchor: string | undefined, from: Date) => {
  const result = await healthKit.queryWorkoutSamplesWithAnchor({ limit: 0, anchor, filter: { date: { startDate: from } } })
  const workouts: Array<WorkoutRecord> = []

  for (const workout of result.workouts) {
    const heartRate = await workout.getStatistic(HEART_RATE, "count/min").catch(() => undefined)
    const average = heartRate?.averageQuantity?.quantity

    workouts.push({
      healthId: workout.uuid,
      activity: workout.workoutActivityType,
      // HealthKit keeps this flag as a number, so it may arrive as 1 rather than true.
      indoor: Boolean(workout.metadata?.HKIndoorWorkout),
      startedAt: workout.startDate.getTime(),
      endedAt: workout.endDate.getTime(),
      durationSeconds: Math.round(workout.duration.quantity),
      distanceMeters: workout.totalDistance ? roundTo(workout.totalDistance.quantity, 0) : null,
      energyKcal: workout.totalEnergyBurned ? roundTo(workout.totalEnergyBurned.quantity, 0) : null,
      avgHeartRate: average === undefined ? null : roundTo(average, 0),
    })

    // Each workout holds a native object until it is let go; a first sync can read hundreds.
    workout.dispose()
  }

  return { workouts, deleted: result.deletedSamples.map((gone) => gone.uuid), anchor: result.newAnchor }
}

const readDaily = async (healthKit: HealthKit, from: Date) => {
  const daily: Array<DailyRecord> = []
  const days = localDaysFrom(from.getTime(), Date.now())

  for (const item of DAILY) {
    const buckets = await healthKit.queryStatisticsCollectionForQuantity(item.identifier, [item.statistic], from, { day: 1 }, {
      unit: item.unit,
      filter: { date: { startDate: from } },
    })

    for (const bucket of buckets) {
      const quantity = item.statistic === "cumulativeSum" ? bucket.sumQuantity : bucket.averageQuantity

      if (!quantity || !bucket.startDate || quantity.quantity <= 0) continue

      const metric: HealthMetric = item.metric
      daily.push({ day: localDay(bucket.startDate.getTime()), metric, value: roundTo(quantity.quantity, 1) })
    }
  }

  // A day with no food logged is sent as 0, which clears it on the server: otherwise a day emptied
  // in the food tracker would keep counting what was deleted.
  for (const metric of HEALTH_TOTAL_METRICS) {
    const found = new Set(daily.flatMap((reading) => (reading.metric === metric ? [reading.day] : [])))

    for (const day of days) if (!found.has(day)) daily.push({ day, metric, value: 0 })
  }

  // A night that ended on the first day began the evening before.
  const sleep = await healthKit.queryCategorySamples(SLEEP, {
    limit: 0,
    filter: { date: { startDate: new Date(from.getTime() - DAY_MS) } },
  })

  const asleep = sleep.flatMap((sample) =>
    ASLEEP.has(sample.value) ? [{ start: sample.startDate.getTime(), end: sample.endDate.getTime() }] : [],
  )

  const firstDay = localDay(from.getTime())

  for (const [day, minutes] of sleepMinutesByDay(asleep, localDay)) {
    if (day >= firstDay && minutes > 0) daily.push({ day, metric: "sleep", value: minutes })
  }

  return daily
}

/**
 * Everything new in Health since the last sync. `lastSyncedAt` is null for the first, which
 * reaches back HEALTH_BACKFILL_DAYS days. `backfillDaily` reads the daily numbers that far back
 * too, for when a new daily metric was added since the last sync.
 */
export const readHealthChanges = async (
  anchors: HealthAnchors,
  lastSyncedAt: number | null,
  backfillDaily: boolean,
): Promise<HealthChanges> => {
  const healthKit = needHealthKit()
  const now = Date.now()
  const backfill = startOfDay(now - HEALTH_BACKFILL_DAYS * DAY_MS)
  // Daily numbers from a day before the last sync, and never less than the last week.
  const dailyFrom = lastSyncedAt === null || backfillDaily ? backfill : startOfDay(Math.max(backfill.getTime(), Math.min(now - 7 * DAY_MS, lastSyncedAt - DAY_MS)))

  const body = await readBody(healthKit, anchors, backfill)
  const workouts = await readWorkouts(healthKit, anchors.workouts, backfill)
  const daily = await readDaily(healthKit, dailyFrom)

  return {
    deleted: [...body.deleted, ...workouts.deleted],
    body: body.body,
    workouts: workouts.workouts,
    daily,
    anchors: { ...body.anchors, workouts: workouts.anchor },
  }
}
