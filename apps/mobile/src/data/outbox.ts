import type { CallInput } from "~/server/calls"
import type { WorkoutDetail, WorkoutExercise, WorkoutSet } from "~/server/repo"

/**
 * Sets logged on the phone that the server has not confirmed yet. A set is shown the
 * moment it is logged and sent in the background, so logging works with no signal.
 * This file is the plain logic; outbox-store.ts keeps the queue and sends it.
 */

export type SetValues = CallInput<"logSet">["set"]

export interface LogSetOp {
  readonly kind: "logSet"
  /** Made up on the phone. The server uses it to log the set once however often it is sent. */
  readonly key: string
  readonly workoutId: number
  readonly exerciseId: number
  readonly set: SetValues
}

export interface DeleteSetOp {
  readonly kind: "deleteSet"
  readonly key: string
  readonly workoutId: number
  readonly setId: number
}

export type PendingOp = LogSetOp | DeleteSetOp

/** A set as the workout screen shows it. `pendingKey` is set while it is still waiting to be sent. */
export interface ShownSet extends WorkoutSet {
  readonly pendingKey: string | null
}

export interface ShownExercise extends Omit<WorkoutExercise, "sets"> {
  readonly sets: ReadonlyArray<ShownSet>
}

export interface ShownWorkout extends Omit<WorkoutDetail, "exercises"> {
  readonly exercises: ReadonlyArray<ShownExercise>
}

const asSet = (op: LogSetOp, setNumber: number): WorkoutSet => ({
  id: 0,
  exerciseId: op.exerciseId,
  planExerciseId: null,
  setNumber,
  weight: op.set.weight,
  reps: op.set.reps,
  rpe: op.set.rpe ?? null,
  durationSeconds: op.set.durationSeconds ?? null,
  distance: op.set.distance ?? null,
})

/** The workout as the server last described it, with everything still waiting to be sent laid over it. */
export const withPending = (detail: WorkoutDetail, ops: ReadonlyArray<PendingOp>): ShownWorkout => {
  const mine = ops.filter((op) => op.workoutId === detail.workout.id)
  const deleted = new Set(mine.flatMap((op) => (op.kind === "deleteSet" ? [op.setId] : [])))

  return {
    ...detail,
    exercises: detail.exercises.map((exercise) => {
      const kept = exercise.sets.flatMap((set): ReadonlyArray<ShownSet> =>
        deleted.has(set.id) ? [] : [{ ...set, pendingKey: null }],
      )

      const waiting = mine.flatMap((op) => (op.kind === "logSet" && op.exerciseId === exercise.exerciseId ? [op] : []))

      return {
        ...exercise,
        sets: [
          ...kept,
          ...waiting.map((op, index): ShownSet => ({ ...asSet(op, kept.length + index + 1), pendingKey: op.key })),
        ],
      }
    }),
  }
}

/** The server's description of a workout once it has confirmed a set, so the set does not flicker away before the next refresh. */
export const withSentSet = (detail: WorkoutDetail, op: LogSetOp, setId: number): WorkoutDetail => ({
  ...detail,
  exercises: detail.exercises.map((exercise) =>
    exercise.exerciseId !== op.exerciseId || exercise.sets.some((set) => set.id === setId)
      ? exercise
      : { ...exercise, sets: [...exercise.sets, { ...asSet(op, exercise.sets.length + 1), id: setId }] },
  ),
})

/** The same, once the server has confirmed a set is gone. */
export const withoutSet = (detail: WorkoutDetail, setId: number): WorkoutDetail => ({
  ...detail,
  exercises: detail.exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.filter((set) => set.id !== setId),
  })),
})

export const withoutOp = (ops: ReadonlyArray<PendingOp>, key: string): ReadonlyArray<PendingOp> =>
  ops.filter((op) => op.key !== key)

/** How many sets of a workout are still waiting to be sent or removed. */
export const waitingFor = (ops: ReadonlyArray<PendingOp>, workoutId: number): number =>
  ops.filter((op) => op.workoutId === workoutId).length
