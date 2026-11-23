/**
 * Which exercise in a workout in progress is the one being done now, and which were left
 * with sets still to do. Both clients use this, so they agree on where the workout is.
 */

export interface FocusExercise {
  /** Sets the plan prescribes, or 0 for an exercise added during the workout. */
  readonly planned: number
  /** Sets logged so far. */
  readonly logged: number
  /** When the latest of those sets was logged, as any number that grows with time (a set id will do). Null with none. */
  readonly latest: number | null
}

export interface WorkoutFocus {
  /** The index of the exercise to do now, or null in an empty workout. */
  readonly current: number | null
  /** The indexes of planned exercises that were started, then left for another with sets still to do. */
  readonly skipped: ReadonlySet<number>
}

const isDone = (exercise: FocusExercise) => exercise.planned > 0 && exercise.logged >= exercise.planned

/**
 * Logging a set on another exercise moves the workout on: an exercise left part-way counts as
 * skipped, and the one after the exercise logged most recently comes next. Its sets can still be
 * logged later, which takes it off the skipped list.
 */
export const workoutFocus = (exercises: ReadonlyArray<FocusExercise>): WorkoutFocus => {
  let last: number | null = null

  exercises.forEach((exercise, index) => {
    const best = last === null ? null : exercises[last]!.latest

    if (exercise.latest !== null && (best === null || exercise.latest > best)) last = index
  })

  const skipped = new Set<number>()

  exercises.forEach((exercise, index) => {
    if (index !== last && exercise.planned > 0 && exercise.logged > 0 && !isDone(exercise)) skipped.add(index)
  })

  const open = (index: number) => {
    const exercise = exercises[index]!

    return exercise.planned > 0 && !isDone(exercise) && !skipped.has(index)
  }

  const indexes = exercises.map((_, index) => index)

  // The exercise being logged stays current until its prescription is done. An added one has none, so it stays.
  if (last !== null && !isDone(exercises[last]!)) return { current: last, skipped }

  const next =
    indexes.find((index) => (last === null || index > last) && open(index)) ?? indexes.find(open) ?? last ?? indexes.at(-1) ?? null

  return { current: next, skipped }
}

/** Where one exercise of a workout in progress stands. Shown in its card's `data-state` too. */
export const EXERCISE_STATES = { done: "done", current: "current", skipped: "skipped", todo: "todo" } as const

export type ExerciseState = keyof typeof EXERCISE_STATES

/** Where each exercise stands, in the same order. A finished prescription reads as done even when it is current. */
export const exerciseStates = (exercises: ReadonlyArray<FocusExercise>): ReadonlyArray<ExerciseState> => {
  const { current, skipped } = workoutFocus(exercises)

  return exercises.map((exercise, index) =>
    isDone(exercise) ? "done" : index === current ? "current" : skipped.has(index) ? "skipped" : "todo",
  )
}

/** How many prescribed sets were left behind on skipped exercises. */
export const skippedSetCount = (exercises: ReadonlyArray<FocusExercise>): number => {
  const { skipped } = workoutFocus(exercises)

  return [...skipped].reduce((total, index) => total + exercises[index]!.planned - exercises[index]!.logged, 0)
}
