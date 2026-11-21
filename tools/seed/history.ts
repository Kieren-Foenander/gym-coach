import { catalogByName, muscleGroupFor } from "../../src/domain/catalog"

/**
 * A training history in the app's own terms, ready to load into any account.
 * `seed/training-history.json` is one of these: real data converted from Gymverse.
 */
export interface History {
  /** Where the data came from. Shown nowhere; it is for whoever opens the file. */
  readonly about: string
  /** The unit every weight is in. Load it only into an account that uses the same unit. */
  readonly unit: "kg" | "lb"
  /** The muscle group of each exercise the built-in library does not have. */
  readonly customExercises: Readonly<Record<string, string>>
  readonly workouts: ReadonlyArray<HistoryWorkout>
}

export interface HistoryWorkout {
  readonly name: string
  /** ISO 8601 with the offset the workout happened in. */
  readonly startedAt: string
  readonly finishedAt: string
  readonly notes: string
  readonly exercises: ReadonlyArray<HistoryExercise>
}

export interface HistoryExercise {
  /** A library name, or a key of `customExercises`. */
  readonly name: string
  readonly sets: ReadonlyArray<HistorySet>
}

/** A lifting set has weight and reps. A cardio set has only a duration. */
export interface HistorySet {
  readonly weight?: number
  readonly reps?: number
  readonly rpe?: number
  readonly durationSeconds?: number
}

/** Which account to load into: by id, or by the email it signs in with. */
export type Target = { readonly userId: string } | { readonly email: string }

const text = (value: string) => `'${value.replaceAll("'", "''")}'`

const num = (value: number | undefined) => (value === undefined ? "NULL" : String(value))

const userOf = (target: Target) =>
  "userId" in target ? text(target.userId) : `(SELECT id FROM users WHERE email = ${text(target.email)})`

export const groupOf = (history: History, name: string): string =>
  catalogByName(name) ? muscleGroupFor(name, "") : (history.customExercises[name] ?? "")

/** Every exercise name the history uses, once each, in the order first used. */
export const exerciseNames = (history: History): ReadonlyArray<string> => [
  ...new Set(history.workouts.flatMap((workout) => workout.exercises.map((exercise) => exercise.name))),
]

/**
 * SQL that adds the history to an account. Running it again adds nothing new: a workout is skipped
 * when the account already has one that started at the same moment, and each set carries a client key.
 * The statements never mention row ids, so they work on any copy of the database.
 */
export const seedStatements = (history: History, target: Target): ReadonlyArray<string> => {
  const user = userOf(target)

  const exercises = exerciseNames(history).map(
    (name) => `INSERT INTO exercises (user_id, name, muscle_group) VALUES (${user}, ${text(name)}, ${text(groupOf(history, name))})
ON CONFLICT (user_id, name) DO NOTHING;`,
  )

  const workouts = history.workouts.flatMap((workout) => {
    const startedAt = Date.parse(workout.startedAt)
    const finishedAt = Date.parse(workout.finishedAt)

    const sets = workout.exercises.flatMap((exercise, exerciseIndex) =>
      exercise.sets.map((set, setIndex) => ({ name: exercise.name, exerciseIndex, set, setIndex })),
    )

    // The history keeps no time per set, so the sets are spread evenly across the workout, in order.
    const step = sets.length === 0 ? 0 : Math.floor((finishedAt - startedAt) / sets.length)

    const rows = sets.map(({ name, exerciseIndex, set, setIndex }, order) => {
      const key = `seed:${exerciseIndex + 1}:${setIndex + 1}`

      return `(${text(name)}, ${setIndex + 1}, ${set.weight ?? 0}, ${set.reps ?? 0}, ${num(set.rpe)}, ${num(set.durationSeconds)}, ${startedAt + step * order}, ${text(key)})`
    })

    const insertWorkout = `INSERT INTO workouts (user_id, name, started_at, finished_at, notes)
SELECT ${user}, ${text(workout.name)}, ${startedAt}, ${finishedAt}, ${text(workout.notes)}
WHERE NOT EXISTS (SELECT 1 FROM workouts WHERE user_id = ${user} AND started_at = ${startedAt});`

    if (rows.length === 0) return [insertWorkout]

    const insertSets = `INSERT OR IGNORE INTO workout_sets
  (workout_id, exercise_id, set_number, weight, reps, rpe, duration_seconds, created_at, client_key)
SELECT w.id, e.id, v.column2, v.column3, v.column4, v.column5, v.column6, v.column7, v.column8
FROM (VALUES ${rows.join(",\n  ")}) AS v
JOIN workouts w ON w.user_id = ${user} AND w.started_at = ${startedAt}
JOIN exercises e ON e.user_id = ${user} AND e.name = v.column1;`

    return [insertWorkout, insertSets]
  })

  return [...exercises, ...workouts]
}
