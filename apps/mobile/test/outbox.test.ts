import { describe, expect, it } from "vitest"
import type { WorkoutDetail, WorkoutSet } from "~/server/repo"
import { waitingFor, withoutOp, withoutSet, withPending, withSentSet, type LogSetOp, type PendingOp } from "@/data/outbox"

const set = (id: number, exerciseId: number, setNumber: number): WorkoutSet => ({
  id,
  exerciseId,
  planExerciseId: null,
  setNumber,
  weight: 60,
  reps: 8,
  rpe: null,
  durationSeconds: null,
  distance: null,
})

const detail: WorkoutDetail = {
  workout: { id: 1, planDayId: null, name: "Push", startedAt: 0, finishedAt: null, notes: "" },
  exercises: [
    { exerciseId: 10, exerciseName: "Bench Press", target: null, swappedFrom: null, previous: [], sets: [set(100, 10, 1)] },
    { exerciseId: 11, exerciseName: "Dip", target: null, swappedFrom: null, previous: [], sets: [] },
  ],
  adjustments: [],
  records: [],
  health: null,
}

const logged = (key: string, exerciseId: number, workoutId = 1): LogSetOp => ({
  kind: "logSet",
  key,
  workoutId,
  exerciseId,
  set: { weight: 62.5, reps: 6, rpe: 9 },
})

const setsOf = (ops: ReadonlyArray<PendingOp>, exerciseId: number) =>
  withPending(detail, ops).exercises.find((exercise) => exercise.exerciseId === exerciseId)?.sets ?? []

describe("withPending", () => {
  it("leaves the workout as it is when nothing is waiting", () => {
    expect(setsOf([], 10)).toEqual([{ ...set(100, 10, 1), pendingKey: null }])
  })

  it("adds sets that are waiting after the ones the server has, in the order they were logged", () => {
    const sets = setsOf([logged("a", 10), logged("b", 10)], 10)

    expect(sets.map((item) => item.pendingKey)).toEqual([null, "a", "b"])
    expect(sets.map((item) => item.setNumber)).toEqual([1, 2, 3])
    expect(sets[1]).toMatchObject({ weight: 62.5, reps: 6, rpe: 9, durationSeconds: null })
  })

  it("puts a waiting set under its own exercise only", () => {
    expect(setsOf([logged("a", 11)], 10)).toHaveLength(1)
    expect(setsOf([logged("a", 11)], 11)).toHaveLength(1)
  })

  it("hides a set whose removal is waiting", () => {
    expect(setsOf([{ kind: "deleteSet", key: "d", workoutId: 1, setId: 100 }], 10)).toEqual([])
  })

  it("ignores what is waiting for another workout", () => {
    expect(setsOf([logged("a", 10, 2)], 10)).toHaveLength(1)
  })
})

describe("withSentSet", () => {
  it("adds the confirmed set with the id the server gave it", () => {
    const sets = withSentSet(detail, logged("a", 10), 101).exercises[0]?.sets ?? []

    expect(sets.map((item) => item.id)).toEqual([100, 101])
  })

  it("does not add a set the server's description already has", () => {
    expect(withSentSet(detail, logged("a", 10), 100).exercises[0]?.sets).toHaveLength(1)
  })
})

describe("withoutSet", () => {
  it("drops the set from whichever exercise has it", () => {
    expect(withoutSet(detail, 100).exercises[0]?.sets).toEqual([])
  })
})

describe("the queue", () => {
  const ops = [logged("a", 10), logged("b", 11, 2)]

  it("drops one item by its key", () => {
    expect(withoutOp(ops, "a").map((op) => op.key)).toEqual(["b"])
  })

  it("counts what is waiting for one workout", () => {
    expect(waitingFor(ops, 1)).toBe(1)
    expect(waitingFor(ops, 3)).toBe(0)
  })
})
