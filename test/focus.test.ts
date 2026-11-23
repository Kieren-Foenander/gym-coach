import { describe, expect, it } from "vitest"
import { exerciseStates, skippedSetCount, workoutFocus, type FocusExercise } from "~/domain/focus"

const planned = (sets: number, logged = 0, latest: number | null = null): FocusExercise => ({ planned: sets, logged, latest })
const added = (logged = 0, latest: number | null = null): FocusExercise => ({ planned: 0, logged, latest })

describe("workoutFocus", () => {
  it("starts on the first planned exercise", () => {
    expect(workoutFocus([planned(3), planned(3)])).toEqual({ current: 0, skipped: new Set() })
  })

  it("stays on an exercise until its sets are done, then moves to the next", () => {
    expect(workoutFocus([planned(3, 2, 2), planned(3)]).current).toBe(0)
    expect(workoutFocus([planned(3, 3, 3), planned(3)]).current).toBe(1)
  })

  it("marks an exercise left part-way as skipped once a set is logged on another", () => {
    const focus = workoutFocus([planned(3, 2, 2), planned(3, 1, 3), planned(3)])

    expect(focus.current).toBe(1)
    expect([...focus.skipped]).toEqual([0])
  })

  it("moves past a skipped exercise once the one after it is done", () => {
    const focus = workoutFocus([planned(3, 2, 2), planned(2, 2, 4), planned(3)])

    expect(focus.current).toBe(2)
    expect([...focus.skipped]).toEqual([0])
  })

  it("takes an exercise off the skipped list when its last set is logged after all", () => {
    const focus = workoutFocus([planned(3, 3, 5), planned(2, 2, 4), planned(3)])

    expect(focus).toEqual({ current: 2, skipped: new Set() })
  })

  it("comes back to an exercise not yet started that was passed over", () => {
    expect(workoutFocus([planned(3), planned(2, 2, 2)]).current).toBe(0)
  })

  it("does not count an exercise never started as skipped", () => {
    expect(workoutFocus([planned(3), planned(3, 1, 1)]).skipped.size).toBe(0)
  })

  it("stays on an added exercise while it is being logged", () => {
    expect(workoutFocus([planned(1, 1, 1), added(2, 3)]).current).toBe(1)
  })

  it("falls back to the last exercise when every planned one is done or skipped", () => {
    expect(workoutFocus([planned(2, 1, 1), planned(1, 1, 2)]).current).toBe(1)
    expect(workoutFocus([added()]).current).toBe(0)
    expect(workoutFocus([]).current).toBeNull()
  })
})

describe("exerciseStates", () => {
  it("names where each exercise stands", () => {
    expect(exerciseStates([planned(2, 2, 1), planned(3, 2, 3), planned(3, 1, 4), planned(3)])).toEqual([
      "done",
      "skipped",
      "current",
      "todo",
    ])
  })

  it("counts the sets left on skipped exercises", () => {
    expect(skippedSetCount([planned(4, 1, 1), planned(3, 2, 2), planned(3, 1, 3)])).toBe(4)
  })
})
