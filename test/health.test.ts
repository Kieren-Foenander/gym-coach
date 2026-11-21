import { describe, expect, it } from "vitest"
import { catalogByName, isCardio } from "~/domain/catalog"
import {
  activityName,
  bodyValueFor,
  formatHealthValue,
  cardioExerciseFor,
  distanceFor,
  localDay,
  sleepMinutesByDay,
  summariseHealth,
  type HealthReading,
} from "~/domain/health"
import { measurementUnit } from "~/domain/units"

const HOUR = 3_600_000

// Days are keyed in UTC here, so the tests do not depend on the machine's time zone.
const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10)
const at = (iso: string) => Date.parse(iso)

describe("cardioExerciseFor", () => {
  it("logs runs and rides as the indoor or outdoor exercise", () => {
    expect(cardioExerciseFor(37, false)).toBe("Outdoor Run")
    expect(cardioExerciseFor(37, true)).toBe("Treadmill Run")
    expect(cardioExerciseFor(13, false)).toBe("Outdoor Cycling")
    expect(cardioExerciseFor(13, true)).toBe("Stationary Bike")
  })

  it("leaves strength training and sports with no sets to show out of the log", () => {
    expect(cardioExerciseFor(50, false)).toBeNull()
    expect(cardioExerciseFor(20, false)).toBeNull()
    expect(cardioExerciseFor(57, false)).toBeNull()
    expect(cardioExerciseFor(48, false)).toBeNull()
  })

  it("only ever names cardio exercises from the library", () => {
    for (let activity = 0; activity <= 100; activity++) {
      for (const indoor of [false, true]) {
        const name = cardioExerciseFor(activity, indoor)

        if (name === null) continue
        expect(catalogByName(name)?.name).toBe(name)
        expect(isCardio(name)).toBe(true)
      }
    }
  })

  it("names workout types for the coach", () => {
    expect(activityName(50)).toBe("Strength training")
    expect(activityName(57)).toBe("Yoga")
    expect(activityName(9999)).toBe("Other")
  })
})

describe("units from Health", () => {
  it("keeps kilograms for kg users and converts to pounds for lb users", () => {
    expect(bodyValueFor("weight", 80, "kg")).toBe(80)
    expect(bodyValueFor("weight", 80, "lb")).toBe(176.4)
  })

  it("turns a waist in metres into cm or inches", () => {
    expect(bodyValueFor("waist", 0.82, "kg")).toBe(82)
    expect(bodyValueFor("waist", 0.82, "lb")).toBe(32.3)
  })

  it("turns body fat from a fraction into a percentage whatever the unit", () => {
    expect(bodyValueFor("bodyFat", 0.183, "kg")).toBe(18.3)
    expect(bodyValueFor("bodyFat", 0.183, "lb")).toBe(18.3)
    expect(measurementUnit("bodyFat", "lb")).toBe("%")
  })

  it("turns metres into km or miles", () => {
    expect(distanceFor(5012, "kg")).toBe(5.01)
    expect(distanceFor(5012, "lb")).toBe(3.11)
  })
})

describe("sleepMinutesByDay", () => {
  it("puts a night on the morning it ended", () => {
    const night = { start: at("2026-11-10T23:00:00Z"), end: at("2026-11-11T06:30:00Z") }

    expect(sleepMinutesByDay([night], utcDay)).toEqual(new Map([["2026-11-11", 450]]))
  })

  it("counts a night recorded by both a watch and a phone once", () => {
    const watch = { start: at("2026-11-10T23:00:00Z"), end: at("2026-11-11T03:00:00Z") }
    const watchLater = { start: at("2026-11-11T03:30:00Z"), end: at("2026-11-11T06:00:00Z") }
    const phone = { start: at("2026-11-10T23:30:00Z"), end: at("2026-11-11T05:00:00Z") }

    // 23:00 to 06:00, all covered by one record or another.
    expect(sleepMinutesByDay([watch, phone, watchLater], utcDay).get("2026-11-11")).toBe(7 * 60)
  })

  it("adds a nap to the day it was taken and ignores empty records", () => {
    const night = { start: at("2026-11-10T23:00:00Z"), end: at("2026-11-11T06:00:00Z") }
    const nap = { start: at("2026-11-11T14:00:00Z"), end: at("2026-11-11T14:30:00Z") }
    const empty = { start: at("2026-11-11T20:00:00Z"), end: at("2026-11-11T20:00:00Z") }

    expect(sleepMinutesByDay([nap, empty, night], utcDay).get("2026-11-11")).toBe(7 * 60 + 30)
  })
})

describe("summariseHealth", () => {
  const series = (metric: HealthReading["metric"], values: ReadonlyArray<number>): ReadonlyArray<HealthReading> =>
    values.map((value, index) => ({ metric, value, day: `2026-11-${String(index + 1).padStart(2, "0")}` }))

  it("gives the latest value next to the average of the days before it", () => {
    const [resting] = summariseHealth(series("restingHeartRate", [56, 58, 60, 52]))

    expect(resting).toEqual({ metric: "restingHeartRate", latest: 52, latestDay: "2026-11-04", usual: 58 })
  })

  it("has no usual level until there are three earlier days", () => {
    expect(summariseHealth(series("hrv", [60, 70, 65]))[0]?.usual).toBeNull()
  })

  it("leaves out metrics with no readings and keeps a fixed order", () => {
    const summary = summariseHealth([...series("steps", [9000]), ...series("sleep", [420])])

    expect(summary.map((item) => item.metric)).toEqual(["sleep", "steps"])
  })

  it("only looks four weeks back for what is usual", () => {
    const readings: ReadonlyArray<HealthReading> = [
      { metric: "hrv", day: "2026-09-01", value: 200 },
      { metric: "hrv", day: "2026-10-20", value: 60 },
      { metric: "hrv", day: "2026-10-21", value: 60 },
      { metric: "hrv", day: "2026-10-22", value: 60 },
      { metric: "hrv", day: "2026-11-01", value: 50 },
    ]

    expect(summariseHealth(readings)[0]?.usual).toBe(60)
  })
})

describe("localDay", () => {
  it("formats the phone's calendar day", () => {
    const noon = new Date(2026, 0, 5, 12).getTime()

    expect(localDay(noon)).toBe("2026-01-05")
    expect(localDay(noon + 24 * HOUR)).toBe("2026-01-06")
  })
})

describe("formatHealthValue", () => {
  it("shows sleep in hours and minutes", () => {
    expect(formatHealthValue("sleep", 432)).toBe("7h 12m")
    expect(formatHealthValue("sleep", 61)).toBe("1h 01m")
  })

  it("rounds the rest, keeping one decimal for VO2 max", () => {
    expect(formatHealthValue("steps", 10234.4)).toBe("10,234")
    expect(formatHealthValue("restingHeartRate", 53.6)).toBe("54")
    expect(formatHealthValue("vo2Max", 44.27)).toBe("44.3")
  })
})
