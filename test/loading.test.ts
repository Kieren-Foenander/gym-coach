import { describe, expect, it } from "vitest"
import { loadKindFor, platesPerSide, warmupFor, warmupSets } from "~/domain/loading"

describe("platesPerSide", () => {
  it("loads the heaviest plates first", () => {
    expect(platesPerSide(100, 20, "kg")).toEqual({ perSide: [25, 15], leftover: 0 })
    expect(platesPerSide(62.5, 20, "kg")).toEqual({ perSide: [20, 1.25], leftover: 0 })
    expect(platesPerSide(135, 45, "lb")).toEqual({ perSide: [45], leftover: 0 })
  })

  it("returns no plates for the empty bar", () => {
    expect(platesPerSide(20, 20, "kg")).toEqual({ perSide: [], leftover: 0 })
  })

  it("reports weight the plates cannot make", () => {
    expect(platesPerSide(61, 20, "kg")).toEqual({ perSide: [20], leftover: 1 })
  })

  it("has no answer below the bar weight", () => {
    expect(platesPerSide(15, 20, "kg")).toBeNull()
  })
})

describe("warmupSets", () => {
  it("ramps from the bar towards the target", () => {
    expect(warmupSets(100, 20, "kg")).toEqual([
      { weight: 20, reps: 10 },
      { weight: 50, reps: 5 },
      { weight: 70, reps: 3 },
      { weight: 85, reps: 2 },
    ])
  })

  it("skips steps that are no heavier than the bar", () => {
    expect(warmupSets(30, 20, "kg")).toEqual([
      { weight: 20, reps: 10 },
      { weight: 25, reps: 2 },
    ])
  })

  it("gives nothing when the target is the bar or lighter", () => {
    expect(warmupSets(20, 20, "kg")).toEqual([])
  })

  it("rounds to 5 lb steps", () => {
    expect(warmupSets(225, 45, "lb").map((set) => set.weight)).toEqual([45, 115, 160, 190])
  })
})

describe("loadKindFor", () => {
  it("reads the equipment from the library", () => {
    expect(loadKindFor("Bench Press")).toBe("bar")
    expect(loadKindFor("Machine Chest Press")).toBe("stack")
    expect(loadKindFor("Dumbbell Bench Press")).toBe("dumbbells")
    expect(loadKindFor("Push-Up")).toBe("none")
  })

  it("treats an exercise the library does not know as a barbell lift", () => {
    expect(loadKindFor("My Odd Lift")).toBe("bar")
  })
})

describe("warmupFor", () => {
  it("warms a machine up with lighter settings, not an empty bar", () => {
    expect(warmupFor("stack", 70, 20, "kg")).toEqual([
      { weight: 30, reps: 10 },
      { weight: 40, reps: 6 },
      { weight: 55, reps: 3 },
    ])
  })

  it("steps dumbbells up by 2 kg", () => {
    expect(warmupFor("dumbbells", 30, 20, "kg").map((set) => set.weight)).toEqual([12, 18, 24])
  })

  it("keeps the bar ramp for a barbell", () => {
    expect(warmupFor("bar", 100, 20, "kg")).toEqual(warmupSets(100, 20, "kg"))
  })

  it("gives bodyweight work no weighted warm-up", () => {
    expect(warmupFor("none", 0, 20, "kg")).toEqual([])
  })
})
