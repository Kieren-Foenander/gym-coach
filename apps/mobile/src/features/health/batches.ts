import { HEALTH_IMPORT_LIMITS, HEALTH_VALUE_LIMITS } from "~/domain/health"
import type { CallInput } from "~/server/calls"
import type { BodyRecord, DailyRecord, HealthChanges, WorkoutRecord } from "./types"

const chunks = <A>(items: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))

const within = (value: number, max: number) => Number.isFinite(value) && value >= 0 && value <= max

const validId = (id: string) => id.length > 0 && id.length <= HEALTH_VALUE_LIMITS.healthId

/** A number the server would refuse becomes "not known" instead. */
const optional = (value: number | null | undefined, max: number) =>
  value === null || value === undefined || !within(value, max) ? null : value

const validTime = (time: number) => Number.isFinite(time) && time >= 0

const cleanWorkout = (workout: WorkoutRecord): ReadonlyArray<WorkoutRecord> => {
  if (!validId(workout.healthId) || !validTime(workout.startedAt) || !validTime(workout.endedAt)) return []

  if (!Number.isInteger(workout.activity) || !within(workout.activity, HEALTH_VALUE_LIMITS.activity)) return []

  return [
    {
      ...workout,
      durationSeconds: Math.min(Math.max(0, Math.round(workout.durationSeconds) || 0), HEALTH_VALUE_LIMITS.durationSeconds),
      distanceMeters: optional(workout.distanceMeters, HEALTH_VALUE_LIMITS.distanceMeters),
      energyKcal: optional(workout.energyKcal, HEALTH_VALUE_LIMITS.energyKcal),
      avgHeartRate: optional(workout.avgHeartRate, HEALTH_VALUE_LIMITS.avgHeartRate),
    },
  ]
}

/**
 * Leaves out anything the server would refuse, such as a scale reading of 0 or a heart
 * rate from a faulty sensor. One bad value fails its whole request, and since the same
 * records are read again until a sync succeeds, it would stop every sync after it.
 */
export const cleanHealthChanges = (changes: HealthChanges): HealthChanges => ({
  ...changes,
  deleted: changes.deleted.filter(validId),
  body: changes.body.filter(
    (sample: BodyRecord) =>
      validId(sample.healthId) && sample.value > 0 && within(sample.value, HEALTH_VALUE_LIMITS.body) && validTime(sample.measuredAt),
  ),
  workouts: changes.workouts.flatMap(cleanWorkout),
  daily: changes.daily.filter((reading: DailyRecord) => within(reading.value, HEALTH_VALUE_LIMITS.daily)),
})

/**
 * Splits what was read from Health into requests the server accepts. Each request carries
 * one kind of record, up to the server's limit for it. Deletions go first, so a record that
 * was replaced in Health is removed before its replacement arrives.
 */
export const healthBatches = (changes: HealthChanges): ReadonlyArray<CallInput<"importHealth">> => {
  const clean = cleanHealthChanges(changes)

  return [
    ...chunks(clean.deleted, HEALTH_IMPORT_LIMITS.deleted).map((deleted) => ({ deleted })),
    ...chunks(clean.body, HEALTH_IMPORT_LIMITS.body).map((body) => ({ body })),
    ...chunks(clean.workouts, HEALTH_IMPORT_LIMITS.workouts).map((workouts) => ({ workouts })),
    ...chunks(clean.daily, HEALTH_IMPORT_LIMITS.daily).map((daily) => ({ daily })),
  ]
}
