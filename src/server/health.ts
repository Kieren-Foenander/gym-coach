import { Array as Arr, Clock, Effect } from "effect"
import { SqlClient } from "effect/sql"
import {
  activityName,
  bodyValueFor,
  cardioExerciseFor,
  distanceFor,
  type HealthMetric,
  type HealthReading,
} from "~/domain/health"
import type { HealthImport } from "~/domain/schema"
import { CurrentUser, ensureExercise } from "./repo"

/**
 * What the iPhone app brings in from Apple Health, and reading it back. Everything is keyed
 * by the id Health gave it, so the phone can send the same records again safely: after a
 * lost reply, say, or a sync that stopped halfway.
 */

const DAY_MS = 86_400_000

/** A workout in the app nobody finished counts as lasting this long, so it cannot swallow every later Health workout. */
const UNFINISHED_SPAN_MS = 4 * 3_600_000

// D1 takes at most 100 values in one statement. These keep each insert under that.
const BODY_ROWS_PER_INSERT = 18
const DAILY_ROWS_PER_INSERT = 24
const IDS_PER_STATEMENT = 90

type HealthWorkoutInput = NonNullable<HealthImport["workouts"]>[number]

export interface HealthImportResult {
  /** Measurements that were new. */
  readonly measurements: number
  /** Health workouts that were new, and how many of those became or joined a workout in the log. */
  readonly workouts: number
  readonly logged: number
  readonly days: number
}

const removeDeleted = Effect.fn("removeDeleted")(function* (ids: ReadonlyArray<string>) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser

  for (const chunk of Arr.chunksOf(ids, IDS_PER_STATEMENT)) {
    yield* sql`DELETE FROM body_measurements WHERE user_id = ${user.id} AND ${sql.in("health_id", chunk)}`

    // A workout made from a Health workout goes with it. One logged in the app only loses the link.
    const made = yield* sql<{ id: number }>`
      SELECT w.id FROM health_workouts h JOIN workouts w ON w.id = h.workout_id
      WHERE h.user_id = ${user.id} AND w.source = 'health' AND ${sql.in("h.health_id", chunk)}`

    yield* sql`DELETE FROM health_workouts WHERE user_id = ${user.id} AND ${sql.in("health_id", chunk)}`

    // Unless another copy of it (from a second app writing to Health, say) is still there.
    const orphaned =
      made.length === 0
        ? []
        : yield* sql<{ id: number }>`
            SELECT id FROM workouts w WHERE ${sql.in("w.id", made.map((row) => row.id))}
              AND NOT EXISTS (SELECT 1 FROM health_workouts h WHERE h.workout_id = w.id)`

    if (orphaned.length > 0) {
      const ids = orphaned.map((row) => row.id)
      yield* sql`DELETE FROM workout_sets WHERE ${sql.in("workout_id", ids)}`
      yield* sql`DELETE FROM workouts WHERE user_id = ${user.id} AND ${sql.in("id", ids)}`
    }
  }
})

/** The workout in the log that overlaps this span the most, if any does. */
const overlappingWorkout = Effect.fn("overlappingWorkout")(function* (startedAt: number, endedAt: number) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser

  const rows = yield* sql<{ id: number }>`
    SELECT id FROM (
      SELECT id, started_at, COALESCE(finished_at, started_at + ${UNFINISHED_SPAN_MS}) AS ended_at
      FROM workouts WHERE user_id = ${user.id} AND started_at < ${endedAt}
    )
    WHERE ended_at > ${startedAt}
    ORDER BY MIN(ended_at, ${endedAt}) - MAX(started_at, ${startedAt}) DESC LIMIT 1`

  return rows[0]?.id ?? null
})

/** Logs a cardio workout from Health as a finished workout with one timed set. */
const logCardio = Effect.fn("logCardio")(function* (workout: HealthWorkoutInput, exercise: string, exerciseId: number) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser
  const distance = workout.distanceMeters ? distanceFor(workout.distanceMeters, user.unit) : null

  const rows = yield* sql<{ id: number }>`
    INSERT INTO workouts (user_id, plan_day_id, name, started_at, finished_at, notes, source)
    VALUES (${user.id}, ${null}, ${exercise}, ${workout.startedAt}, ${workout.endedAt}, ${"From Apple Health"}, ${"health"})
    RETURNING id`

  const workoutId = rows[0]!.id

  yield* sql`
    INSERT INTO workout_sets (workout_id, exercise_id, set_number, weight, reps, duration_seconds, distance, created_at)
    VALUES (${workoutId}, ${exerciseId}, 1, 0, 0, ${Math.max(1, workout.durationSeconds)}, ${distance || null},
      ${workout.endedAt})`

  return workoutId
})

const importWorkouts = Effect.fn("importWorkouts")(function* (workouts: ReadonlyArray<HealthWorkoutInput>) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser

  if (!Arr.isReadonlyArrayNonEmpty(workouts)) return { added: 0, logged: 0 }

  const known = yield* sql<{ healthId: string }>`
    SELECT health_id FROM health_workouts
    WHERE user_id = ${user.id} AND ${sql.in("health_id", workouts.map((workout) => workout.healthId))}`

  const seen = new Set(known.map((row) => row.healthId))
  const exerciseIds = new Map<string, number>()
  let added = 0
  let logged = 0

  for (const workout of workouts) {
    if (seen.has(workout.healthId)) continue
    seen.add(workout.healthId)

    // During a workout in the app (or one already brought in), it joins that one, so nothing is counted twice.
    let workoutId = yield* overlappingWorkout(workout.startedAt, workout.endedAt)
    const exercise = cardioExerciseFor(workout.activity, workout.indoor)

    if (workoutId === null && exercise !== null) {
      const exerciseId = exerciseIds.get(exercise) ?? (yield* ensureExercise(exercise))
      exerciseIds.set(exercise, exerciseId)
      workoutId = yield* logCardio(workout, exercise, exerciseId)
    }

    yield* sql`
      INSERT INTO health_workouts
        (user_id, health_id, workout_id, activity, started_at, ended_at, energy_kcal, avg_heart_rate)
      VALUES (${user.id}, ${workout.healthId}, ${workoutId}, ${workout.activity}, ${workout.startedAt}, ${workout.endedAt},
        ${workout.energyKcal ?? null}, ${workout.avgHeartRate ?? null})
      ON CONFLICT (user_id, health_id) DO NOTHING`

    added += 1

    if (workoutId !== null) logged += 1
  }

  return { added, logged }
})

/** Adds what the phone found in Health. Records already here are left as they are. */
export const importHealth = Effect.fn("importHealth")(function* (input: HealthImport) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser

  yield* removeDeleted(input.deleted ?? [])

  let measurements = 0

  for (const chunk of Arr.chunksOf(input.body ?? [], BODY_ROWS_PER_INSERT)) {
    const rows = Arr.map(chunk, (sample) => ({
      user_id: user.id,
      kind: sample.kind,
      value: bodyValueFor(sample.kind, sample.value, user.unit),
      measured_at: sample.measuredAt,
      health_id: sample.healthId,
    }))

    const inserted = yield* sql<{ id: number }>`INSERT OR IGNORE INTO body_measurements ${sql.insert(rows)} RETURNING id`
    measurements += inserted.length
  }

  const workouts = yield* importWorkouts(input.workouts ?? [])
  const daily = input.daily ?? []

  for (const chunk of Arr.chunksOf(daily, DAILY_ROWS_PER_INSERT)) {
    const rows = Arr.map(chunk, (reading) => ({ user_id: user.id, day: reading.day, metric: reading.metric, value: reading.value }))

    yield* sql`INSERT INTO health_daily ${sql.insert(rows)}
      ON CONFLICT (user_id, day, metric) DO UPDATE SET value = excluded.value`
  }

  return {
    measurements,
    workouts: workouts.added,
    logged: workouts.logged,
    days: new Set(daily.map((reading) => reading.day)).size,
  } satisfies HealthImportResult
})

/** Daily readings from the last `days` days, oldest first. */
export const listHealthDaily = Effect.fn("listHealthDaily")(function* (days: number) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser
  const since = new Date((yield* Clock.currentTimeMillis) - days * DAY_MS).toISOString().slice(0, 10)

  return yield* sql<HealthReading>`
    SELECT day, metric, value FROM health_daily WHERE user_id = ${user.id} AND day >= ${since} ORDER BY day, metric`
})

export interface HealthWorkoutEntry {
  readonly date: string
  readonly activity: string
  readonly minutes: number
  readonly energyKcal: number | null
  readonly avgHeartRate: number | null
  /** The workout in the log it belongs to, if any. */
  readonly loggedAs: string | null
}

/** Every workout Health recorded in the last `days` days, newest first, including ones the log does not show. */
export const listHealthWorkouts = Effect.fn("listHealthWorkouts")(function* (days: number) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser
  const since = (yield* Clock.currentTimeMillis) - days * DAY_MS

  const rows = yield* sql<{
    activity: number
    startedAt: number
    endedAt: number
    energyKcal: number | null
    avgHeartRate: number | null
    workoutName: string | null
  }>`
    SELECT h.activity, h.started_at, h.ended_at, h.energy_kcal, h.avg_heart_rate, w.name AS workout_name
    FROM health_workouts h LEFT JOIN workouts w ON w.id = h.workout_id
    WHERE h.user_id = ${user.id} AND h.started_at >= ${since}
    ORDER BY h.started_at DESC LIMIT 200`

  return rows.map(
    (row): HealthWorkoutEntry => ({
      date: new Date(row.startedAt).toISOString(),
      activity: activityName(row.activity),
      minutes: Math.round((row.endedAt - row.startedAt) / 60_000),
      energyKcal: row.energyKcal === null ? null : Math.round(row.energyKcal),
      avgHeartRate: row.avgHeartRate === null ? null : Math.round(row.avgHeartRate),
      loggedAs: row.workoutName,
    }),
  )
})

/** Daily readings grouped by day, newest first, which is easier to read than one row per number. */
export const healthDays = (readings: ReadonlyArray<HealthReading>) => {
  const days = new Map<string, Partial<Record<HealthMetric, number>>>()

  for (const reading of readings) {
    const day = days.get(reading.day) ?? {}
    day[reading.metric] = reading.value
    days.set(reading.day, day)
  }

  return [...days].toReversed().map(([day, values]) => ({ day, ...values }))
}
