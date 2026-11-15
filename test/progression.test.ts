import { describe, expect, it } from "vitest"
import { evaluateProgression, roundToIncrement, type ProgressionTarget } from "~/domain/progression"

const target = (overrides: Partial<ProgressionTarget> = {}): ProgressionTarget => ({
  sets: 3,
  repMin: 8,
  repMax: 12,
  targetWeight: 60,
  increment: 2.5,
  missStreak: 0,
  ...overrides,
})

const sets = (weight: number, ...reps: number[]) => reps.map((r) => ({ weight, reps: r }))

describe("evaluateProgression", () => {
  it("does nothing when no sets were logged", () => {
    expect(evaluateProgression(target(), [])).toEqual({ kind: "none" })
  })

  it("sets the starting weight from the first session", () => {
    const decision = evaluateProgression(target({ targetWeight: null }), [
      { weight: 40, reps: 10 },
      { weight: 45, reps: 8 },
    ])

    expect(decision).toMatchObject({ kind: "set", newWeight: 45 })
  })

  it("adds an increment when every set reaches the top of the range", () => {
    expect(evaluateProgression(target(), sets(60, 12, 12, 12))).toMatchObject({ kind: "increase", newWeight: 62.5 })
  })

  it("writes the reason in the user's unit", () => {
    expect(evaluateProgression(target({ increment: 5 }), sets(60, 12, 12, 12), "lb")).toMatchObject({
      reason: "Hit 3×12 at 60 lb, so the target goes up to 65 lb",
    })
  })

  it("holds when a set falls short of the top of the range", () => {
    expect(evaluateProgression(target(), sets(60, 12, 11, 10))).toEqual({ kind: "hold", missStreak: 0 })
  })

  it("holds when fewer sets than prescribed were done", () => {
    expect(evaluateProgression(target(), sets(60, 12, 12))).toEqual({ kind: "hold", missStreak: 0 })
  })

  it("does not increase when the sets were done below the target weight", () => {
    expect(evaluateProgression(target(), sets(55, 12, 12, 12))).toEqual({ kind: "hold", missStreak: 1 })
  })

  it("counts a first bad session without changing the weight", () => {
    expect(evaluateProgression(target(), sets(60, 7, 6, 5))).toEqual({ kind: "hold", missStreak: 1 })
  })

  it("deloads 10% after two bad sessions in a row", () => {
    expect(evaluateProgression(target({ missStreak: 1 }), sets(60, 7, 6, 5))).toMatchObject({
      kind: "decrease",
      newWeight: 55,
      missStreak: 0,
    })
  })

  it("clears the miss streak after a session inside the range", () => {
    expect(evaluateProgression(target({ missStreak: 1 }), sets(60, 10, 9, 8))).toEqual({ kind: "hold", missStreak: 0 })
  })

  it("leaves bodyweight exercises (no increment) alone", () => {
    expect(evaluateProgression(target({ targetWeight: 0, increment: 0 }), sets(0, 12, 12, 12))).toEqual({
      kind: "hold",
      missStreak: 0,
    })
  })
})

describe("roundToIncrement", () => {
  it("rounds to the nearest plate jump", () => {
    expect(roundToIncrement(54, 2.5)).toBe(55)
    expect(roundToIncrement(91.8, 5)).toBe(90)
  })
})
