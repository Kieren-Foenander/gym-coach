import { isCardio } from "~/domain/catalog"
import { formatWeight } from "~/domain/progression"
import { distanceUnit, type Unit } from "~/domain/schema"

export { formatWeight }

interface Prescription {
  readonly exerciseName: string
  readonly sets: number
  readonly repMin: number
  readonly repMax: number
  readonly targetWeight: number | null
}

export const formatReps = (repMin: number, repMax: number) => (repMin === repMax ? `${repMin}` : `${repMin}–${repMax}`)

const formatRounds = (count: number) => `${count} ${count === 1 ? "round" : "rounds"}`

/** A length of time for a cardio set: whole minutes as "20 min", anything else as a clock. */
export const formatDuration = (seconds: number) => (seconds % 60 === 0 ? `${seconds / 60} min` : formatClock(seconds))

interface Effort {
  readonly weight: number
  readonly reps: number
  readonly durationSeconds: number | null
  readonly distance: number | null
}

/** One logged set in a few characters: "60×8" for a lift, "20 min · 5 km" for cardio. */
export const formatSet = (set: Effort, unit: Unit) =>
  set.durationSeconds === null
    ? `${formatWeight(set.weight)}×${set.reps}`
    : [formatDuration(set.durationSeconds), ...(set.distance ? [`${formatWeight(set.distance)} ${distanceUnit(unit)}`] : [])].join(
        " · ",
      )

export const formatPrescription = (target: Prescription, unit: string) => {
  if (isCardio(target.exerciseName)) return formatRounds(target.sets)

  const weight = target.targetWeight === null ? "find your weight" : `${formatWeight(target.targetWeight)} ${unit}`

  return `${target.sets} × ${formatReps(target.repMin, target.repMax)} · ${weight}`
}

export const formatClock = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(seconds / 60)

  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" })

export const formatDay = (timestamp: number) => dayFormat.format(timestamp)

export const formatVolume = (volume: number, unit: string) =>
  `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(volume)} ${unit}`

/** Large totals in short form: 12,480 becomes 12.5k. */
export const formatCompact = (value: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value).toLowerCase()

interface Timed {
  readonly sets: number
  readonly restSeconds: number
}

const SECONDS_PER_SET = 40

/** A rough session length from the prescribed sets and rests, to the nearest 5 minutes. */
export const estimateMinutes = (exercises: ReadonlyArray<Timed>) => {
  const seconds = exercises.reduce((total, item) => total + item.sets * (item.restSeconds + SECONDS_PER_SET), 0)

  return Math.max(5, Math.round(seconds / 300) * 5)
}
