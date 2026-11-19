import { Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PLAN_TEMPLATES } from "~/domain/templates"
import { makeServer, seedHistory, type TestServer } from "./harness"

/** The JSON API as the native app uses it: status codes, sign-in, and what the calls do to the data. */

let server: TestServer

beforeEach(() => {
  server = makeServer()
})

afterEach(() => server.close())

describe("the HTTP envelope", () => {
  it("only takes POST", async () => {
    const answer = await server.request("deployment", { method: "GET" })

    expect(answer.status).toBe(405)
    expect(answer.body).toMatchObject({ ok: false, error: { code: "invalid" } })
  })

  it("says which copy of the app this is", async () => {
    expect((await server.request("deployment")).body).toEqual({ ok: true, value: { stage: "test" } })
  })

  it("refuses a call without a session", async () => {
    const answer = await server.request("call/getToday")

    expect(answer.status).toBe(401)
    expect(answer.body).toMatchObject({ ok: false, error: { code: "unauthorized" } })
  })

  it("refuses a made-up session", async () => {
    expect((await server.request("call/getToday", { token: "not-a-real-token" })).status).toBe(401)
  })

  it("answers 404 for a call that does not exist", async () => {
    const me = await server.signUp()

    expect((await server.request("call/dropTables", { token: me.token })).status).toBe(404)
  })

  it("answers 400 with the reason for input that does not fit", async () => {
    const me = await server.signUp()
    const answer = await server.request("call/getWorkout", { token: me.token, body: { workoutId: "seven" } })

    expect(answer.status).toBe(400)
    expect(answer.body).toMatchObject({ ok: false, error: { code: "invalid" } })
  })
})

describe("accounts", () => {
  it("opens sign-up for the first account only, then needs the invite", async () => {
    expect((await server.request("account/signup-status")).body).toMatchObject({ value: { firstUser: true, open: true } })
    await server.request("account/sign-up", { body: { email: "first@example.com", password: "a long enough password", displayName: "First" } })

    const uninvited = await server.request("account/sign-up", {
      body: { email: "second@example.com", password: "a long enough password", displayName: "Second" },
    })

    expect(uninvited.status).toBe(400)
    expect((await server.request("account/signup-status")).body).toMatchObject({ value: { firstUser: false } })
  })

  it("signs in with the right password only, and signs out", async () => {
    await server.signUp("me@example.com")

    const wrong = await server.request("account/sign-in", { body: { email: "me@example.com", password: "not the password at all" } })
    const right = await server.request("account/sign-in", { body: { email: "me@example.com", password: "a long enough password" } })

    expect(wrong.status).toBe(400)

    if (!right.body.ok) throw new Error(right.body.error.message)

    const { token } = Schema.decodeUnknownSync(Schema.Struct({ token: Schema.String }))(right.body.value)

    expect((await server.request("call/getSession", { token })).status).toBe(200)
    await server.request("account/sign-out", { token })
    expect((await server.request("call/getSession", { token })).status).toBe(401)
  })

  it("keeps each account's data to itself", async () => {
    const me = await server.signUp()
    const other = await server.signUp()

    server.seed(me.email)

    const [mine] = await me.call("getCalendar", {})

    expect(await other.call("getCalendar", {})).toEqual([])
    expect((await server.request("call/getWorkout", { token: other.token, body: { workoutId: mine!.id } })).status).toBe(404)
  })
})

describe("training", () => {
  it("shows the whole seed history once it is loaded", async () => {
    const me = await server.signUp()

    server.seed(me.email)

    expect(await me.call("getCalendar", {})).toHaveLength(seedHistory.workouts.length)
    expect((await me.call("getToday", {})).activity).toHaveLength(seedHistory.workouts.length)
  })

  it("logs a set once however many times the phone resends it", async () => {
    const me = await server.signUp()

    await me.call("applyTemplate", { templateId: PLAN_TEMPLATES[0]!.id })
    const plan = (await me.call("getPlan", {}))!
    const workoutId = await me.call("startWorkout", { planDayId: plan.days[0]!.id })
    const { exerciseId } = (await me.call("getWorkout", { workoutId })).exercises[0]!
    const set = { workoutId, exerciseId, set: { weight: 40, reps: 10 }, clientKey: "resent-set-1" }

    const first = await me.call("logSet", set)
    const again = await me.call("logSet", set)

    expect(again).toBe(first)
    expect((await me.call("getWorkout", { workoutId })).exercises[0]!.sets).toHaveLength(1)
  })

  it("puts a finished workout on the calendar and leaves a discarded one off", async () => {
    const me = await server.signUp()
    const kept = await me.call("startOpenWorkout", {})

    await me.call("addWorkoutExercise", { workoutId: kept, exercise: "Squat" })
    const { exerciseId } = (await me.call("getWorkout", { workoutId: kept })).exercises[0]!

    await me.call("logSet", { workoutId: kept, exerciseId, set: { weight: 100, reps: 5 } })
    await me.call("finishWorkout", { workoutId: kept })

    const dropped = await me.call("startOpenWorkout", {})

    await me.call("discardWorkout", { workoutId: dropped })

    expect((await me.call("getCalendar", {})).map((workout) => workout.id)).toEqual([kept])
    expect((await me.call("getToday", {})).today.activeWorkout).toBeNull()
  })

  it("raises the target weight after every set hits the top of the range", async () => {
    const me = await server.signUp()

    await me.call("applyTemplate", { templateId: PLAN_TEMPLATES[0]!.id })
    const day = (await me.call("getPlan", {}))!.days[0]!
    const exercise = day.exercises.find((item) => item.autoProgress && item.repMax < 30)!

    await me.call("updatePlanExercise", { planExerciseId: exercise.id, changes: { targetWeight: 50 } })

    const workoutId = await me.call("startWorkout", { planDayId: day.id })

    for (let index = 0; index < exercise.sets; index++) {
      await me.call("logSet", { workoutId, exerciseId: exercise.exerciseId, set: { weight: 50, reps: exercise.repMax } })
    }

    const finished = await me.call("finishWorkout", { workoutId })
    const after = (await me.call("getPlan", {}))!.days[0]!.exercises.find((item) => item.id === exercise.id)!

    expect(finished.adjustments.length).toBeGreaterThan(0)
    expect(after.targetWeight).toBe(50 + exercise.increment)
  })
})

describe("food and Health", () => {
  it("adds a day's food up against the targets", async () => {
    const me = await server.signUp()
    const day = "2026-11-18"

    await me.call("updateProfile", { calorieTarget: 2500, proteinTarget: 150 })
    await me.call("logFood", { day, food: { description: "Breakfast", calories: 600, protein: 40 } })
    await me.call("logFood", { day, food: { description: "Lunch", calories: 800, protein: 50 } })

    const nutrition = await me.call("getNutrition", { from: day, to: day })

    expect(nutrition.targets).toEqual({ calories: 2500, protein: 150 })
    expect(nutrition.days[0]!.total).toMatchObject({ calories: 1400, protein: 90 })
  })

  it("logs a walk from Apple Health as a workout, once", async () => {
    const me = await server.signUp()
    const startedAt = Date.now() - 3_600_000

    const walk = {
      healthId: "health-walk-1",
      activity: 52,
      indoor: false,
      startedAt,
      endedAt: startedAt + 1_800_000,
      durationSeconds: 1800,
      distanceMeters: 2500,
    }

    await me.call("importHealth", { workouts: [walk] })
    await me.call("importHealth", { workouts: [walk] })

    const calendar = await me.call("getCalendar", {})

    expect(calendar).toHaveLength(1)
    expect((await me.call("getWorkout", { workoutId: calendar[0]!.id })).exercises[0]!.exerciseName).toBe("Walk")
  })
})
