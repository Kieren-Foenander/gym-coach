import { daysAround, daysFrom, shiftDay, type DayRange } from "./days"
import type { HealthMetric } from "./health"

/**
 * Rules for the food log. Plain values and functions with no schema library behind them,
 * so the native app can use them too.
 *
 * Food is kept light: an entry is a meal or a day's total with a description, calories and
 * whichever macros are known. There is no food database. People who track food in another
 * app bring it in through Apple Health, and the coach can estimate a meal the user describes.
 *
 * Days are calendar days on the user's device, as YYYY-MM-DD, the same as Health's daily
 * numbers. The server never works out "today" itself, because it does not know the time zone.
 */

export const NUTRIENTS = ["calories", "protein", "carbs", "fat"] as const

export type Nutrient = (typeof NUTRIENTS)[number]

export const NUTRIENT_INFO = {
  calories: { label: "Calories", unit: "kcal" },
  protein: { label: "Protein", unit: "g" },
  carbs: { label: "Carbs", unit: "g" },
  fat: { label: "Fat", unit: "g" },
} as const satisfies { readonly [K in Nutrient]: { readonly label: string; readonly unit: string } }

/** The largest values one entry may hold, and the longest description. */
export const FOOD_LIMITS = { description: 200, calories: 10_000, grams: 1_000 } as const

/** The ranges a daily target may be set within. */
export const TARGET_LIMITS = { calories: { min: 500, max: 10_000 }, protein: { min: 1, max: 1_000 } } as const

/** The most days one request for the food log may cover. */
export const MAX_NUTRITION_DAYS = 92

/** The Apple Health daily metric each nutrient arrives as. */
export const HEALTH_NUTRIENTS = {
  calories: "dietaryEnergy",
  protein: "dietaryProtein",
  carbs: "dietaryCarbs",
  fat: "dietaryFat",
} as const satisfies { readonly [K in Nutrient]: HealthMetric }

export type FoodSource = "user" | "ai"

export interface FoodEntry {
  readonly id: number
  readonly day: string
  readonly description: string
  readonly calories: number
  readonly protein: number | null
  readonly carbs: number | null
  readonly fat: number | null
  /** Who logged it: the user in the app, or the coach. */
  readonly source: FoodSource
  readonly createdAt: number
}

export type Totals = { readonly [K in Nutrient]: number }

export interface NutritionDay {
  readonly day: string
  /** What was logged in this app. */
  readonly logged: Totals
  /** What Apple Health had for the day, from a food tracker that writes to it. Null when it had nothing. */
  readonly health: Totals | null
  /** Both together, which is what counts against the targets. */
  readonly total: Totals
}

export interface NutritionTargets {
  readonly calories: number | null
  readonly protein: number | null
}

const ZERO: Totals = { calories: 0, protein: 0, carbs: 0, fat: 0 }

const add = (a: Totals, b: Totals): Totals => ({
  calories: a.calories + b.calories,
  protein: a.protein + b.protein,
  carbs: a.carbs + b.carbs,
  fat: a.fat + b.fat,
})

/** What a set of entries adds up to. A macro an entry does not give counts as nothing. */
export const totalFood = (entries: ReadonlyArray<Pick<FoodEntry, Nutrient>>): Totals =>
  entries.reduce<Totals>(
    (sum, entry) =>
      add(sum, { calories: entry.calories, protein: entry.protein ?? 0, carbs: entry.carbs ?? 0, fat: entry.fat ?? 0 }),
    ZERO,
  )

export const isTotalsEmpty = (totals: Totals) => NUTRIENTS.every((nutrient) => totals[nutrient] === 0)

// ---------------------------------------------------------------- days

/** How many days the week view shows, ending at the day picked. */
export const WEEK_DAYS = 7

/**
 * The days a food screen asks for: the week ending at `day`. Without a day, the screen will show
 * the device's today, which the server cannot know, so it asks for enough to cover the week ending
 * on any day that is "today" somewhere at `time`.
 */
export const nutritionRange = (day: string | undefined, time: number): DayRange => {
  if (day !== undefined) return { from: shiftDay(day, 1 - WEEK_DAYS), to: day }

  const around = daysAround(time)

  return { from: shiftDay(around.from, 1 - WEEK_DAYS), to: around.to }
}

interface HealthNutritionReading {
  readonly day: string
  readonly metric: string
  readonly value: number
}

/** Rows grouped by their day, so each day's are found without scanning them all again. */
export const groupByDay = <A extends { readonly day: string }>(rows: ReadonlyArray<A>): ReadonlyMap<string, ReadonlyArray<A>> => {
  const days = new Map<string, Array<A>>()

  for (const row of rows) {
    const list = days.get(row.day)

    if (list) list.push(row)
    else days.set(row.day, [row])
  }

  return days
}

/**
 * Each day from `from` to `to` with what was logged here, what Health had, and the two together.
 * Oldest first, and every day is there, eaten on or not.
 */
export const nutritionDays = (
  from: string,
  to: string,
  entries: ReadonlyArray<FoodEntry>,
  health: ReadonlyArray<HealthNutritionReading>,
): ReadonlyArray<NutritionDay> => {
  const entriesByDay = groupByDay(entries)
  const readingsByDay = groupByDay(health)

  return daysFrom(from, to).map((day) => {
    const logged = totalFood(entriesByDay.get(day) ?? [])
    const readings = readingsByDay.get(day) ?? []

    const fromHealth = (nutrient: Nutrient) =>
      readings.find((reading) => reading.metric === HEALTH_NUTRIENTS[nutrient])?.value ?? 0

    const healthTotals: Totals = {
      calories: fromHealth("calories"),
      protein: fromHealth("protein"),
      carbs: fromHealth("carbs"),
      fat: fromHealth("fat"),
    }

    const hasHealth = !isTotalsEmpty(healthTotals)

    return {
      day,
      logged,
      health: hasHealth ? healthTotals : null,
      total: hasHealth ? add(logged, healthTotals) : logged,
    }
  })
}

// ---------------------------------------------------------------- showing

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })

/** A nutrient amount for showing, rounded to a whole number with separators. */
export const formatAmount = (value: number): string => wholeNumber.format(Math.round(value))

/** How far along a target is, from 0 to 1. Null without a target. */
export const targetProgress = (value: number, target: number | null): number | null =>
  target === null || target <= 0 ? null : Math.min(1, Math.max(0, value / target))

/** What is left of a target, or how far over it is, in words. */
export const describeTarget = (nutrient: Nutrient, value: number, target: number | null): string => {
  if (target === null) return "No target set"

  const unit = NUTRIENT_INFO[nutrient].unit
  const left = Math.round(target - value)

  if (left > 0) return `${formatAmount(left)} ${unit} to go`

  if (left === 0) return "On target"

  return `${formatAmount(-left)} ${unit} over`
}

/** A short line of an entry's macros, such as "P 30 g · C 45 g", leaving out the ones not given. */
export const describeMacros = (entry: Pick<FoodEntry, "protein" | "carbs" | "fat">): string =>
  (["protein", "carbs", "fat"] as const)
    .flatMap((nutrient) => {
      const value = entry[nutrient]

      return value === null ? [] : [`${NUTRIENT_INFO[nutrient].label.charAt(0)} ${formatAmount(value)} g`]
    })
    .join(" · ")

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" })
const shortDayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short" })

/** "Today", "Yesterday", or the date written out. */
export const describeDay = (day: string, today: string): string => {
  if (day === today) return "Today"

  if (day === shiftDay(today, -1)) return "Yesterday"

  return dayFormat.format(new Date(`${day}T12:00:00`))
}

/** A day as a short weekday, such as "Mon". */
export const shortDay = (day: string): string => shortDayFormat.format(new Date(`${day}T12:00:00`))

// ---------------------------------------------------------------- the form

export interface FoodForm {
  readonly description: string
  readonly calories: string
  readonly protein: string
  readonly carbs: string
  readonly fat: string
}

export const EMPTY_FOOD_FORM: FoodForm = { description: "", calories: "", protein: "", carbs: "", fat: "" }

export interface FoodInputValues {
  readonly description: string
  readonly calories: number
  readonly protein: number | null
  readonly carbs: number | null
  readonly fat: number | null
}

/**
 * Reads a number typed in. A comma before exactly three digits separates thousands, as in
 * "2,400"; any other comma is the decimal point some phone keyboards give, as in "45,5".
 * Null when blank.
 */
export const readNumber = (text: string): number | null | "invalid" => {
  const trimmed = text.trim()

  if (trimmed === "") return null

  const value = Number(/^\d{1,3}(,\d{3})+$/.test(trimmed) ? trimmed.replaceAll(",", "") : trimmed.replace(",", "."))

  return Number.isFinite(value) ? value : "invalid"
}

/** Checks what was typed into the food form. Calories are needed; the macros may be left blank. */
export const readFoodForm = (
  form: FoodForm,
): { readonly ok: true; readonly food: FoodInputValues } | { readonly ok: false; readonly error: string } => {
  const description = form.description.trim()

  if (description === "") return { ok: false, error: "Say what you ate" }

  if (description.length > FOOD_LIMITS.description) {
    return { ok: false, error: `Keep the description under ${FOOD_LIMITS.description} characters` }
  }

  const calories = readNumber(form.calories)

  if (calories === null || calories === "invalid" || calories < 0 || calories > FOOD_LIMITS.calories) {
    return { ok: false, error: `Enter calories between 0 and ${formatAmount(FOOD_LIMITS.calories)}` }
  }

  const grams: Record<"protein" | "carbs" | "fat", number | null> = { protein: null, carbs: null, fat: null }

  for (const nutrient of ["protein", "carbs", "fat"] as const) {
    const value = readNumber(form[nutrient])

    if (value === "invalid" || (value !== null && (value < 0 || value > FOOD_LIMITS.grams))) {
      return { ok: false, error: `Enter ${NUTRIENT_INFO[nutrient].label.toLowerCase()} between 0 and ${formatAmount(FOOD_LIMITS.grams)} g, or leave it blank` }
    }

    grams[nutrient] = value
  }

  return { ok: true, food: { description, calories, ...grams } }
}

/** The form filled in from an entry, for editing it. */
export const foodFormFor = (entry: FoodEntry): FoodForm => ({
  description: entry.description,
  calories: String(entry.calories),
  protein: entry.protein === null ? "" : String(entry.protein),
  carbs: entry.carbs === null ? "" : String(entry.carbs),
  fat: entry.fat === null ? "" : String(entry.fat),
})

/** Checks a target typed into the targets form. Blank clears it. */
export const readTarget = (
  nutrient: keyof typeof TARGET_LIMITS,
  text: string,
): { readonly ok: true; readonly value: number | null } | { readonly ok: false; readonly error: string } => {
  const value = readNumber(text)
  const { min, max } = TARGET_LIMITS[nutrient]
  const unit = NUTRIENT_INFO[nutrient].unit

  if (value === null) return { ok: true, value: null }

  if (value === "invalid" || value < min || value > max) {
    return { ok: false, error: `Enter a ${nutrient} target between ${formatAmount(min)} and ${formatAmount(max)} ${unit}, or leave it blank` }
  }

  return { ok: true, value: Math.round(value) }
}
