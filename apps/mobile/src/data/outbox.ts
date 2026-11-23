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

/** A change to a set the server already has, such as a weight typed wrong. */
export interface UpdateSetOp {
  readonly kind: "updateSet"
  readonly key: string
  readonly workoutId: number
  readonly setId: number
  readonly set: SetValues
}

export type PendingOp = LogSetOp | DeleteSetOp | UpdateSetOp

/** Puts every set logged on the phone after every set the server has. */
const PENDING_ORDER = 2 ** 40

/** A set as the workout screen shows it. `pendingKey` is set while it is still waiting to be sent. */
export interface ShownSet extends WorkoutSet {
  readonly pendingKey: string | null
  /** When it was logged relative to the workout's other sets: higher is later. */
  readonly order: number
}

export interface ShownExercise extends Omit<WorkoutExercise, "sets"> {
  readonly sets: ReadonlyArray<ShownSet>
}

export interface ShownWorkout extends Omit<WorkoutDetail, "exercises"> {
  readonly exercises: ReadonlyArray<ShownExercise>
}

/** A set's values as the server would describe them. */
const valuesOf = (values: SetValues) => ({
  weight: values.weight,
  reps: values.reps,
  rpe: values.rpe ?? null,
  durationSeconds: values.durationSeconds ?? null,
  distance: values.distance ?? null,
  note: values.note?.trim() ?? "",
})

const asSet = (op: LogSetOp, setNumber: number): WorkoutSet => ({
  id: 0,
  exerciseId: op.exerciseId,
  planExerciseId: null,
  setNumber,
  ...valuesOf(op.set),
})

/** The workout as the server last described it, with everything still waiting to be sent laid over it. */
export const withPending = (detail: WorkoutDetail, ops: ReadonlyArray<PendingOp>): ShownWorkout => {
  const mine = ops.filter((op) => op.workoutId === detail.workout.id)
  const deleted = new Set(mine.flatMap((op) => (op.kind === "deleteSet" ? [op.setId] : [])))

  // The latest change to each set wins, as it will on the server once they are all sent.
  const changes = new Map(mine.flatMap((op) => (op.kind === "updateSet" ? [[op.setId, op.set] as const] : [])))

  return {
    ...detail,
    exercises: detail.exercises.map((exercise) => {
      const kept = exercise.sets.flatMap((set): ReadonlyArray<ShownSet> => {
        if (deleted.has(set.id)) return []

        const change = changes.get(set.id)

        const values = change ? { ...set, ...valuesOf(change) } : set

        return [{ ...values, pendingKey: null, order: set.id }]
      })

      const waiting = mine.flatMap((op) => (op.kind === "logSet" && op.exerciseId === exercise.exerciseId ? [op] : []))

      return {
        ...exercise,
        sets: [
          ...kept,
          ...waiting.map(
            (op, index): ShownSet => ({
              ...asSet(op, kept.length + index + 1),
              pendingKey: op.key,
              order: PENDING_ORDER + mine.indexOf(op),
            }),
          ),
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

/** The same, once the server has confirmed a change to a set. */
export const withChangedSet = (detail: WorkoutDetail, op: UpdateSetOp): WorkoutDetail => ({
  ...detail,
  exercises: detail.exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => (set.id === op.setId ? { ...set, ...valuesOf(op.set) } : set)),
  })),
})

/**
 * The queue with a set changed: a set still waiting to be sent is logged with the new values
 * instead, and a set the server has gets a change queued, replacing one not yet sent.
 * A set that was waiting when its form opened may have been sent since; `sentIds` gives the id the
 * server gave it, and the change is queued against that. Null when the set is on its way right now,
 * or was sent and its id is not known, which the screen asks to try again.
 */
export const withEditedSet = (
  ops: ReadonlyArray<PendingOp>,
  target: { readonly workoutId: number; readonly setId: number; readonly pendingKey: string | null },
  values: SetValues,
  sending: string | null,
  newKey: string,
  sentIds: ReadonlyMap<string, number> = new Map(),
): ReadonlyArray<PendingOp> | null => {
  let setId = target.setId

  if (target.pendingKey !== null) {
    if (target.pendingKey === sending) return null

    if (ops.some((op) => op.key === target.pendingKey && op.kind === "logSet")) {
      return ops.map((op) => (op.key === target.pendingKey && op.kind === "logSet" ? { ...op, set: values } : op))
    }

    const sent = sentIds.get(target.pendingKey)

    if (sent === undefined) return null

    setId = sent
  }

  const queued = ops.find((op) => op.kind === "updateSet" && op.setId === setId && op.key !== sending)

  if (queued) return ops.map((op) => (op === queued ? { ...queued, set: values } : op))

  return [...ops, { kind: "updateSet", key: newKey, workoutId: target.workoutId, setId, set: values }]
}

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
