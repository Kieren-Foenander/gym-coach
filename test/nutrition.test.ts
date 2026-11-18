import { Exit, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { CallInputs } from "~/domain/calls"
import { HEALTH_METRICS } from "~/domain/health"
import {
  daysAround,
  daysFrom,
  describeMacros,
  describeTarget,
  EMPTY_FOOD_FORM,
  foodFormFor,
  HEALTH_NUTRIENTS,
  isDay,
  nutritionDays,
  nutritionRange,
  readFoodForm,
  readTarget,
  shiftDay,
  targetProgress,
  totalFood,
  WEEK_DAYS,
  type FoodEntry,
} from "~/domain/nutrition"
import { FoodInput, ProfilePatch } from "~/domain/schema"

const entry = (day: string, calories: number, macros: Partial<Pick<FoodEntry, "protein" | "carbs" | "fat">> = {}): FoodEntry => ({
  id: calories,
  day,
  description: "Food",
  calories,
  protein: macros.protein ?? null,
  carbs: macros.carbs ?? null,
  fat: macros.fat ?? null,
  source: "user",
  createdAt: 0,
})

/** Whether a client sending `value` would get past the server's checks. */
const decodes = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: S["Encoded"]) =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema)(value))

describe("days", () => {
  it("moves across months, years and leap days", () => {
    expect(shiftDay("2026-11-30", 1)).toBe("2026-12-01")
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01")
    expect(shiftDay("2028-03-01", -1)).toBe("2028-02-29")
    expect(shiftDay("2026-11-18", -6)).toBe("2026-11-12")
  })

  it("lists every day in a span, both ends included", () => {
    expect(daysFrom("2026-11-29", "2026-12-02")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"])
    expect(daysFrom("2026-11-18", "2026-11-18")).toEqual(["2026-11-18"])
    expect(daysFrom("2026-11-18", "2026-11-17")).toEqual([])
  })

  it("only takes real days", () => {
    expect(isDay("2026-11-18")).toBe(true)
    expect(isDay("2026-13-01")).toBe(false)
    expect(isDay("18/11/2026")).toBe(false)
    expect(isDay("2026-11-18T00:00")).toBe(false)
  })

  it("covers today in every time zone when the server cannot know which", () => {
    const time = Date.parse("2026-11-18T23:30:00Z")
    const span = daysAround(time)

    expect(span).toEqual({ from: "2026-11-17", to: "2026-11-19" })

    // Auckland is already on the 19th and Honolulu still on the 18th; both are in the span.
    for (const zone of ["Pacific/Auckland", "Pacific/Honolulu", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      const local = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(time)

      expect(local >= span.from && local <= span.to).toBe(true)
    }
  })

  it("asks for the week ending at the day shown, or a week either side of today when it is not known yet", () => {
    expect(nutritionRange("2026-11-18", 0)).toEqual({ from: "2026-11-12", to: "2026-11-18" })

    const unknown = nutritionRange(undefined, Date.parse("2026-11-18T12:00:00Z"))

    // Whichever of the 17th to the 19th is today, its whole week is in what was asked for.
    for (const today of ["2026-11-17", "2026-11-18", "2026-11-19"]) {
      expect(shiftDay(today, 1 - WEEK_DAYS) >= unknown.from && today <= unknown.to).toBe(true)
    }
  })
})

describe("totals", () => {
  it("adds up entries, counting a macro that was not given as nothing", () => {
    expect(totalFood([entry("2026-11-18", 500, { protein: 40 }), entry("2026-11-18", 300, { carbs: 50, fat: 10 })])).toEqual({
      calories: 800,
      protein: 40,
      carbs: 50,
      fat: 10,
    })
  })

  it("gives every day in the span, with what Health had counted on top of what was logged", () => {
    const days = nutritionDays(
      "2026-11-16",
      "2026-11-18",
      [entry("2026-11-16", 600, { protein: 50 }), entry("2026-11-18", 400, { protein: 30 }), entry("2026-11-19", 9999)],
      [
        { day: "2026-11-18", metric: "dietaryEnergy", value: 1500 },
        { day: "2026-11-18", metric: "dietaryProtein", value: 90 },
        { day: "2026-11-18", metric: "steps", value: 12000 },
      ],
    )

    expect(days.map((day) => day.day)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"])
    expect(days[0]).toMatchObject({ health: null, total: { calories: 600, protein: 50 } })
    expect(days[1]).toMatchObject({ health: null, total: { calories: 0, protein: 0, carbs: 0, fat: 0 } })
    expect(days[2]).toMatchObject({
      logged: { calories: 400, protein: 30 },
      health: { calories: 1500, protein: 90, carbs: 0, fat: 0 },
      total: { calories: 1900, protein: 120 },
    })
  })

  it("reads each nutrient from a metric Health actually sends", () => {
    for (const metric of Object.values(HEALTH_NUTRIENTS)) expect(HEALTH_METRICS).toContain(metric)
  })
})

describe("targets", () => {
  it("says how far along a target is", () => {
    expect(targetProgress(1000, 2000)).toBe(0.5)
    expect(targetProgress(3000, 2000)).toBe(1)
    expect(targetProgress(1000, null)).toBeNull()
  })

  it("says what is left or how far over", () => {
    expect(describeTarget("calories", 1500, 2200)).toBe("700 kcal to go")
    expect(describeTarget("protein", 180, 180)).toBe("On target")
    expect(describeTarget("calories", 2500, 2200)).toBe("300 kcal over")
    expect(describeTarget("protein", 100, null)).toBe("No target set")
  })

  it("reads a target typed in, where blank clears it", () => {
    expect(readTarget("calories", "2400")).toEqual({ ok: true, value: 2400 })
    expect(readTarget("protein", " 180,4 ")).toEqual({ ok: true, value: 180 })
    expect(readTarget("calories", "")).toEqual({ ok: true, value: null })
    expect(readTarget("calories", "200").ok).toBe(false)
    expect(readTarget("protein", "lots").ok).toBe(false)
  })

  it("lets the profile set and clear targets within range", () => {
    expect(decodes(ProfilePatch, { calorieTarget: 2400, proteinTarget: 180 })).toBe(true)
    expect(decodes(ProfilePatch, { calorieTarget: null })).toBe(true)
    expect(decodes(ProfilePatch, { calorieTarget: 100 })).toBe(false)
    expect(decodes(ProfilePatch, { proteinTarget: 180.5 })).toBe(false)
  })
})

describe("the food form", () => {
  it("needs a description and calories, and leaves blank macros unknown", () => {
    expect(readFoodForm({ ...EMPTY_FOOD_FORM, description: "  Banana ", calories: "105" })).toEqual({
      ok: true,
      food: { description: "Banana", calories: 105, protein: null, carbs: null, fat: null },
    })

    expect(readFoodForm({ ...EMPTY_FOOD_FORM, calories: "105" }).ok).toBe(false)
    expect(readFoodForm({ ...EMPTY_FOOD_FORM, description: "Banana" }).ok).toBe(false)
    expect(readFoodForm({ ...EMPTY_FOOD_FORM, description: "Banana", calories: "105", protein: "1,3" })).toMatchObject({
      ok: true,
      food: { protein: 1.3 },
    })
    expect(readFoodForm({ ...EMPTY_FOOD_FORM, description: "Banana", calories: "105", fat: "-1" }).ok).toBe(false)
    expect(readFoodForm({ ...EMPTY_FOOD_FORM, description: "Banana", calories: "abc" }).ok).toBe(false)
  })

  it("fills in from an entry for editing and reads back the same food", () => {
    const original = entry("2026-11-18", 650, { protein: 45, fat: 20 })
    const read = readFoodForm(foodFormFor(original))

    expect(read).toEqual({ ok: true, food: { description: "Food", calories: 650, protein: 45, carbs: null, fat: 20 } })
  })

  it("only accepts what the server accepts", () => {
    const read = readFoodForm({ description: "Steak and chips", calories: "900", protein: "60", carbs: "70", fat: "40" })

    expect(read.ok && decodes(FoodInput, read.food)).toBe(true)
  })

  it("writes the macros given, leaving out the rest", () => {
    expect(describeMacros({ protein: 30, carbs: 45.4, fat: null })).toBe("P 30 g · C 45 g")
    expect(describeMacros({ protein: null, carbs: null, fat: null })).toBe("")
  })
})

describe("the calls", () => {
  it("takes a food entry for a real day", () => {
    expect(decodes(CallInputs.logFood, { day: "2026-11-18", food: { description: "Oats", calories: 350, protein: 12 } })).toBe(true)
    expect(decodes(CallInputs.logFood, { day: "2026-02-30", food: { description: "Oats", calories: 350 } })).toBe(false)
    expect(decodes(CallInputs.logFood, { day: "2026-11-18", food: { description: "  ", calories: 350 } })).toBe(false)
    expect(decodes(CallInputs.logFood, { day: "2026-11-18", food: { description: "Oats", calories: 20_000 } })).toBe(false)
  })

  it("reads a span of days", () => {
    expect(decodes(CallInputs.getNutrition, { from: "2026-11-12", to: "2026-11-18" })).toBe(true)
    expect(decodes(CallInputs.getNutrition, { from: "2026-11-12", to: "today" })).toBe(false)
  })
})
