import { describe, expect, it } from "vitest"
import { HEALTH_IMPORT_LIMITS } from "~/domain/health"
import { cleanHealthChanges, healthBatches } from "@/features/health/batches"
import type { BodyRecord, DailyRecord, HealthChanges, WorkoutRecord } from "@/features/health/types"

const body = (index: number): BodyRecord => ({ healthId: `b${index}`, kind: "weight", value: 80, measuredAt: index })

const workout = (index: number): WorkoutRecord => ({
  healthId: `w${index}`,
  activity: 37,
  indoor: false,
  startedAt: index,
  endedAt: index + 1,
  durationSeconds: 1,
  distanceMeters: null,
  energyKcal: null,
  avgHeartRate: null,
})

const daily = (index: number): DailyRecord => ({ day: "2026-11-17", metric: "steps", value: index })

const changes = (sizes: { deleted: number; body: number; workouts: number; daily: number }): HealthChanges => ({
  deleted: Array.from({ length: sizes.deleted }, (_, index) => `gone${index}`),
  body: Array.from({ length: sizes.body }, (_, index) => body(index)),
  workouts: Array.from({ length: sizes.workouts }, (_, index) => workout(index)),
  daily: Array.from({ length: sizes.daily }, (_, index) => daily(index)),
  anchors: {},
})

describe("healthBatches", () => {
  it("sends nothing when nothing changed", () => {
    expect(healthBatches(changes({ deleted: 0, body: 0, workouts: 0, daily: 0 }))).toEqual([])
  })

  it("keeps every request within the server's limits and sends deletions first", () => {
    const batches = healthBatches(changes({ deleted: 100, body: 400, workouts: 13, daily: 600 }))

    expect(batches.map((batch) => Object.keys(batch).join())).toEqual([
      "deleted",
      "deleted",
      "body",
      "body",
      "body",
      "workouts",
      "workouts",
      "workouts",
      "daily",
      "daily",
      "daily",
    ])

    for (const batch of batches) {
      expect(batch.deleted?.length ?? 0).toBeLessThanOrEqual(HEALTH_IMPORT_LIMITS.deleted)
      expect(batch.body?.length ?? 0).toBeLessThanOrEqual(HEALTH_IMPORT_LIMITS.body)
      expect(batch.workouts?.length ?? 0).toBeLessThanOrEqual(HEALTH_IMPORT_LIMITS.workouts)
      expect(batch.daily?.length ?? 0).toBeLessThanOrEqual(HEALTH_IMPORT_LIMITS.daily)
    }
  })

  it("sends every record exactly once", () => {
    const batches = healthBatches(changes({ deleted: 3, body: 181, workouts: 7, daily: 251 }))

    expect(batches.flatMap((batch) => batch.body ?? []).map((item) => item.healthId)).toEqual(
      Array.from({ length: 181 }, (_, index) => `b${index}`),
    )
    expect(batches.flatMap((batch) => batch.workouts ?? [])).toHaveLength(7)
    expect(batches.flatMap((batch) => batch.daily ?? [])).toHaveLength(251)
    expect(batches.flatMap((batch) => batch.deleted ?? [])).toHaveLength(3)
  })
})

describe("cleanHealthChanges", () => {
  const nothing = changes({ deleted: 0, body: 0, workouts: 0, daily: 0 })

  it("drops readings the server would refuse, so one bad value cannot stop every sync", () => {
    const cleaned = cleanHealthChanges({
      ...nothing,
      deleted: ["", "x".repeat(65), "ok"],
      body: [body(1), { ...body(2), value: 0 }, { ...body(3), value: 1500 }, { ...body(4), value: Number.NaN }],
      daily: [daily(5), { ...daily(6), value: -1 }, { ...daily(7), value: 2_000_000 }],
    })

    expect(cleaned.deleted).toEqual(["ok"])
    expect(cleaned.body.map((item) => item.healthId)).toEqual(["b1"])
    expect(cleaned.daily.map((item) => item.value)).toEqual([5])
  })

  it("keeps a workout but blanks a number that is out of range", () => {
    const cleaned = cleanHealthChanges({
      ...nothing,
      workouts: [{ ...workout(1), avgHeartRate: 900, energyKcal: 350, durationSeconds: 1800.6, distanceMeters: -5 }],
    })

    expect(cleaned.workouts).toEqual([
      { ...workout(1), avgHeartRate: null, energyKcal: 350, durationSeconds: 1801, distanceMeters: null },
    ])
  })

  it("keeps what a food tracker wrote to Health, for the food log", () => {
    const food: ReadonlyArray<DailyRecord> = [
      { day: "2026-11-17", metric: "dietaryEnergy", value: 2350 },
      { day: "2026-11-17", metric: "dietaryProtein", value: 165.4 },
      { day: "2026-11-17", metric: "dietaryCarbs", value: 240 },
      { day: "2026-11-17", metric: "dietaryFat", value: 70.2 },
    ]

    expect(cleanHealthChanges({ ...nothing, daily: food }).daily).toEqual(food)
    expect(healthBatches({ ...nothing, daily: food })).toEqual([{ daily: food }])
  })

  it("drops a workout of a type the server cannot store", () => {
    expect(cleanHealthChanges({ ...nothing, workouts: [{ ...workout(1), activity: 99_999 }] }).workouts).toEqual([])
  })
})
