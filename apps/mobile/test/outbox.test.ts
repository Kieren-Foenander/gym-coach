import { describe, expect, it } from "vitest"
import type { WorkoutDetail, WorkoutSet } from "~/server/repo"
import {
  waitingFor,
  withChangedSet,
  withEditedSet,
  withoutOp,
  withoutSet,
  withPending,
  withSentSet,
  type LogSetOp,
  type PendingOp,
  type UpdateSetOp,
} from "@/data/outbox"

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
  note: "",
})

const detail: WorkoutDetail = {
  workout: { id: 1, planDayId: null, name: "Push", startedAt: 0, finishedAt: null, notes: "" },
  exercises: [
    { exerciseId: 10, exerciseName: "Bench Press", target: null, swappedFrom: null, note: "", previous: [], sets: [set(100, 10, 1)] },
    { exerciseId: 11, exerciseName: "Dip", target: null, swappedFrom: null, note: "", previous: [], sets: [] },
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

const changed = (key: string, setId: number, weight: number): UpdateSetOp => ({
  kind: "updateSet",
  key,
  workoutId: 1,
  setId,
  set: { weight, reps: 5, note: " Belt " },
})

const setsOf = (ops: ReadonlyArray<PendingOp>, exerciseId: number) =>
  withPending(detail, ops).exercises.find((exercise) => exercise.exerciseId === exerciseId)?.sets ?? []

describe("withPending", () => {
  it("leaves the workout as it is when nothing is waiting", () => {
    expect(setsOf([], 10)).toEqual([{ ...set(100, 10, 1), pendingKey: null, order: 100 }])
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

  it("shows the latest change waiting for a set the server has", () => {
    const sets = setsOf([changed("u1", 100, 70), changed("u2", 100, 72.5)], 10)

    expect(sets).toMatchObject([{ id: 100, weight: 72.5, reps: 5, note: "Belt", pendingKey: null }])
  })

  it("orders waiting sets after the server's, in the order they were logged", () => {
    const orders = withPending(detail, [logged("a", 11), logged("b", 10)]).exercises.map((exercise) =>
      exercise.sets.map((item) => item.order),
    )

    expect(orders[0]![0]).toBe(100)
    expect(orders[0]![1]).toBeGreaterThan(orders[1]![0]!)
  })
})

describe("withEditedSet", () => {
  const values = { weight: 80, reps: 3 }

  it("logs a set still waiting with the new values instead", () => {
    const ops = withEditedSet([logged("a", 10)], { workoutId: 1, setId: 0, pendingKey: "a" }, values, null, "new")

    expect(ops).toEqual([{ ...logged("a", 10), set: values }])
  })

  it("queues a change for a set the server has, and replaces one not yet sent", () => {
    const once = withEditedSet([], { workoutId: 1, setId: 100, pendingKey: null }, values, null, "u1")!
    const twice = withEditedSet(once, { workoutId: 1, setId: 100, pendingKey: null }, { weight: 85, reps: 2 }, null, "u2")!

    expect(once).toEqual([{ kind: "updateSet", key: "u1", workoutId: 1, setId: 100, set: values }])
    expect(twice).toEqual([{ kind: "updateSet", key: "u1", workoutId: 1, setId: 100, set: { weight: 85, reps: 2 } }])
  })

  it("queues another change when the last one is on its way", () => {
    const sending = withEditedSet([], { workoutId: 1, setId: 100, pendingKey: null }, values, null, "u1")!

    expect(withEditedSet(sending, { workoutId: 1, setId: 100, pendingKey: null }, values, "u1", "u2")).toHaveLength(2)
  })

  it("refuses to change a set while it is being sent", () => {
    expect(withEditedSet([logged("a", 10)], { workoutId: 1, setId: 0, pendingKey: "a" }, values, "a", "new")).toBeNull()
  })
})

describe("withChangedSet", () => {
  it("puts the confirmed values on the set", () => {
    expect(withChangedSet(detail, changed("u", 100, 70)).exercises[0]?.sets[0]).toMatchObject({ weight: 70, note: "Belt" })
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
