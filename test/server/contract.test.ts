import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { CallName } from "~/domain/calls"
import { CallInputs } from "~/domain/calls"
import { shiftDay } from "~/domain/days"
import { PLAN_TEMPLATES } from "~/domain/templates"
import type { CallInput, CallOutput } from "~/server/calls"
import { makeServer, type Account, type TestServer } from "./harness"
import { asJson, compareSignatures, mergeSignatures, signatureOf, type Signature } from "./signature"

/**
 * The API contract. Native builds stay on people's phones long after the server changes, so an
 * answer must keep every field an older build reads, with the same kinds of value. This runs
 * every call against a seeded account, records the shape of each answer, and compares it with
 * test/server/api-signatures.json:
 *
 *   - a breaking change (a field removed, a number that can now be null) fails, and needs the
 *     native app changed to match and a decision about older builds;
 *   - anything else (a new field) fails too until the file is updated, so the record stays true:
 *     run `UPDATE_API_SIGNATURES=1 bun run test` and commit the file.
 */

const SIGNATURES_FILE = "test/server/api-signatures.json"
const updating = process.env.UPDATE_API_SIGNATURES === "1"

// Today, so the reads that look back a few weeks (Health, recent workouts) find what was logged.
const DAY = new Date().toISOString().slice(0, 10)

let server: TestServer
let me: Account
const seen = new Map<CallName, Signature>()

/** Runs a call and records the shape of its answer. */
const record = async <K extends CallName>(name: K, input: CallInput<K>): Promise<CallOutput<K>> => {
  const value = await me.call(name, input)
  const signature = signatureOf(asJson(value))
  const before = seen.get(name)

  seen.set(name, before ? mergeSignatures(before, signature) : signature)

  return value
}

/**
 * Every call, in an order that gives each one something to work on. Typed by call name, so a
 * new call cannot be added to src/domain/calls.ts without a step here.
 */
const STEPS = {
  getSession: () => record("getSession", {}),
  updateProfile: () =>
    record("updateProfile", {
      goal: "Get stronger",
      calorieTarget: 2600,
      proteinTarget: 160,
      streakGoals: [
        { activity: "training", period: "week", target: 3 },
        { activity: "walking", period: "day", target: 1 },
        { activity: "minis", period: "week", target: 5 },
      ],
    }),
  getToday: () => record("getToday", {}),
  getPlan: () => record("getPlan", {}),
  getHistory: () => record("getHistory", {}),
  getCalendar: () => record("getCalendar", {}),
  getExercises: () => record("getExercises", {}),
  getExerciseProgress: async () => {
    const exercises = await record("getExercises", {})
    const squat = exercises.find((exercise) => exercise.name === "Squat") ?? exercises[0]!

    return record("getExerciseProgress", { exerciseId: squat.id })
  },
  getLibraryExercise: () => record("getLibraryExercise", { slug: "squat" }),
  getDemos: () => record("getDemos", {}),

  applyTemplate: () => record("applyTemplate", { templateId: PLAN_TEMPLATES[0]!.id }),
  addPlanDay: () => record("addPlanDay", { name: "Extra day" }),
  addPlanExercise: async () => {
    const day = (await plan()).days.at(-1)!

    return record("addPlanExercise", { planDayId: day.id, exercise: { exercise: "Plank", sets: 3, repMin: 30, repMax: 60 } })
  },
  updatePlanExercise: async () =>
    record("updatePlanExercise", { planExerciseId: (await firstPlanExercise()).id, changes: { targetWeight: 60, notes: "Pause at the bottom" } }),
  movePlanExercise: async () => {
    const exercises = (await plan()).days[0]!.exercises

    return record("movePlanExercise", { planExerciseId: exercises.at(-1)!.id, direction: "up" })
  },
  movePlanDay: async () => record("movePlanDay", { planDayId: (await plan()).days.at(-1)!.id, direction: "up" }),
  removePlanExercise: async () => {
    const day = (await plan()).days.find((item) => item.name === "Extra day")!

    return record("removePlanExercise", { planExerciseId: day.exercises[0]!.id })
  },
  removePlanDay: async () =>
    record("removePlanDay", { planDayId: (await plan()).days.find((item) => item.name === "Extra day")!.id }),

  startWorkout: async () => record("startWorkout", { planDayId: (await plan()).days[0]!.id }),
  getWorkout: async () => record("getWorkout", { workoutId: await activeWorkoutId() }),
  logSet: async () => {
    const workoutId = await activeWorkoutId()
    const detail = await record("getWorkout", { workoutId })
    const first = detail.exercises[0]!

    await record("logSet", { workoutId, exerciseId: first.exerciseId, set: { weight: 60, reps: 8, rpe: 8 }, clientKey: "contract-set-1" })

    return record("logSet", { workoutId, exerciseId: first.exerciseId, set: { weight: 60, reps: 7 }, clientKey: "contract-set-2" })
  },
  updateSet: async () =>
    record("updateSet", { setId: await lastSetId(), set: { weight: 62.5, reps: 6, rpe: 9, note: "Grip slipped" } }),
  setExerciseNote: async () =>
    record("setExerciseNote", { workoutId: await activeWorkoutId(), exerciseId: (await firstPlanExercise()).exerciseId, note: "Seat on 4" }),
  deleteSet: async () => record("deleteSet", { setId: await lastSetId() }),
  swapExercise: async () => {
    const workoutId = await activeWorkoutId()
    const exercise = (await plan()).days[0]!.exercises[1]!

    return record("swapExercise", { workoutId, planExerciseId: exercise.id, exercise: "Leg Press" })
  },
  addWorkoutExercise: async () => record("addWorkoutExercise", { workoutId: await activeWorkoutId(), exercise: "Walk" }),
  removeWorkoutExercise: async () => {
    const workoutId = await activeWorkoutId()
    const walk = (await record("getWorkout", { workoutId })).exercises.find((exercise) => exercise.exerciseName === "Walk")!

    return record("removeWorkoutExercise", { workoutId, exerciseId: walk.exerciseId })
  },
  finishWorkout: async () => record("finishWorkout", { workoutId: await activeWorkoutId() }),
  startOpenWorkout: () => record("startOpenWorkout", {}),
  discardWorkout: async () => record("discardWorkout", { workoutId: await activeWorkoutId() }),

  deleteCoachNote: async () => {
    server.exec(`INSERT INTO coach_notes (user_id, body, created_at)
      SELECT id, 'Focus on depth this week.', 1795000000000 FROM users WHERE email = '${me.email}'`)
    const note = (await record("getToday", {})).today.notes[0]!

    return record("deleteCoachNote", { noteId: note.id })
  },

  logMeasurement: async () => {
    await record("logMeasurement", { kind: "weight", value: 82.4 })

    return record("logMeasurement", { kind: "waist", value: 84 })
  },
  deleteMeasurement: async () => {
    const { measurements } = await record("getHistory", {})

    return record("deleteMeasurement", { measurementId: measurements.find((item) => item.kind === "waist")!.id })
  },

  logFood: () => record("logFood", { day: DAY, food: { description: "Oats with whey", calories: 520, protein: 42, carbs: 60, fat: 12 } }),
  updateFood: async () => record("updateFood", { foodId: await foodId(), food: { description: "Oats with whey and banana", calories: 610 } }),
  getNutrition: () => record("getNutrition", { from: "2026-11-12", to: DAY }),
  deleteFood: async () => record("deleteFood", { foodId: await foodId() }),

  importHealth: () =>
    record("importHealth", {
      body: [{ healthId: "body-1", kind: "weight", value: 82.1, measuredAt: Date.parse(`${DAY}T00:05:00Z`) }],
      workouts: [
        {
          healthId: "walk-1",
          activity: 52,
          indoor: false,
          startedAt: Date.parse(`${DAY}T00:10:00Z`),
          endedAt: Date.parse(`${DAY}T00:50:00Z`),
          durationSeconds: 2400,
          distanceMeters: 3200,
          energyKcal: 180,
          avgHeartRate: 104,
        },
      ],
      daily: [
        { day: DAY, metric: "sleep", value: 452 },
        { day: DAY, metric: "steps", value: 9120 },
      ],
    }),
  getHealth: () => record("getHealth", {}),

  updateMinis: () =>
    record("updateMinis", {
      day: DAY,
      settings: {
        targets: [
          { exercise: "Push-Up", unit: "reps", daily: 100, chunk: 25, growBy: 5 },
          { exercise: "Plank", unit: "seconds", daily: 180, chunk: 60, growBy: 0 },
        ],
        nudges: true,
        days: [0, 1, 2, 3, 4],
        startMinute: 540,
        endMinute: 1050,
        gapMinutes: 45,
        timeZone: "Australia/Brisbane",
        pausedUntil: null,
      },
    }),
  logMini: () => record("logMini", { day: DAY, exercise: "Push-Up", amount: 25, clientKey: "contract-mini-1" }),
  skipNudge: async () => {
    server.exec(`INSERT INTO mini_nudges (user_id, day, exercise, unit, amount, sent_at)
      SELECT id, '${DAY}', 'Plank', 'seconds', 60, 1795000000000 FROM users WHERE email = '${me.email}'`)
    const nudge = (await record("getMinis", { from: DAY, to: DAY })).nudges[0]!

    return record("skipNudge", { nudgeId: nudge.id })
  },
  deleteMini: async () => {
    const entry = await record("logMini", { day: DAY, exercise: "Plank", amount: 60 })

    return record("deleteMini", { entryId: entry.id })
  },
  getMinis: () => record("getMinis", { from: shiftDay(DAY, -1), to: shiftDay(DAY, 1) }),
  // A key that is not a real one: the push fails before anything is sent, so the test never reaches the network.
  subscribePush: () =>
    record("subscribePush", {
      subscription: { endpoint: "https://push.example.com/contract", keys: { p256dh: "bm90LWEta2V5", auth: "bm90LWEtc2VjcmV0" } },
      origin: "https://gym.example.com",
    }),
  testPush: () => record("testPush", {}),
  unsubscribePush: () => record("unsubscribePush", { endpoint: "https://push.example.com/contract" }),
} satisfies { readonly [K in CallName]: () => Promise<void | CallOutput<CallName>> }

const plan = async () => {
  const current = await me.call("getPlan", {})

  if (!current) throw new Error("No active plan")

  return current
}

const firstPlanExercise = async () => (await plan()).days[0]!.exercises[0]!

const activeWorkoutId = async () => {
  const { today } = await me.call("getToday", {})

  if (!today.activeWorkout) throw new Error("No workout in progress")

  return today.activeWorkout.id
}

const lastSetId = async () => {
  const detail = await me.call("getWorkout", { workoutId: await activeWorkoutId() })

  return detail.exercises.flatMap((exercise) => exercise.sets).at(-1)!.id
}

const foodId = async () => (await me.call("getNutrition", { from: DAY, to: DAY })).entries[0]!.id

/** The order the steps run in: reads of the seeded account, then the plan, a workout, and the rest. */
const ORDER: ReadonlyArray<CallName> = [
  "getSession",
  "getToday",
  "getPlan",
  "getHistory",
  "getCalendar",
  "getExercises",
  "getExerciseProgress",
  "getLibraryExercise",
  "getDemos",
  "updateProfile",
  "applyTemplate",
  "getPlan",
  "addPlanDay",
  "addPlanExercise",
  "updatePlanExercise",
  "movePlanExercise",
  "movePlanDay",
  "removePlanExercise",
  "removePlanDay",
  "getToday",
  "startWorkout",
  "getToday",
  "getWorkout",
  "logSet",
  "updateSet",
  "setExerciseNote",
  "logSet",
  "deleteSet",
  "swapExercise",
  "addWorkoutExercise",
  "removeWorkoutExercise",
  "finishWorkout",
  "getToday",
  "getHistory",
  "getCalendar",
  "startOpenWorkout",
  "discardWorkout",
  "deleteCoachNote",
  "logMeasurement",
  "deleteMeasurement",
  "logFood",
  "updateFood",
  "getNutrition",
  "deleteFood",
  "getNutrition",
  "importHealth",
  "getHealth",
  "getHistory",
  "updateMinis",
  "logMini",
  "skipNudge",
  "deleteMini",
  "getMinis",
  "subscribePush",
  "testPush",
  "unsubscribePush",
  "getMinis",
  "getToday",
]

beforeAll(async () => {
  server = makeServer()
  me = await server.signUp("contract@example.com")
  server.seed(me.email)

  for (const name of ORDER) await STEPS[name]()
})

afterAll(() => server.close())

describe("the API contract", () => {
  it("runs every call", () => {
    expect([...seen.keys()].toSorted()).toEqual(Object.keys(CallInputs).toSorted())
  })

  it("answers every call with the shape native builds expect", () => {
    const current = Object.fromEntries([...seen.entries()].toSorted(([a], [b]) => a.localeCompare(b)))

    if (updating) {
      writeFileSync(SIGNATURES_FILE, `${JSON.stringify(current, null, 2)}\n`)

      return
    }

    expect(existsSync(SIGNATURES_FILE), `${SIGNATURES_FILE} is missing. Make it with UPDATE_API_SIGNATURES=1 bun run test`).toBe(true)

    const recorded: Record<string, Signature> = JSON.parse(readFileSync(SIGNATURES_FILE, "utf8"))

    const differences = Object.keys({ ...recorded, ...current }).flatMap((name) => {
      const before = recorded[name]
      const after = current[name]

      if (!before) return [{ path: name, change: "is a new call", breaking: false }]

      if (!after) return [{ path: name, change: "was removed", breaking: true }]

      return compareSignatures(before, after, name)
    })

    const breaking = differences.filter((difference) => difference.breaking)
    const other = differences.filter((difference) => !difference.breaking)
    const list = (items: typeof differences) => items.map((item) => `  ${item.path} ${item.change}`).join("\n")

    expect(
      breaking,
      `These changes can break native builds already installed:\n${list(breaking)}\n` +
        "Keep the old fields, or change apps/mobile and decide what happens to older builds before updating " +
        `${SIGNATURES_FILE} with UPDATE_API_SIGNATURES=1.`,
    ).toEqual([])
    expect(other, `The API changed in ways older builds can handle:\n${list(other)}\nRecord it: UPDATE_API_SIGNATURES=1 bun run test`).toEqual([])
  })
})
