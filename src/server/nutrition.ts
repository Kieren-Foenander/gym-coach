import { Clock, Effect } from "effect"
import { SqlClient } from "effect/sql"
import {
  daysBetween,
  HEALTH_NUTRIENTS,
  MAX_NUTRITION_DAYS,
  nutritionDays,
  NUTRIENTS,
  type FoodEntry,
  type FoodSource,
  type NutritionTargets,
} from "~/domain/nutrition"
import type { FoodInput } from "~/domain/schema"
import { Invalid, NotFound } from "./errors"
import { CurrentUser } from "./repo"

/**
 * The food log: entries logged in the app or by the coach, read back next to what Apple
 * Health has from a food tracker. See src/domain/nutrition.ts for the rules.
 */

const FOOD_COLUMNS = `id, day, description, calories, protein, carbs, fat, source, created_at`

const HEALTH_METRICS = NUTRIENTS.map((nutrient) => HEALTH_NUTRIENTS[nutrient])

const checkSpan = (from: string, to: string) => {
  const span = daysBetween(from, to)

  if (span < 0) return Effect.fail(new Invalid({ reason: "The first day comes after the last" }))

  if (span >= MAX_NUTRITION_DAYS) return Effect.fail(new Invalid({ reason: `Ask for at most ${MAX_NUTRITION_DAYS} days at a time` }))

  return Effect.void
}

export const logFood = Effect.fn("logFood")(function* (day: string, food: FoodInput, source: FoodSource) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser
  const now = yield* Clock.currentTimeMillis

  const rows = yield* sql<FoodEntry>`
    INSERT INTO food_entries (user_id, day, description, calories, protein, carbs, fat, source, created_at)
    VALUES (${user.id}, ${day}, ${food.description}, ${food.calories}, ${food.protein ?? null}, ${food.carbs ?? null},
      ${food.fat ?? null}, ${source}, ${now})
    RETURNING ${sql.unsafe(FOOD_COLUMNS)}`

  return rows[0]!
})

/** Changes an entry's food. It keeps its day and who logged it. */
export const updateFood = Effect.fn("updateFood")(function* (foodId: number, food: FoodInput) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser

  const rows = yield* sql<FoodEntry>`
    UPDATE food_entries SET description = ${food.description}, calories = ${food.calories}, protein = ${food.protein ?? null},
      carbs = ${food.carbs ?? null}, fat = ${food.fat ?? null}
    WHERE id = ${foodId} AND user_id = ${user.id}
    RETURNING ${sql.unsafe(FOOD_COLUMNS)}`

  const entry = rows[0]

  if (!entry) return yield* new NotFound({ what: `Food entry ${foodId}` })

  return entry
})

export const deleteFood = Effect.fn("deleteFood")(function* (foodId: number) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser

  const rows = yield* sql<{ id: number }>`DELETE FROM food_entries WHERE id = ${foodId} AND user_id = ${user.id} RETURNING id`

  if (rows.length === 0) return yield* new NotFound({ what: `Food entry ${foodId}` })
})

/**
 * The food log from `from` to `to`: every entry, oldest first, and each day's totals with what
 * Health had. The targets come along so a screen needs nothing else.
 */
export const getNutrition = Effect.fn("getNutrition")(function* (from: string, to: string) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser

  yield* checkSpan(from, to)

  const entries = yield* sql<FoodEntry>`
    SELECT ${sql.unsafe(FOOD_COLUMNS)} FROM food_entries
    WHERE user_id = ${user.id} AND day >= ${from} AND day <= ${to}
    ORDER BY day, created_at, id`

  const health = yield* sql<{ day: string; metric: string; value: number }>`
    SELECT day, metric, value FROM health_daily
    WHERE user_id = ${user.id} AND day >= ${from} AND day <= ${to} AND ${sql.in("metric", HEALTH_METRICS)}`

  const targets: NutritionTargets = { calories: user.calorieTarget, protein: user.proteinTarget }

  return { from, to, targets, entries, days: nutritionDays(from, to, entries, health) }
})
