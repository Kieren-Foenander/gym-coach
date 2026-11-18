import { daysBetween } from "./days"
import type { Unit } from "./units"

/**
 * Rules for the data the iPhone app brings in from Apple Health. Plain values and
 * functions with no schema library behind them, so the native app can use them too.
 *
 * The phone reads Health and sends what it found in standard units (kilograms, metres,
 * a fraction for body fat). The server turns those into the user's units and decides
 * what each Health workout becomes, so both live here.
 */

/** How far back the first sync reaches. Later syncs only send what changed. */
export const HEALTH_BACKFILL_DAYS = 90

/**
 * The most of each kind of record one request may carry. A Worker on the free plan can
 * make 50 database queries per request, and these keep each request well under that.
 */
export const HEALTH_IMPORT_LIMITS = { deleted: 90, body: 180, workouts: 6, daily: 250 } as const

/**
 * The largest value the server accepts for each number, and the longest record id. The phone
 * drops or blanks anything outside these before sending, because the server refuses a whole
 * request over one bad value, and a sync that is refused would be refused the same way forever.
 */
export const HEALTH_VALUE_LIMITS = {
  healthId: 64,
  body: 1000,
  activity: 10_000,
  durationSeconds: 7 * 86_400,
  distanceMeters: 1_000_000,
  energyKcal: 20_000,
  avgHeartRate: 300,
  daily: 1_000_000,
} as const

// ---------------------------------------------------------------- daily metrics

export const HEALTH_METRICS = [
  "sleep",
  "restingHeartRate",
  "hrv",
  "steps",
  "activeEnergy",
  "vo2Max",
  "dietaryEnergy",
  "dietaryProtein",
  "dietaryCarbs",
  "dietaryFat",
] as const

export type HealthMetric = (typeof HEALTH_METRICS)[number]

/**
 * Goes up whenever a daily metric is added. A phone that last synced with an older version reads
 * the whole backfill again, so a new metric arrives with its history and not just the last week.
 */
export const HEALTH_DAILY_VERSION = 2

/**
 * The daily metrics that are totals of what was logged in another app, which someone can delete
 * again. The phone sends 0 for a day with none of them, so a day emptied in that app empties here too.
 */
export const HEALTH_TOTAL_METRICS = ["dietaryEnergy", "dietaryProtein", "dietaryCarbs", "dietaryFat"] as const satisfies ReadonlyArray<HealthMetric>

interface MetricInfo {
  readonly label: string
  readonly unit: string
  /** What the coach is told the number means. */
  readonly meaning: string
}

export const HEALTH_METRIC_INFO = {
  sleep: { label: "Sleep", unit: "min", meaning: "minutes asleep in the sleep that ended that day" },
  restingHeartRate: { label: "Resting HR", unit: "bpm", meaning: "resting heart rate" },
  hrv: { label: "HRV", unit: "ms", meaning: "average heart rate variability (SDNN)" },
  steps: { label: "Steps", unit: "steps", meaning: "steps taken" },
  activeEnergy: { label: "Active energy", unit: "kcal", meaning: "active calories burned" },
  vo2Max: { label: "VO2 max", unit: "ml/kg/min", meaning: "Apple Watch's estimate of cardio fitness" },
  dietaryEnergy: { label: "Calories eaten", unit: "kcal", meaning: "calories eaten, from a food tracker that writes to Apple Health" },
  dietaryProtein: { label: "Protein", unit: "g", meaning: "protein eaten, from a food tracker that writes to Apple Health" },
  dietaryCarbs: { label: "Carbs", unit: "g", meaning: "carbohydrate eaten, from a food tracker that writes to Apple Health" },
  dietaryFat: { label: "Fat", unit: "g", meaning: "fat eaten, from a food tracker that writes to Apple Health" },
} as const satisfies { readonly [K in HealthMetric]: MetricInfo }

/** A calendar day on the phone, as YYYY-MM-DD. */
export const localDay = (time: number): string => {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${date.getFullYear()}-${month}-${day}`
}

/** Every calendar day on the phone from one time to another, both included, oldest first. */
export const localDaysFrom = (start: number, end: number): ReadonlyArray<string> => {
  const days: Array<string> = []
  const date = new Date(start)
  date.setHours(12, 0, 0, 0)

  while (localDay(date.getTime()) <= localDay(end)) {
    days.push(localDay(date.getTime()))
    date.setDate(date.getDate() + 1)
  }

  return days
}

export interface TimeSpan {
  readonly start: number
  readonly end: number
}

/**
 * Minutes asleep per day, keyed by the day each stretch of sleep ended, so a night
 * belongs to the morning you woke up. An Apple Watch and an iPhone often both record
 * the same night, so overlapping records are counted once.
 */
export const sleepMinutesByDay = (spans: ReadonlyArray<TimeSpan>, dayOf: (time: number) => string): Map<string, number> => {
  const sorted = spans.filter((span) => span.end > span.start).toSorted((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = []

  for (const span of sorted) {
    const last = merged.at(-1)

    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ start: span.start, end: span.end })
  }

  const minutes = new Map<string, number>()

  for (const span of merged) {
    const day = dayOf(span.end)
    minutes.set(day, (minutes.get(day) ?? 0) + (span.end - span.start) / 60_000)
  }

  for (const [day, total] of minutes) minutes.set(day, Math.round(total))

  return minutes
}

export interface HealthReading {
  readonly day: string
  readonly metric: HealthMetric
  readonly value: number
}

export interface MetricSummary {
  readonly metric: HealthMetric
  readonly latest: number
  readonly latestDay: string
  /** The average over the four weeks before the latest day, when there are at least three days to go on. */
  readonly usual: number | null
}

const USUAL_WINDOW_DAYS = 28
const MIN_USUAL_DAYS = 3


/** The latest value of each metric next to what is usual for this person, in the order of HEALTH_METRICS. */
export const summariseHealth = (readings: ReadonlyArray<HealthReading>): ReadonlyArray<MetricSummary> =>
  HEALTH_METRICS.flatMap((metric) => {
    const series = readings.filter((reading) => reading.metric === metric).toSorted((a, b) => a.day.localeCompare(b.day))
    const latest = series.at(-1)

    if (!latest) return []

    const before = series.filter((reading) => {
      const gap = daysBetween(reading.day, latest.day)

      return gap > 0 && gap <= USUAL_WINDOW_DAYS
    })

    const usual = before.length >= MIN_USUAL_DAYS ? before.reduce((total, reading) => total + reading.value, 0) / before.length : null

    return [{ metric, latest: latest.value, latestDay: latest.day, usual }]
  })

// ---------------------------------------------------------------- body

export const HEALTH_BODY_KINDS = ["weight", "waist", "bodyFat"] as const

export type HealthBodyKind = (typeof HEALTH_BODY_KINDS)[number]

const KG_PER_LB = 0.45359237
const METRES_PER_INCH = 0.0254
const METRES_PER_MILE = 1609.344

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places

/**
 * A body measurement from Health in the units the app stores: weight from kilograms,
 * waist from metres (to cm or inches), body fat from a fraction to a percentage.
 */
export const bodyValueFor = (kind: HealthBodyKind, standard: number, unit: Unit): number => {
  if (kind === "weight") return round(unit === "kg" ? standard : standard / KG_PER_LB, 1)

  if (kind === "waist") return round(unit === "kg" ? standard * 100 : standard / METRES_PER_INCH, 1)

  return round(standard * 100, 1)
}

/** A cardio distance from metres to km alongside kg, miles alongside lb. */
export const distanceFor = (metres: number, unit: Unit): number =>
  round(unit === "kg" ? metres / 1000 : metres / METRES_PER_MILE, 2)

// ---------------------------------------------------------------- workouts

/** HealthKit's numbers for workout types (HKWorkoutActivityType), for the ones named here. */
const ACTIVITY = {
  cycling: 13,
  elliptical: 16,
  functionalStrengthTraining: 20,
  hiking: 24,
  rowing: 35,
  running: 37,
  stairClimbing: 44,
  swimming: 46,
  traditionalStrengthTraining: 50,
  walking: 52,
  coreTraining: 59,
  highIntensityIntervalTraining: 63,
  jumpRope: 64,
  stairs: 68,
} as const

/**
 * The exercise in the library a Health workout is logged as, when it has no workout in
 * the app to join. Anything else (strength, yoga, team sports) is kept for the coach to
 * read but not added to the log, because there are no sets to show for it.
 */
export const cardioExerciseFor = (activity: number, indoor: boolean): string | null => {
  switch (activity) {
    case ACTIVITY.running:
      return indoor ? "Treadmill Run" : "Outdoor Run"
    case ACTIVITY.walking:
      return "Walk"
    case ACTIVITY.hiking:
      return "Hike"
    case ACTIVITY.cycling:
      return indoor ? "Stationary Bike" : "Outdoor Cycling"
    case ACTIVITY.rowing:
      return "Rowing Machine"
    case ACTIVITY.elliptical:
      return "Elliptical"
    case ACTIVITY.stairClimbing:
    case ACTIVITY.stairs:
      return "Stair Climber"
    case ACTIVITY.swimming:
      return "Swimming"
    case ACTIVITY.jumpRope:
      return "Jump Rope"
    default:
      return null
  }
}

const ACTIVITY_NAMES: ReadonlyMap<number, string> = new Map([
  [ACTIVITY.cycling, "Cycling"],
  [ACTIVITY.elliptical, "Elliptical"],
  [ACTIVITY.functionalStrengthTraining, "Functional strength training"],
  [ACTIVITY.hiking, "Hiking"],
  [ACTIVITY.rowing, "Rowing"],
  [ACTIVITY.running, "Running"],
  [ACTIVITY.stairClimbing, "Stair climbing"],
  [ACTIVITY.swimming, "Swimming"],
  [ACTIVITY.traditionalStrengthTraining, "Strength training"],
  [ACTIVITY.walking, "Walking"],
  [ACTIVITY.coreTraining, "Core training"],
  [ACTIVITY.highIntensityIntervalTraining, "HIIT"],
  [ACTIVITY.jumpRope, "Jump rope"],
  [ACTIVITY.stairs, "Stairs"],
  [8, "Boxing"],
  [9, "Climbing"],
  [11, "Cross training"],
  [14, "Dance"],
  [21, "Golf"],
  [28, "Martial arts"],
  [41, "Soccer"],
  [48, "Tennis"],
  [57, "Yoga"],
  [62, "Flexibility"],
  [66, "Pilates"],
  [73, "Mixed cardio"],
  [79, "Pickleball"],
  [80, "Cooldown"],
])

/** A readable name for a HealthKit workout type, for the coach. */
export const activityName = (activity: number): string => ACTIVITY_NAMES.get(activity) ?? "Other"

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })

/** A daily number for showing: sleep as hours and minutes, steps with separators, the rest rounded. */
export const formatHealthValue = (metric: HealthMetric, value: number): string => {
  if (metric === "sleep") {
    const minutes = Math.round(value)

    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
  }

  if (metric === "vo2Max") return value.toFixed(1)

  return wholeNumber.format(value)
}
