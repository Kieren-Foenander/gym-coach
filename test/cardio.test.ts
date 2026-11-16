import { describe, expect, it } from "vitest"
import { CATALOG, isCardio } from "~/domain/catalog"
import { formatDuration, formatPrescription, formatSet } from "~/format"

describe("cardio", () => {
  it("knows which exercises are logged by time", () => {
    expect(isCardio("Treadmill Run")).toBe(true)
    expect(isCardio("rowing machine")).toBe(true)
    expect(isCardio("Squat")).toBe(false)
    expect(isCardio("Something I made up")).toBe(false)
    expect(CATALOG.filter((entry) => isCardio(entry.name)).length).toBeGreaterThan(10)
  })

  it("writes a duration as minutes or a clock", () => {
    expect(formatDuration(1200)).toBe("20 min")
    expect(formatDuration(95)).toBe("1:35")
  })

  it("writes a set by what was logged", () => {
    expect(formatSet({ weight: 60, reps: 8, durationSeconds: null, distance: null }, "kg")).toBe("60×8")
    expect(formatSet({ weight: 0, reps: 0, durationSeconds: 1200, distance: 5 }, "kg")).toBe("20 min · 5 km")
    expect(formatSet({ weight: 0, reps: 0, durationSeconds: 600, distance: 1.5 }, "lb")).toBe("10 min · 1.5 mi")
    expect(formatSet({ weight: 0, reps: 0, durationSeconds: 600, distance: null }, "kg")).toBe("10 min")
  })

  it("prescribes cardio in rounds", () => {
    const target = { sets: 1, repMin: 1, repMax: 1, targetWeight: null }

    expect(formatPrescription({ ...target, exerciseName: "Stationary Bike" }, "kg")).toBe("1 round")
    expect(formatPrescription({ ...target, exerciseName: "Stationary Bike", sets: 4 }, "kg")).toBe("4 rounds")
    expect(formatPrescription({ ...target, exerciseName: "Squat", sets: 3, repMin: 5, repMax: 5 }, "kg")).toBe(
      "3 × 5 · find your weight",
    )
  })
})
