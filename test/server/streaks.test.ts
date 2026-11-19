import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DEFAULT_STREAK_GOALS } from "~/domain/streaks"
import { makeServer, type Account, type TestServer } from "./harness"

/** Streak goals through the API: what is saved, and how the calendar and Today data mark walks. */

let server: TestServer

beforeEach(() => {
  server = makeServer()
})

afterEach(() => server.close())

const logWalk = async (me: Account) => {
  const workoutId = await me.call("startOpenWorkout", {})

  await me.call("addWorkoutExercise", { workoutId, exercise: "Walk" })

  const { exerciseId } = (await me.call("getWorkout", { workoutId })).exercises[0]!

  await me.call("logSet", { workoutId, exerciseId, set: { weight: 0, reps: 0, durationSeconds: 1800, distance: 2.4 } })
  await me.call("finishWorkout", { workoutId })

  return workoutId
}

describe("streak goals", () => {
  it("start as a workout every week", async () => {
    const me = await server.signUp()

    expect((await me.call("getSession", {})).streakGoals).toEqual(DEFAULT_STREAK_GOALS)
  })

  it("save one or two goals, reading a daily goal as once a day", async () => {
    const me = await server.signUp()

    await me.call("updateProfile", {
      streakGoals: [
        { activity: "walking", period: "day", target: 4 },
        { activity: "training", period: "week", target: 3 },
      ],
    })

    expect((await me.call("getSession", {})).streakGoals).toEqual([
      { activity: "walking", period: "day", target: 1 },
      { activity: "training", period: "week", target: 3 },
    ])
  })

  it("keep the saved goals when the rest of the profile changes", async () => {
    const me = await server.signUp()
    const goals = [{ activity: "any", period: "week", target: 5 }] as const

    await me.call("updateProfile", { streakGoals: goals })
    await me.call("updateProfile", { goal: "Run a 10k" })

    expect((await me.call("getSession", {})).streakGoals).toEqual(goals)
  })

  it("leave an account that never chose goals on the default, whatever else it saves", async () => {
    const me = await server.signUp("default@example.com")

    await me.call("updateProfile", { displayName: "Renamed" })

    expect(server.readText(`SELECT streak_goals FROM users WHERE email = 'default@example.com'`)).toBe("")
  })

  it("refuse no goals, three goals, or one it does not know", async () => {
    const me = await server.signUp()
    const goal = { activity: "training", period: "week", target: 1 }

    for (const streakGoals of [[], [goal, goal, goal], [{ ...goal, activity: "swimming" }], [{ ...goal, target: 9 }]]) {
      expect((await server.request("call/updateProfile", { token: me.token, body: { streakGoals } })).status).toBe(400)
    }
  })

  it("fall back to the default when what is stored cannot be read", async () => {
    const me = await server.signUp("broken@example.com")

    server.exec(`UPDATE users SET streak_goals = '{not json' WHERE email = 'broken@example.com'`)

    expect((await me.call("getSession", {})).streakGoals).toEqual(DEFAULT_STREAK_GOALS)
  })
})

describe("walks on the calendar", () => {
  it("mark a workout that is only a walk, and nothing else, as a walk", async () => {
    const me = await server.signUp()

    server.seed(me.email)

    const walk = await logWalk(me)
    const calendar = await me.call("getCalendar", {})

    expect(calendar.find((workout) => workout.id === walk)?.kind).toBe("walk")
    expect(calendar.filter((workout) => workout.kind === "walk")).toHaveLength(1)
    expect((await me.call("getToday", {})).activity.at(-1)?.kind).toBe("walk")
  })

  it("count a walk with a lift in it as training", async () => {
    const me = await server.signUp()
    const workoutId = await me.call("startOpenWorkout", {})

    await me.call("addWorkoutExercise", { workoutId, exercise: "Walk" })
    await me.call("addWorkoutExercise", { workoutId, exercise: "Squat" })

    for (const { exerciseId, exerciseName } of (await me.call("getWorkout", { workoutId })).exercises) {
      const set = exerciseName === "Walk" ? { weight: 0, reps: 0, durationSeconds: 600 } : { weight: 100, reps: 5 }

      await me.call("logSet", { workoutId, exerciseId, set })
    }

    await me.call("finishWorkout", { workoutId })

    expect((await me.call("getCalendar", {}))[0]?.kind).toBe("training")
  })

  it("mark a walk from Apple Health as a walk", async () => {
    const me = await server.signUp()
    const startedAt = Date.now() - 7_200_000

    await me.call("importHealth", {
      workouts: [{ healthId: "walk-1", activity: 52, indoor: false, startedAt, endedAt: startedAt + 1_800_000, durationSeconds: 1800 }],
    })

    expect((await me.call("getCalendar", {}))[0]?.kind).toBe("walk")
  })
})
