import { Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { shiftDay } from "~/domain/days"
import type { MiniSettings } from "~/domain/minis"
import { runNudges } from "~/server/minis"
import { makeTestBrowser, readVapid, type TestBrowser } from "../push-client"
import { makeServer, type Account, type TestServer } from "./harness"

/** Mini workouts through the API, and the nudges the cron sends. */

let server: TestServer

beforeEach(() => {
  server = makeServer()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await server.close()
})

// A Thursday, at 10:00 in UTC, which these settings read the window in.
const DAY = "2026-11-26"
const TEN_AM = Date.parse(`${DAY}T10:00:00Z`)
const HOUR = 3_600_000

const SETTINGS: MiniSettings = {
  targets: [
    { exercise: "Push-Up", unit: "reps", daily: 100, chunk: 25, growBy: 0 },
    { exercise: "Sit-Up", unit: "reps", daily: 50, chunk: 25, growBy: 0 },
  ],
  nudges: true,
  days: [0, 1, 2, 3, 4, 5, 6],
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  gapMinutes: 45,
  timeZone: "UTC",
  pausedUntil: null,
}

/** What a notification carries, as the service worker reads it. */
const decodeMessage = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ title: Schema.String, body: Schema.String, url: Schema.String, tag: Schema.String })),
)

const setUp = async (me: Account, settings: Partial<MiniSettings> = {}, day = DAY) =>
  me.call("updateMinis", { day, settings: { ...SETTINGS, ...settings } })

const today = async (me: Account, day = DAY) => (await me.call("getMinis", { from: day, to: day })).days[0]!

describe("mini workout settings", () => {
  it("start empty, with nudges off", async () => {
    const me = await server.signUp()
    const minis = await me.call("getMinis", { from: DAY, to: DAY })

    expect(minis.settings.targets).toEqual([])
    expect(minis.settings.nudges).toBe(false)
    expect(minis.days).toEqual([{ day: DAY, targets: [], progress: [], met: false }])
    expect(minis.push.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/)
  })

  it("save and read back, and today takes the targets at once", async () => {
    const me = await server.signUp()

    await setUp(me)

    const minis = await me.call("getMinis", { from: DAY, to: DAY })

    expect(minis.settings).toEqual(SETTINGS)
    expect(minis.days[0]!.progress).toEqual([
      { exercise: "Push-Up", unit: "reps", target: 100, done: 0 },
      { exercise: "Sit-Up", unit: "reps", target: 50, done: 0 },
    ])
  })

  it("refuse a window under half an hour, an end before the start, and one exercise twice", async () => {
    const me = await server.signUp()

    const send = (settings: Partial<MiniSettings>) =>
      server.request("call/updateMinis", { token: me.token, body: { day: DAY, settings: { ...SETTINGS, ...settings } } })

    expect((await send({ startMinute: 600, endMinute: 620 })).status).toBe(400)
    expect((await send({ startMinute: 900, endMinute: 600 })).status).toBe(400)
    expect((await send({ targets: [SETTINGS.targets[0]!, { ...SETTINGS.targets[0]!, exercise: "push-up" }] })).status).toBe(400)
    expect((await send({ timeZone: "Mars/Olympus" })).status).toBe(400)
  })

  it("keep each day's targets as they were, so changing them later leaves past days alone", async () => {
    const me = await server.signUp()
    const yesterday = shiftDay(DAY, -1)

    await setUp(me, {}, yesterday)
    await me.call("logMini", { day: yesterday, exercise: "Push-Up", amount: 100 })
    await me.call("logMini", { day: yesterday, exercise: "Sit-Up", amount: 50 })
    await setUp(me, { targets: [{ exercise: "Push-Up", unit: "reps", daily: 200, chunk: 25, growBy: 0 }] })

    const minis = await me.call("getMinis", { from: yesterday, to: DAY })

    expect(minis.days.map((day) => [day.day, day.met, day.progress.map((item) => item.target)])).toEqual([
      [yesterday, true, [100, 50]],
      [DAY, false, [200]],
    ])
    expect(minis.metDays).toEqual([yesterday])
  })
})

describe("logging mini workouts", () => {
  it("adds up toward each target, and the day counts once every target is done", async () => {
    const me = await server.signUp()

    await setUp(me)
    await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 60 })
    await me.call("logMini", { day: DAY, exercise: "push-up", amount: 40 })

    expect((await today(me)).met).toBe(false)

    const last = await me.call("logMini", { day: DAY, exercise: "Sit-Up", amount: 50 })

    expect(last.exercise).toBe("Sit-Up")
    expect(await today(me)).toMatchObject({ met: true, progress: [{ done: 100 }, { done: 50 }] })
    expect((await me.call("getMinis", { from: DAY, to: DAY })).metDays).toEqual([DAY])

    await me.call("deleteMini", { entryId: last.id })

    expect((await me.call("getMinis", { from: DAY, to: DAY })).metDays).toEqual([])
  })

  it("logs a set sent twice with the same key once", async () => {
    const me = await server.signUp()

    await setUp(me)
    await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 25, clientKey: "phone-set-1" })
    await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 25, clientKey: "phone-set-1" })

    expect((await today(me)).progress[0]!.done).toBe(25)
  })

  it("keeps each account's sets to itself", async () => {
    const me = await server.signUp()
    const other = await server.signUp()

    await setUp(me)
    const entry = await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 25 })

    expect((await server.request("call/deleteMini", { token: other.token, body: { entryId: entry.id } })).status).toBe(404)
  })

  it("never shows in the training history or counts as a workout", async () => {
    const me = await server.signUp()

    await setUp(me)
    await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 100 })

    expect(await me.call("getCalendar", {})).toEqual([])
    expect((await me.call("getHistory", {})).totals.workouts).toBe(0)
  })
})

describe("nudges", () => {
  let browser: TestBrowser
  let pushes: Array<{ readonly url: string; readonly headers: Headers; readonly body: Uint8Array<ArrayBuffer> }>
  let answer: number

  beforeEach(async () => {
    browser = await makeTestBrowser()
    pushes = []
    answer = 201

    // The push service: it keeps what it was sent, and answers with `answer`.
    vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
      pushes.push({ url: input, headers: new Headers(init.headers), body: new Uint8Array(await new Response(init.body).arrayBuffer()) })

      return new Response(null, { status: answer })
    })
  })

  const subscribe = (me: Account) =>
    me.call("subscribePush", {
      subscription: { endpoint: "https://web.push.apple.com/device-1", keys: { p256dh: browser.p256dh, auth: browser.auth } },
      origin: "https://gym.example.com",
    })

  // A random that always lands at the start of its range, so the first nudge goes as the window opens.
  const tick = (time: number) => server.run(runNudges(time, () => 0))

  const message = async (index: number) => decodeMessage(await browser.decrypt(pushes[index]!.body))

  it("sends what is due, encrypted for the browser and signed, opening the nudge", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)

    expect(await tick(TEN_AM)).toEqual({ checked: 1, sent: 1 })
    expect(pushes).toHaveLength(1)

    const push = pushes[0]!
    const { nudges } = await me.call("getMinis", { from: DAY, to: DAY })
    const nudge = nudges[0]!

    expect(push.url).toBe("https://web.push.apple.com/device-1")
    expect(push.headers.get("content-encoding")).toBe("aes128gcm")
    expect(await readVapid(push.headers.get("authorization") ?? "")).toMatchObject({ aud: "https://web.push.apple.com", sub: "https://gym.example.com" })
    expect(await message(0)).toEqual({
      title: "Got time for 25 push-ups?",
      body: "0 of 100 done today. Tap to log it.",
      url: `https://gym.example.com/minis?nudge=${nudge.id}`,
      tag: `mini-${nudge.id}`,
    })
    expect(nudge).toMatchObject({ day: DAY, exercise: "Push-Up", amount: 25, status: "sent" })
  })

  it("spaces nudges out, never sooner than the gap, and moves to another exercise", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)
    await tick(TEN_AM)

    expect((await tick(TEN_AM + 30 * 60_000)).sent).toBe(0)
    expect((await tick(TEN_AM + 2 * HOUR)).sent).toBe(1)
    expect((await message(1)).title).toBe("Got time for 25 sit-ups?")
  })

  it("counts what was done when it asks again, and stops once the day is done", async () => {
    const me = await server.signUp()

    await setUp(me, { targets: [{ exercise: "Push-Up", unit: "reps", daily: 50, chunk: 25, growBy: 0 }] })
    await subscribe(me)
    await tick(TEN_AM)

    const nudge = (await me.call("getMinis", { from: DAY, to: DAY })).nudges[0]!

    await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 25, nudgeId: nudge.id })
    // One nudge left in seven hours: the next one comes a few hours on.
    expect((await tick(TEN_AM + 2 * HOUR)).sent).toBe(0)
    await tick(TEN_AM + 4 * HOUR)

    expect(await message(1)).toMatchObject({ title: "Got time for 25 push-ups?", body: "That finishes today's 50. Tap to log it." })

    await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 25 })

    expect((await tick(TEN_AM + 6 * HOUR)).sent).toBe(0)
    expect((await me.call("getMinis", { from: DAY, to: DAY })).nudges.map((item) => item.status)).toEqual(["done", "sent"])
  })

  it("asks for more at a time when the day is running out", async () => {
    const me = await server.signUp()

    await setUp(me, { targets: [{ exercise: "Push-Up", unit: "reps", daily: 100, chunk: 20, growBy: 0 }], gapMinutes: 60 })
    await subscribe(me)
    // Two hours left, so three nudges at most: 100 asks for 35 at a time, not 20.
    await tick(Date.parse(`${DAY}T15:00:00Z`))

    expect((await message(0)).title).toBe("Got time for 35 push-ups?")
  })

  it("sends nothing outside the window, on a day off, while paused, or while a workout is open", async () => {
    const me = await server.signUp()

    await subscribe(me)
    await setUp(me, { startMinute: 11 * 60 })
    expect((await tick(TEN_AM)).sent).toBe(0)

    await setUp(me, { days: [0, 1, 2] })
    expect((await tick(TEN_AM)).sent).toBe(0)

    await setUp(me, { pausedUntil: shiftDay(DAY, 1) })
    expect((await tick(TEN_AM)).sent).toBe(0)

    await setUp(me, { nudges: false })
    expect((await tick(TEN_AM)).sent).toBe(0)

    await setUp(me)
    server.exec(`INSERT INTO workouts (user_id, name, started_at) SELECT id, 'Push day', ${TEN_AM - HOUR} FROM users WHERE email = '${me.email}'`)
    expect((await tick(TEN_AM)).sent).toBe(0)
    expect(pushes).toHaveLength(0)
  })

  it("forgets a browser the push service says is gone", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)
    answer = 410
    await tick(TEN_AM)

    expect((await me.call("getMinis", { from: DAY, to: DAY })).push.devices).toBe(0)
  })

  it("marks a nudge passed over", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)
    await tick(TEN_AM)

    const nudge = (await me.call("getMinis", { from: DAY, to: DAY })).nudges[0]!

    await me.call("skipNudge", { nudgeId: nudge.id })

    expect((await me.call("getMinis", { from: DAY, to: DAY })).nudges[0]!.status).toBe("skipped")
  })

  it("sends a test to every browser of the account", async () => {
    const me = await server.signUp()

    await subscribe(me)

    expect(await me.call("testPush", {})).toEqual({ sent: 1, failed: 0 })
    expect((await message(0)).title).toBe("Nudges are on")
  })
})

describe("growing targets", () => {
  it("raise a target after a week it was met on every nudge day, and not after one it was missed", async () => {
    const me = await server.signUp()

    // Monday 16 to Friday 20 November are nudge days; the weekend is not.
    const week = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]

    const settings = {
      targets: [
        { exercise: "Push-Up", unit: "reps", daily: 100, chunk: 25, growBy: 10 },
        { exercise: "Sit-Up", unit: "reps", daily: 50, chunk: 25, growBy: 10 },
      ],
      days: [0, 1, 2, 3, 4],
    } as const

    await setUp(me, settings, week[0])

    for (const day of week) {
      await me.call("logMini", { day, exercise: "Push-Up", amount: 100 })

      if (day !== "2026-11-18") await me.call("logMini", { day, exercise: "Sit-Up", amount: 50 })
    }

    // The first thing logged in the next week looks back at the last one.
    await me.call("logMini", { day: "2026-11-23", exercise: "Push-Up", amount: 10 })

    const minis = await me.call("getMinis", { from: "2026-11-23", to: "2026-11-23" })

    expect(minis.settings.targets.map((target) => [target.exercise, target.daily])).toEqual([
      ["Push-Up", 110],
      ["Sit-Up", 50],
    ])
    expect(minis.days[0]!.progress.map((item) => item.target)).toEqual([110, 50])
  })
})
