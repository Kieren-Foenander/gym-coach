import { Clock, Context, Effect } from "effect"
import { SqlClient } from "effect/sql"
import {
  estimateOneRepMax,
  evaluateProgression,
  formatWeight,
} from "~/domain/progression"
import type {
  AdjustmentSource,
  Direction,
  ExercisePrescription,
  MeasurementInput,
  MeasurementKind,
  PlanExercisePatch,
  PlanInput,
  ProfilePatch,
  SetInput,
  Unit,
} from "~/domain/schema"
import { Invalid, NotFound } from "./errors"

// ---------------------------------------------------------------- models

export interface User {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly unit: Unit
  readonly goal: string
  readonly trainingContext: string
}

export class CurrentUser extends Context.Service<CurrentUser, User>()("gym/CurrentUser") {}

export interface PlanExercise {
  readonly id: number
  readonly planDayId: number
  readonly exerciseId: number
  readonly exerciseName: string
  readonly muscleGroup: string
  readonly position: number
  readonly sets: number
  readonly repMin: number
  readonly repMax: number
  readonly targetWeight: number | null
  readonly increment: number
  readonly restSeconds: number
  readonly notes: string
  readonly autoProgress: boolean
  readonly missStreak: number
}

export interface PlanDay {
  readonly id: number
  readonly position: number
  readonly name: string
  readonly exercises: ReadonlyArray<PlanExercise>
}

export interface Plan {
  readonly id: number
  readonly name: string
  readonly description: string
  readonly source: "user" | "ai"
  readonly createdAt: number
  readonly days: ReadonlyArray<PlanDay>
}

export interface WorkoutSet {
  readonly id: number
  readonly exerciseId: number
  readonly planExerciseId: number | null
  readonly setNumber: number
  readonly weight: number
  readonly reps: number
  readonly rpe: number | null
}

export interface Workout {
  readonly id: number
  readonly planDayId: number | null
  readonly name: string
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly notes: string
}

export interface WorkoutSummary extends Workout {
  readonly setCount: number
  readonly volume: number
}

export interface Adjustment {
  readonly id: number
  readonly exerciseId: number
  readonly exerciseName: string
  readonly workoutId: number | null
  readonly source: AdjustmentSource
  readonly oldWeight: number | null
  readonly newWeight: number | null
  readonly reason: string
  readonly createdAt: number
}

export interface CoachNote {
  readonly id: number
  readonly body: string
  readonly createdAt: number
}

export interface WorkoutExercise {
  readonly exerciseId: number
  readonly exerciseName: string
  readonly target: PlanExercise | null
  readonly sets: ReadonlyArray<WorkoutSet>
  /** The planned exercise this one stands in for, when it was swapped in for this workout. */
  readonly swappedFrom: string | null
  /** What was done for this exercise in the most recent earlier workout. */
  readonly previous: ReadonlyArray<{ readonly weight: number; readonly reps: number }>
}

export interface WorkoutDetail {
  readonly workout: Workout
  readonly exercises: ReadonlyArray<WorkoutExercise>
  readonly adjustments: ReadonlyArray<Adjustment>
  /** Exercises where this workout beat every earlier one on estimated one-rep max. */
  readonly records: ReadonlyArray<number>
}

// ---------------------------------------------------------------- helpers

const sqlClient = SqlClient.SqlClient
const now = Clock.currentTimeMillis
const defaultIncrement = (unit: Unit) => (unit === "kg" ? 2.5 : 5)

type PlanExerciseRow = Omit<PlanExercise, "autoProgress"> & { readonly autoProgress: number }

const toPlanExercise = (row: PlanExerciseRow): PlanExercise => ({ ...row, autoProgress: row.autoProgress === 1 })

const PLAN_EXERCISE_COLUMNS = `pe.id, pe.plan_day_id, pe.exercise_id, e.name AS exercise_name, e.muscle_group,
  pe.position, pe.sets, pe.rep_min, pe.rep_max, pe.target_weight, pe.increment, pe.rest_seconds, pe.notes,
  pe.auto_progress, pe.miss_streak`

const checkRepRange = (repMin: number, repMax: number) =>
  repMin > repMax
    ? Effect.fail(new Invalid({ reason: `Rep range ${repMin}-${repMax} is upside down` }))
    : Effect.void

// ---------------------------------------------------------------- profile

export const updateProfile = Effect.fn("updateProfile")(function* (patch: ProfilePatch) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  const next = {
    displayName: patch.displayName ?? user.displayName,
    unit: patch.unit ?? user.unit,
    goal: patch.goal ?? user.goal,
    trainingContext: patch.trainingContext ?? user.trainingContext,
  }

  yield* sql`UPDATE users SET display_name = ${next.displayName}, unit = ${next.unit}, goal = ${next.goal},
    training_context = ${next.trainingContext} WHERE id = ${user.id}`

  return { ...user, ...next } satisfies User
})

// ---------------------------------------------------------------- exercises

const ensureExercise = Effect.fn("ensureExercise")(function* (name: string, muscleGroup = "") {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  const rows = yield* sql<{ id: number }>`
    INSERT INTO exercises (user_id, name, muscle_group) VALUES (${user.id}, ${name}, ${muscleGroup})
    ON CONFLICT (user_id, name) DO UPDATE SET
      muscle_group = CASE WHEN excluded.muscle_group != '' THEN excluded.muscle_group ELSE muscle_group END
    RETURNING id`

  return rows[0]!.id
})

/** Finds an exercise by name, creating it if it is new. An existing exercise keeps its own muscle group. */
const exerciseIdFor = Effect.fn("exerciseIdFor")(function* (name: string, muscleGroupIfNew: string) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  const known = yield* sql<{ id: number }>`
    SELECT id FROM exercises WHERE user_id = ${user.id} AND name = ${name}`

  return known[0]?.id ?? (yield* ensureExercise(name, muscleGroupIfNew))
})

export const listExercises = Effect.fn("listExercises")(function* () {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  return yield* sql<{ id: number; name: string; muscleGroup: string; lastPerformedAt: number | null }>`
    SELECT e.id, e.name, e.muscle_group, MAX(w.started_at) AS last_performed_at
    FROM exercises e
    LEFT JOIN workout_sets s ON s.exercise_id = e.id
    LEFT JOIN workouts w ON w.id = s.workout_id
    WHERE e.user_id = ${user.id}
    GROUP BY e.id ORDER BY e.name`
})

// ---------------------------------------------------------------- plans

export const getActivePlan = Effect.fn("getActivePlan")(function* () {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  const plans = yield* sql<Omit<Plan, "days">>`
    SELECT id, name, description, source, created_at FROM plans
    WHERE user_id = ${user.id} AND status = 'active' ORDER BY id DESC LIMIT 1`

  const plan = plans[0]

  if (!plan) return null

  const days = yield* sql<Omit<PlanDay, "exercises">>`
    SELECT id, position, name FROM plan_days WHERE plan_id = ${plan.id} ORDER BY position, id`

  const exercises = yield* sql<PlanExerciseRow>`
    SELECT ${sql.unsafe(PLAN_EXERCISE_COLUMNS)}
    FROM plan_exercises pe
    JOIN plan_days d ON d.id = pe.plan_day_id
    JOIN exercises e ON e.id = pe.exercise_id
    WHERE d.plan_id = ${plan.id} ORDER BY pe.position, pe.id`

  return {
    ...plan,
    days: days.map((day) => ({
      ...day,
      exercises: exercises.filter((row) => row.planDayId === day.id).map(toPlanExercise),
    })),
  } satisfies Plan
})

const insertPlanExercise = Effect.fn("insertPlanExercise")(function* (
  planDayId: number,
  position: number,
  input: ExercisePrescription,
) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser
  yield* checkRepRange(input.repMin, input.repMax)
  const exerciseId = yield* ensureExercise(input.exercise, input.muscleGroup ?? "")

  const rows = yield* sql<{ id: number }>`
    INSERT INTO plan_exercises
      (plan_day_id, exercise_id, position, sets, rep_min, rep_max, target_weight, increment, rest_seconds, notes, auto_progress)
    VALUES (${planDayId}, ${exerciseId}, ${position}, ${input.sets}, ${input.repMin}, ${input.repMax},
      ${input.targetWeight ?? null}, ${input.increment ?? defaultIncrement(user.unit)}, ${input.restSeconds ?? 120},
      ${input.notes ?? ""}, ${input.autoProgress === false ? 0 : 1})
    RETURNING id`

  return rows[0]!.id
})

/** Creates a plan and makes it the active one. The previous active plan is archived, not deleted. */
export const createPlan = Effect.fn("createPlan")(function* (input: PlanInput, source: "user" | "ai") {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  for (const day of input.days) {
    for (const exercise of day.exercises) yield* checkRepRange(exercise.repMin, exercise.repMax)
  }

  yield* sql`UPDATE plans SET status = 'archived' WHERE user_id = ${user.id} AND status = 'active'`

  const plans = yield* sql<{ id: number }>`
    INSERT INTO plans (user_id, name, description, source, created_at)
    VALUES (${user.id}, ${input.name}, ${input.description ?? ""}, ${source}, ${yield* now})
    RETURNING id`

  const planId = plans[0]!.id

  for (const [dayIndex, day] of input.days.entries()) {
    const days = yield* sql<{ id: number }>`
      INSERT INTO plan_days (plan_id, position, name) VALUES (${planId}, ${dayIndex}, ${day.name}) RETURNING id`

    for (const [index, exercise] of day.exercises.entries()) {
      yield* insertPlanExercise(days[0]!.id, index, exercise)
    }
  }

  return (yield* getActivePlan())!
})

const ownedPlanDay = Effect.fn("ownedPlanDay")(function* (planDayId: number) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  const rows = yield* sql<{ id: number; name: string; planId: number }>`
    SELECT d.id, d.name, d.plan_id FROM plan_days d JOIN plans p ON p.id = d.plan_id
    WHERE d.id = ${planDayId} AND p.user_id = ${user.id}`

  return rows[0] ?? (yield* new NotFound({ what: `Plan day ${planDayId}` }))
})

const ownedPlanExercise = Effect.fn("ownedPlanExercise")(function* (planExerciseId: number) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  const rows = yield* sql<PlanExerciseRow>`
    SELECT ${sql.unsafe(PLAN_EXERCISE_COLUMNS)}
    FROM plan_exercises pe
    JOIN plan_days d ON d.id = pe.plan_day_id
    JOIN plans p ON p.id = d.plan_id
    JOIN exercises e ON e.id = pe.exercise_id
    WHERE pe.id = ${planExerciseId} AND p.user_id = ${user.id}`

  const row = rows[0]

  return row ? toPlanExercise(row) : yield* new NotFound({ what: `Plan exercise ${planExerciseId}` })
})

export const addPlanDay = Effect.fn("addPlanDay")(function* (name: string) {
  const sql = yield* sqlClient
  const plan = yield* getActivePlan()

  if (!plan) {
    const created = yield* createPlan({ name: "My plan", days: [{ name, exercises: [] }] }, "user")

    return created.days[0]!.id
  }

  const position = Math.max(-1, ...plan.days.map((day) => day.position)) + 1

  const rows = yield* sql<{ id: number }>`
    INSERT INTO plan_days (plan_id, position, name) VALUES (${plan.id}, ${position}, ${name}) RETURNING id`

  return rows[0]!.id
})

/** Where an item lands after moving one place up or down a list. Null when it is already at that end. */
const moved = (ids: ReadonlyArray<number>, id: number, direction: Direction): ReadonlyArray<number> | null => {
  const from = ids.indexOf(id)
  const to = direction === "up" ? from - 1 : from + 1

  if (from === -1 || to < 0 || to >= ids.length) return null

  return ids.map((current, index) => (index === from ? ids[to]! : index === to ? id : current))
}

export const movePlanDay = Effect.fn("movePlanDay")(function* (planDayId: number, direction: Direction) {
  const sql = yield* sqlClient
  const day = yield* ownedPlanDay(planDayId)

  const siblings = yield* sql<{ id: number }>`
    SELECT id FROM plan_days WHERE plan_id = ${day.planId} ORDER BY position, id`

  const order = moved(siblings.map((row) => row.id), day.id, direction)

  if (!order) return

  yield* Effect.forEach(order, (id, position) => sql`UPDATE plan_days SET position = ${position} WHERE id = ${id}`)
})

export const movePlanExercise = Effect.fn("movePlanExercise")(function* (
  planExerciseId: number,
  direction: Direction,
) {
  const sql = yield* sqlClient
  const exercise = yield* ownedPlanExercise(planExerciseId)

  const siblings = yield* sql<{ id: number }>`
    SELECT id FROM plan_exercises WHERE plan_day_id = ${exercise.planDayId} ORDER BY position, id`

  const order = moved(siblings.map((row) => row.id), exercise.id, direction)

  if (!order) return

  yield* Effect.forEach(order, (id, position) => sql`UPDATE plan_exercises SET position = ${position} WHERE id = ${id}`)
})

export const removePlanDay = Effect.fn("removePlanDay")(function* (planDayId: number) {
  const sql = yield* sqlClient
  const day = yield* ownedPlanDay(planDayId)
  yield* sql`DELETE FROM plan_exercises WHERE plan_day_id = ${day.id}`
  yield* sql`DELETE FROM plan_days WHERE id = ${day.id}`
})

export const addPlanExercise = Effect.fn("addPlanExercise")(function* (
  planDayId: number,
  input: ExercisePrescription,
) {
  const sql = yield* sqlClient
  const day = yield* ownedPlanDay(planDayId)

  const rows = yield* sql<{ next: number }>`
    SELECT COALESCE(MAX(position), -1) + 1 AS next FROM plan_exercises WHERE plan_day_id = ${day.id}`

  const id = yield* insertPlanExercise(day.id, rows[0]!.next, input)

  return yield* ownedPlanExercise(id)
})

export const removePlanExercise = Effect.fn("removePlanExercise")(function* (planExerciseId: number) {
  const sql = yield* sqlClient
  const existing = yield* ownedPlanExercise(planExerciseId)
  yield* sql`DELETE FROM plan_exercises WHERE id = ${existing.id}`

  return existing
})

const recordAdjustment = Effect.fn("recordAdjustment")(function* (entry: {
  readonly exerciseId: number
  readonly workoutId: number | null
  readonly source: AdjustmentSource
  readonly oldWeight: number | null
  readonly newWeight: number | null
  readonly reason: string
}) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser
  yield* sql`
    INSERT INTO adjustments (user_id, exercise_id, workout_id, source, old_weight, new_weight, reason, created_at)
    VALUES (${user.id}, ${entry.exerciseId}, ${entry.workoutId}, ${entry.source}, ${entry.oldWeight},
      ${entry.newWeight}, ${entry.reason}, ${yield* now})`
})

/** Changes a prescription. A changed target weight is recorded as an adjustment so the user can see why. */
export const updatePlanExercise = Effect.fn("updatePlanExercise")(function* (
  planExerciseId: number,
  patch: PlanExercisePatch,
  source: AdjustmentSource,
  reason?: string,
) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser
  const existing = yield* ownedPlanExercise(planExerciseId)

  const next = {
    sets: patch.sets ?? existing.sets,
    repMin: patch.repMin ?? existing.repMin,
    repMax: patch.repMax ?? existing.repMax,
    targetWeight: patch.targetWeight === undefined ? existing.targetWeight : patch.targetWeight,
    increment: patch.increment ?? existing.increment,
    restSeconds: patch.restSeconds ?? existing.restSeconds,
    notes: patch.notes ?? existing.notes,
    autoProgress: patch.autoProgress ?? existing.autoProgress,
  }

  yield* checkRepRange(next.repMin, next.repMax)
  const weightChanged = next.targetWeight !== existing.targetWeight
  yield* sql`
    UPDATE plan_exercises SET sets = ${next.sets}, rep_min = ${next.repMin}, rep_max = ${next.repMax},
      target_weight = ${next.targetWeight}, increment = ${next.increment}, rest_seconds = ${next.restSeconds},
      notes = ${next.notes}, auto_progress = ${next.autoProgress ? 1 : 0},
      miss_streak = ${weightChanged ? 0 : existing.missStreak}
    WHERE id = ${existing.id}`

  const prescriptionChanged =
    next.sets !== existing.sets || next.repMin !== existing.repMin || next.repMax !== existing.repMax

  if (weightChanged || (prescriptionChanged && source === "ai")) {
    const describe = (weight: number | null) => (weight === null ? "unset" : `${formatWeight(weight)} ${user.unit}`)

    const summary = weightChanged
      ? `Target changed from ${describe(existing.targetWeight)} to ${describe(next.targetWeight)}`
      : `Now ${next.sets} × ${next.repMin}-${next.repMax} (was ${existing.sets} × ${existing.repMin}-${existing.repMax})`

    yield* recordAdjustment({
      exerciseId: existing.exerciseId,
      workoutId: null,
      source,
      oldWeight: existing.targetWeight,
      newWeight: next.targetWeight,
      reason: reason?.trim() ? reason.trim() : summary,
    })
  }

  return { ...existing, ...next, missStreak: weightChanged ? 0 : existing.missStreak } satisfies PlanExercise
})

// ---------------------------------------------------------------- workouts

const WORKOUT_COLUMNS = `id, plan_day_id, name, started_at, finished_at, notes`

const ownedWorkout = Effect.fn("ownedWorkout")(function* (workoutId: number) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  const rows = yield* sql<Workout>`
    SELECT ${sql.unsafe(WORKOUT_COLUMNS)} FROM workouts WHERE id = ${workoutId} AND user_id = ${user.id}`

  return rows[0] ?? (yield* new NotFound({ what: `Workout ${workoutId}` }))
})

export const getActiveWorkout = Effect.fn("getActiveWorkout")(function* () {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  const rows = yield* sql<Workout>`
    SELECT ${sql.unsafe(WORKOUT_COLUMNS)} FROM workouts
    WHERE user_id = ${user.id} AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1`

  return rows[0] ?? null
})

/** Starts a workout for a plan day. Only one workout is in progress at a time, so an open one is returned as is. */
export const startWorkout = Effect.fn("startWorkout")(function* (planDayId: number) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser
  const active = yield* getActiveWorkout()

  if (active) return active.id
  const day = yield* ownedPlanDay(planDayId)

  const rows = yield* sql<{ id: number }>`
    INSERT INTO workouts (user_id, plan_day_id, name, started_at)
    VALUES (${user.id}, ${day.id}, ${day.name}, ${yield* now}) RETURNING id`

  return rows[0]!.id
})

/** Starts a workout that follows no plan day. Exercises are added to it as the session goes. */
export const startOpenWorkout = Effect.fn("startOpenWorkout")(function* () {
  const sql = yield* sqlClient
  const user = yield* CurrentUser
  const active = yield* getActiveWorkout()

  if (active) return active.id

  const rows = yield* sql<{ id: number }>`
    INSERT INTO workouts (user_id, plan_day_id, name, started_at)
    VALUES (${user.id}, NULL, 'Open workout', ${yield* now}) RETURNING id`

  return rows[0]!.id
})

const workoutSets = Effect.fn("workoutSets")(function* (workoutId: number) {
  const sql = yield* sqlClient

  return yield* sql<WorkoutSet & { exerciseName: string }>`
    SELECT s.id, s.exercise_id, e.name AS exercise_name, s.plan_exercise_id, s.set_number, s.weight, s.reps, s.rpe
    FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id
    WHERE s.workout_id = ${workoutId} ORDER BY s.set_number, s.id`
})

const previousSets = Effect.fn("previousSets")(function* (exerciseId: number, before: Workout) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  return yield* sql<{ weight: number; reps: number }>`
    SELECT s.weight, s.reps FROM workout_sets s
    WHERE s.exercise_id = ${exerciseId} AND s.workout_id = (
      SELECT w.id FROM workouts w JOIN workout_sets s2 ON s2.workout_id = w.id
      WHERE w.user_id = ${user.id} AND w.finished_at IS NOT NULL AND w.started_at < ${before.startedAt}
        AND s2.exercise_id = ${exerciseId}
      ORDER BY w.started_at DESC LIMIT 1)
    ORDER BY s.set_number, s.id`
})

const adjustmentsWhere = Effect.fn("adjustmentsWhere")(function* (filter: { workoutId?: number; limit: number }) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  return yield* sql<Adjustment>`
    SELECT a.id, a.exercise_id, e.name AS exercise_name, a.workout_id, a.source, a.old_weight, a.new_weight,
      a.reason, a.created_at
    FROM adjustments a JOIN exercises e ON e.id = a.exercise_id
    WHERE a.user_id = ${user.id} AND (${filter.workoutId ?? null} IS NULL OR a.workout_id = ${filter.workoutId ?? null})
    ORDER BY a.created_at DESC, a.id DESC LIMIT ${filter.limit}`
})

export const listAdjustments = (limit: number) => adjustmentsWhere({ limit })

/** The exercises in a finished workout whose best set beat the best from all earlier workouts. */
const recordExerciseIds = Effect.fn("recordExerciseIds")(function* (workout: Workout) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  // Epley estimate, the same formula as estimateOneRepMax.
  const rows = yield* sql<{ exerciseId: number; here: number | null; before: number | null }>`
    SELECT s.exercise_id,
      MAX(CASE WHEN w.id = ${workout.id}
        THEN s.weight * (1 + CASE WHEN s.reps > 1 THEN s.reps / 30.0 ELSE 0 END) END) AS here,
      MAX(CASE WHEN w.started_at < ${workout.startedAt}
        THEN s.weight * (1 + CASE WHEN s.reps > 1 THEN s.reps / 30.0 ELSE 0 END) END) AS before
    FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
    WHERE w.user_id = ${user.id} AND w.finished_at IS NOT NULL
      AND s.exercise_id IN (SELECT exercise_id FROM workout_sets WHERE workout_id = ${workout.id})
    GROUP BY s.exercise_id`

  return rows.flatMap((row) => (row.here !== null && row.before !== null && row.here > row.before ? [row.exerciseId] : []))
})

export const getWorkoutDetail = Effect.fn("getWorkoutDetail")(function* (workoutId: number) {
  const sql = yield* sqlClient
  const workout = yield* ownedWorkout(workoutId)
  const sets = yield* workoutSets(workout.id)

  const targets =
    workout.planDayId === null
      ? []
      : (yield* sql<PlanExerciseRow>`
          SELECT ${sql.unsafe(PLAN_EXERCISE_COLUMNS)}
          FROM plan_exercises pe JOIN exercises e ON e.id = pe.exercise_id
          WHERE pe.plan_day_id = ${workout.planDayId} ORDER BY pe.position, pe.id`).map(toPlanExercise)

  const swaps = yield* sql<{ planExerciseId: number; exerciseId: number; exerciseName: string }>`
    SELECT ws.plan_exercise_id, ws.exercise_id, e.name AS exercise_name
    FROM workout_swaps ws JOIN exercises e ON e.id = ws.exercise_id WHERE ws.workout_id = ${workout.id}`

  // A finished workout shows what was done; one in progress shows the whole prescription.
  const entries = new Map<number, { exerciseName: string; target: PlanExercise | null; swappedFrom: string | null }>()

  if (workout.finishedAt === null) {
    for (const target of targets) {
      const swap = swaps.find((item) => item.planExerciseId === target.id)

      // A stand-in keeps the sets, reps and rest of the planned exercise, but its weight is its own.
      if (swap) {
        entries.set(swap.exerciseId, {
          exerciseName: swap.exerciseName,
          target: { ...target, targetWeight: null, notes: "" },
          swappedFrom: target.exerciseName,
        })
      } else entries.set(target.exerciseId, { exerciseName: target.exerciseName, target, swappedFrom: null })
    }
  }

  if (workout.finishedAt === null) {
    const extras = yield* sql<{ exerciseId: number; exerciseName: string }>`
      SELECT x.exercise_id, e.name AS exercise_name
      FROM workout_extras x JOIN exercises e ON e.id = x.exercise_id
      WHERE x.workout_id = ${workout.id} ORDER BY x.position`

    for (const extra of extras) {
      if (!entries.has(extra.exerciseId)) {
        entries.set(extra.exerciseId, { exerciseName: extra.exerciseName, target: null, swappedFrom: null })
      }
    }
  }

  for (const set of sets) {
    if (!entries.has(set.exerciseId)) {
      entries.set(set.exerciseId, {
        exerciseName: set.exerciseName,
        target: targets.find((target) => target.exerciseId === set.exerciseId) ?? null,
        swappedFrom: null,
      })
    }
  }

  const exercises = yield* Effect.forEach(
    entries,
    ([exerciseId, entry]) =>
      Effect.map(previousSets(exerciseId, workout), (previous): WorkoutExercise => ({
        exerciseId,
        exerciseName: entry.exerciseName,
        target: entry.target,
        swappedFrom: entry.swappedFrom,
        sets: sets.flatMap((set): ReadonlyArray<WorkoutSet> =>
          set.exerciseId === exerciseId
            ? [
                {
                  id: set.id,
                  exerciseId: set.exerciseId,
                  planExerciseId: set.planExerciseId,
                  setNumber: set.setNumber,
                  weight: set.weight,
                  reps: set.reps,
                  rpe: set.rpe,
                },
              ]
            : [],
        ),
        previous,
      })),
    { concurrency: 4 },
  )

  const adjustments = yield* adjustmentsWhere({ workoutId: workout.id, limit: 50 })
  const records = workout.finishedAt === null ? [] : yield* recordExerciseIds(workout)

  return { workout, exercises, adjustments, records } satisfies WorkoutDetail
})

export const logSet = Effect.fn("logSet")(function* (
  workoutId: number,
  input: SetInput & { readonly exerciseId: number },
) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser
  const workout = yield* ownedWorkout(workoutId)

  if (workout.finishedAt !== null) return yield* new Invalid({ reason: "This workout is already finished" })

  const exercises = yield* sql<{ id: number }>`
    SELECT id FROM exercises WHERE id = ${input.exerciseId} AND user_id = ${user.id}`

  if (!exercises[0]) return yield* new NotFound({ what: `Exercise ${input.exerciseId}` })

  const planExercises =
    workout.planDayId === null
      ? []
      : yield* sql<{ id: number }>`
          SELECT id FROM plan_exercises
          WHERE plan_day_id = ${workout.planDayId} AND exercise_id = ${input.exerciseId} LIMIT 1`

  const rows = yield* sql<{ id: number }>`
    INSERT INTO workout_sets (workout_id, exercise_id, plan_exercise_id, set_number, weight, reps, rpe, created_at)
    VALUES (${workout.id}, ${input.exerciseId}, ${planExercises[0]?.id ?? null},
      (SELECT COALESCE(MAX(set_number), 0) + 1 FROM workout_sets
        WHERE workout_id = ${workout.id} AND exercise_id = ${input.exerciseId}),
      ${input.weight}, ${input.reps}, ${input.rpe ?? null}, ${yield* now})
    RETURNING id`

  return rows[0]!.id
})

/**
 * Swaps a planned exercise for another one in this workout only, such as when
 * the equipment is taken. Naming the planned exercise itself undoes the swap.
 */
export const swapExercise = Effect.fn("swapExercise")(function* (
  workoutId: number,
  planExerciseId: number,
  exerciseName: string,
) {
  const sql = yield* sqlClient
  const workout = yield* ownedWorkout(workoutId)

  if (workout.finishedAt !== null) return yield* new Invalid({ reason: "This workout is already finished" })

  const planned = yield* sql<{ id: number; exerciseId: number; muscleGroup: string }>`
    SELECT pe.id, pe.exercise_id, e.muscle_group
    FROM plan_exercises pe JOIN exercises e ON e.id = pe.exercise_id
    WHERE pe.plan_day_id = ${workout.planDayId}`

  const original = planned.find((item) => item.id === planExerciseId)

  if (!original) return yield* new NotFound({ what: "That exercise in this workout" })

  const current = yield* sql<{ exerciseId: number }>`
    SELECT exercise_id FROM workout_swaps WHERE workout_id = ${workout.id} AND plan_exercise_id = ${original.id}`

  const logged = yield* sql<{ id: number }>`
    SELECT id FROM workout_sets
    WHERE workout_id = ${workout.id} AND exercise_id = ${current[0]?.exerciseId ?? original.exerciseId} LIMIT 1`

  if (logged[0]) return yield* new Invalid({ reason: "Remove the sets you logged for it before swapping" })

  const replacementId = yield* exerciseIdFor(exerciseName, original.muscleGroup)

  if (replacementId === original.exerciseId) {
    yield* sql`DELETE FROM workout_swaps WHERE workout_id = ${workout.id} AND plan_exercise_id = ${original.id}`

    return
  }

  if (planned.some((item) => item.exerciseId === replacementId)) {
    return yield* new Invalid({ reason: `${exerciseName} is already in this workout` })
  }

  const taken = yield* sql<{ planExerciseId: number }>`
    SELECT plan_exercise_id FROM workout_swaps
    WHERE workout_id = ${workout.id} AND exercise_id = ${replacementId} AND plan_exercise_id != ${original.id}`

  if (taken[0]) return yield* new Invalid({ reason: `${exerciseName} is already in this workout` })

  yield* sql`
    INSERT INTO workout_swaps (workout_id, plan_exercise_id, exercise_id)
    VALUES (${workout.id}, ${original.id}, ${replacementId})
    ON CONFLICT (workout_id, plan_exercise_id) DO UPDATE SET exercise_id = excluded.exercise_id`
})

/** Adds an exercise to a workout in progress, on top of whatever the plan prescribes. */
export const addWorkoutExercise = Effect.fn("addWorkoutExercise")(function* (workoutId: number, exerciseName: string) {
  const sql = yield* sqlClient
  const detail = yield* getWorkoutDetail(workoutId)

  if (detail.workout.finishedAt !== null) return yield* new Invalid({ reason: "This workout is already finished" })

  const exerciseId = yield* exerciseIdFor(exerciseName, "")

  if (detail.exercises.some((exercise) => exercise.exerciseId === exerciseId)) {
    return yield* new Invalid({ reason: `${exerciseName} is already in this workout` })
  }

  yield* sql`
    INSERT INTO workout_extras (workout_id, exercise_id, position)
    VALUES (${workoutId}, ${exerciseId},
      (SELECT COALESCE(MAX(position), -1) + 1 FROM workout_extras WHERE workout_id = ${workoutId}))
    ON CONFLICT (workout_id, exercise_id) DO NOTHING`
})

/** Takes an added exercise back out of a workout. Only allowed while it has no sets. */
export const removeWorkoutExercise = Effect.fn("removeWorkoutExercise")(function* (
  workoutId: number,
  exerciseId: number,
) {
  const sql = yield* sqlClient
  const workout = yield* ownedWorkout(workoutId)

  const logged = yield* sql<{ id: number }>`
    SELECT id FROM workout_sets WHERE workout_id = ${workout.id} AND exercise_id = ${exerciseId} LIMIT 1`

  if (logged[0]) return yield* new Invalid({ reason: "Remove its sets first" })

  yield* sql`DELETE FROM workout_extras WHERE workout_id = ${workout.id} AND exercise_id = ${exerciseId}`
})

const ownedSet = Effect.fn("ownedSet")(function* (setId: number) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  const rows = yield* sql<{ id: number; finishedAt: number | null }>`
    SELECT s.id, w.finished_at FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
    WHERE s.id = ${setId} AND w.user_id = ${user.id}`

  const row = rows[0] ?? (yield* new NotFound({ what: `Set ${setId}` }))

  if (row.finishedAt !== null) return yield* new Invalid({ reason: "This workout is already finished" })

  return row
})

export const updateSet = Effect.fn("updateSet")(function* (setId: number, input: SetInput) {
  const sql = yield* sqlClient
  const set = yield* ownedSet(setId)
  yield* sql`UPDATE workout_sets SET weight = ${input.weight}, reps = ${input.reps}, rpe = ${input.rpe ?? null}
    WHERE id = ${set.id}`
})

export const deleteSet = Effect.fn("deleteSet")(function* (setId: number) {
  const sql = yield* sqlClient
  const set = yield* ownedSet(setId)
  yield* sql`DELETE FROM workout_sets WHERE id = ${set.id}`
})

export const discardWorkout = Effect.fn("discardWorkout")(function* (workoutId: number) {
  const sql = yield* sqlClient
  const workout = yield* ownedWorkout(workoutId)
  yield* sql`DELETE FROM workout_sets WHERE workout_id = ${workout.id}`
  yield* sql`DELETE FROM workout_swaps WHERE workout_id = ${workout.id}`
  yield* sql`DELETE FROM workout_extras WHERE workout_id = ${workout.id}`
  yield* sql`DELETE FROM workouts WHERE id = ${workout.id}`
})

/**
 * Finishes a workout and runs the built-in progression rules over each
 * prescribed exercise. Returns the weight changes it made.
 */
export const finishWorkout = Effect.fn("finishWorkout")(function* (workoutId: number) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser
  const detail = yield* getWorkoutDetail(workoutId)

  if (detail.workout.finishedAt !== null) return { discarded: false, adjustments: detail.adjustments }

  if (detail.exercises.every((exercise) => exercise.sets.length === 0)) {
    yield* discardWorkout(workoutId)

    const none: ReadonlyArray<Adjustment> = []

    return { discarded: true, adjustments: none }
  }

  yield* sql`UPDATE workouts SET finished_at = ${yield* now} WHERE id = ${workoutId}`

  for (const exercise of detail.exercises) {
    const target = exercise.target

    // A stand-in says nothing about the planned exercise, so its target is left alone.
    if (!target || !target.autoProgress || exercise.swappedFrom !== null) continue
    const decision = evaluateProgression(target, exercise.sets, user.unit)

    if (decision.kind === "none") continue

    if (decision.kind === "hold") {
      if (decision.missStreak !== target.missStreak) {
        yield* sql`UPDATE plan_exercises SET miss_streak = ${decision.missStreak} WHERE id = ${target.id}`
      }

      continue
    }

    yield* sql`UPDATE plan_exercises SET target_weight = ${decision.newWeight}, miss_streak = ${decision.missStreak}
      WHERE id = ${target.id}`
    yield* recordAdjustment({
      exerciseId: exercise.exerciseId,
      workoutId,
      source: "rule",
      oldWeight: target.targetWeight,
      newWeight: decision.newWeight,
      reason: decision.reason,
    })
  }

  return { discarded: false, adjustments: yield* adjustmentsWhere({ workoutId, limit: 50 }) }
})

export const listWorkouts = Effect.fn("listWorkouts")(function* (limit: number) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  return yield* sql<WorkoutSummary>`
    SELECT w.id, w.plan_day_id, w.name, w.started_at, w.finished_at, w.notes,
      COUNT(s.id) AS set_count, COALESCE(SUM(s.weight * s.reps), 0) AS volume
    FROM workouts w LEFT JOIN workout_sets s ON s.workout_id = w.id
    WHERE w.user_id = ${user.id} AND w.finished_at IS NOT NULL
    GROUP BY w.id ORDER BY w.started_at DESC LIMIT ${limit}`
})

export interface ActivityEntry {
  readonly startedAt: number
  readonly volume: number
}

/** When each finished workout in the last `days` days happened and how much was lifted, oldest first. */
export const listActivity = Effect.fn("listActivity")(function* (days: number) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser
  const since = (yield* now) - days * 86_400_000

  return yield* sql<ActivityEntry>`
    SELECT w.started_at, COALESCE(SUM(s.weight * s.reps), 0) AS volume
    FROM workouts w LEFT JOIN workout_sets s ON s.workout_id = w.id
    WHERE w.user_id = ${user.id} AND w.finished_at IS NOT NULL AND w.started_at >= ${since}
    GROUP BY w.id ORDER BY w.started_at`
})

export interface HistoryWorkout {
  readonly id: number
  readonly name: string
  readonly date: string
  readonly durationMinutes: number | null
  readonly notes: string
  readonly exercises: ReadonlyArray<{
    readonly exercise: string
    readonly sets: ReadonlyArray<{ readonly weight: number; readonly reps: number; readonly rpe: number | null }>
  }>
}

/** Finished workouts with every set, newest first. This is what the AI coach reads. */
export const getHistory = Effect.fn("getHistory")(function* (options: {
  readonly since: number
  readonly exercise?: string
  readonly limit: number
}) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser
  const exercise = options.exercise?.trim() || null

  const rows = yield* sql<{
    id: number
    name: string
    startedAt: number
    finishedAt: number
    notes: string
    exerciseName: string
    weight: number
    reps: number
    rpe: number | null
  }>`
    SELECT w.id, w.name, w.started_at, w.finished_at, w.notes, e.name AS exercise_name, s.weight, s.reps, s.rpe
    FROM workouts w
    JOIN workout_sets s ON s.workout_id = w.id
    JOIN exercises e ON e.id = s.exercise_id
    WHERE w.user_id = ${user.id} AND w.finished_at IS NOT NULL AND w.started_at >= ${options.since}
      AND (${exercise} IS NULL OR e.name = ${exercise})
    ORDER BY w.started_at DESC, s.id`

  type MutableEntry = { exercise: string; sets: Array<{ weight: number; reps: number; rpe: number | null }> }

  const workouts = new Map<number, Omit<HistoryWorkout, "exercises"> & { exercises: Array<MutableEntry> }>()

  for (const row of rows) {
    let workout = workouts.get(row.id)

    if (!workout) {
      if (workouts.size >= options.limit) continue
      workout = {
        id: row.id,
        name: row.name,
        date: new Date(row.startedAt).toISOString(),
        durationMinutes: Math.round((row.finishedAt - row.startedAt) / 60000),
        notes: row.notes,
        exercises: [],
      }
      workouts.set(row.id, workout)
    }

    let entry = workout.exercises.find((item) => item.exercise === row.exerciseName)

    if (!entry) {
      entry = { exercise: row.exerciseName, sets: [] }
      workout.exercises.push(entry)
    }

    entry.sets.push({ weight: row.weight, reps: row.reps, rpe: row.rpe })
  }

  return [...workouts.values()] satisfies ReadonlyArray<HistoryWorkout>
})

export interface ProgressPoint {
  readonly workoutId: number
  readonly date: number
  readonly topWeight: number
  readonly topReps: number
  readonly estimatedOneRepMax: number
  readonly volume: number
  readonly sets: number
}

const progressPoints = Effect.fn("progressPoints")(function* (exerciseId: number, limit: number) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  const rows = yield* sql<{ workoutId: number; startedAt: number; weight: number; reps: number }>`
    SELECT w.id AS workout_id, w.started_at, s.weight, s.reps
    FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
    WHERE w.user_id = ${user.id} AND w.finished_at IS NOT NULL AND s.exercise_id = ${exerciseId}
    ORDER BY w.started_at, s.id`

  const points = new Map<number, ProgressPoint>()

  for (const row of rows) {
    const current = points.get(row.workoutId)
    const better = !current || row.weight > current.topWeight || (row.weight === current.topWeight && row.reps > current.topReps)
    points.set(row.workoutId, {
      workoutId: row.workoutId,
      date: row.startedAt,
      topWeight: better ? row.weight : current.topWeight,
      topReps: better ? row.reps : current.topReps,
      estimatedOneRepMax: Math.max(current?.estimatedOneRepMax ?? 0, estimateOneRepMax(row.weight, row.reps)),
      volume: (current?.volume ?? 0) + row.weight * row.reps,
      sets: (current?.sets ?? 0) + 1,
    })
  }

  return [...points.values()].slice(-limit)
})

export const getExerciseProgress = Effect.fn("getExerciseProgress")(function* (
  exercise: { readonly id: number } | { readonly name: string },
  limit: number,
) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  const rows =
    "id" in exercise
      ? yield* sql<{ id: number; name: string }>`
          SELECT id, name FROM exercises WHERE id = ${exercise.id} AND user_id = ${user.id}`
      : yield* sql<{ id: number; name: string }>`
          SELECT id, name FROM exercises WHERE name = ${exercise.name.trim()} AND user_id = ${user.id}`

  const found = rows[0] ?? (yield* new NotFound({ what: "Exercise" }))

  return { exercise: found, points: yield* progressPoints(found.id, limit) }
})

/** Records a workout that already happened (told to the AI coach rather than logged in the app). */
export const logPastWorkout = Effect.fn("logPastWorkout")(function* (input: {
  readonly name: string
  readonly date?: string
  readonly notes?: string
  readonly exercises: ReadonlyArray<{ readonly exercise: string; readonly sets: ReadonlyArray<SetInput> }>
}) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser
  const current = yield* now
  const startedAt = input.date ? Date.parse(input.date) : current

  if (Number.isNaN(startedAt)) return yield* new Invalid({ reason: `"${input.date}" is not a date` })

  if (startedAt > current + 86_400_000) return yield* new Invalid({ reason: "The workout date is in the future" })

  const rows = yield* sql<{ id: number }>`
    INSERT INTO workouts (user_id, plan_day_id, name, started_at, finished_at, notes)
    VALUES (${user.id}, ${null}, ${input.name}, ${startedAt}, ${startedAt}, ${input.notes ?? ""}) RETURNING id`

  const workoutId = rows[0]!.id

  for (const entry of input.exercises) {
    const exerciseId = yield* ensureExercise(entry.exercise)

    for (const [index, set] of entry.sets.entries()) {
      yield* sql`
        INSERT INTO workout_sets (workout_id, exercise_id, set_number, weight, reps, rpe, created_at)
        VALUES (${workoutId}, ${exerciseId}, ${index + 1}, ${set.weight}, ${set.reps}, ${set.rpe ?? null}, ${startedAt})`
    }
  }

  return workoutId
})

// ---------------------------------------------------------------- coach notes

export const addCoachNote = Effect.fn("addCoachNote")(function* (body: string) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser
  yield* sql`INSERT INTO coach_notes (user_id, body, created_at) VALUES (${user.id}, ${body}, ${yield* now})`
})

export const listCoachNotes = Effect.fn("listCoachNotes")(function* (limit: number) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  return yield* sql<CoachNote>`
    SELECT id, body, created_at FROM coach_notes WHERE user_id = ${user.id} ORDER BY created_at DESC, id DESC LIMIT ${limit}`
})

export const deleteCoachNote = Effect.fn("deleteCoachNote")(function* (noteId: number) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser
  yield* sql`DELETE FROM coach_notes WHERE id = ${noteId} AND user_id = ${user.id}`
})

// ---------------------------------------------------------------- today

// ---------------------------------------------------------------- body

export interface Measurement {
  readonly id: number
  readonly kind: MeasurementKind
  readonly value: number
  readonly measuredAt: number
}

export const logMeasurement = Effect.fn("logMeasurement")(function* (input: MeasurementInput, measuredAt?: number) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  yield* sql`
    INSERT INTO body_measurements (user_id, kind, value, measured_at)
    VALUES (${user.id}, ${input.kind}, ${input.value}, ${measuredAt ?? (yield* now)})`
})

/** Body measurements, newest first. */
export const listMeasurements = Effect.fn("listMeasurements")(function* (limit: number) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  return yield* sql<Measurement>`
    SELECT id, kind, value, measured_at FROM body_measurements
    WHERE user_id = ${user.id} ORDER BY measured_at DESC, id DESC LIMIT ${limit}`
})

export const deleteMeasurement = Effect.fn("deleteMeasurement")(function* (measurementId: number) {
  const sql = yield* sqlClient
  const user = yield* CurrentUser

  yield* sql`DELETE FROM body_measurements WHERE id = ${measurementId} AND user_id = ${user.id}`
})

/** The plan day that follows the most recently finished one, wrapping round. */
export const nextPlanDayId = (plan: Plan | null, lastPlanDayId: number | null): number | null => {
  if (!plan || plan.days.length === 0) return null
  const index = plan.days.findIndex((day) => day.id === lastPlanDayId)

  return plan.days[(index + 1) % plan.days.length]!.id
}

export const getToday = Effect.fn("getToday")(function* () {
  const plan = yield* getActivePlan()
  const activeWorkout = yield* getActiveWorkout()
  const recent = yield* listWorkouts(5)
  const lastPlanned = recent.find((workout) => workout.planDayId !== null)

  return {
    plan,
    activeWorkout,
    nextDayId: nextPlanDayId(plan, lastPlanned?.planDayId ?? null),
    recentWorkouts: recent,
    notes: yield* listCoachNotes(3),
    adjustments: yield* listAdjustments(6),
  }
})
