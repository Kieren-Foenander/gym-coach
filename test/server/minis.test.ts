import { Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { shiftDay } from "~/domain/days"
import type { MiniSettings } from "~/domain/minis"
import { runNudges } from "~/server/minis"
import { makeTestBrowser, readVapid, type TestBrowser } from "../push-client"
import { makeServer, type Account, type TestServer } from "./harness"

/** Mini workouts through the API, and the nudges the cron sends. */

let server: TestServer

// A Thursday, at 10:00 in UTC, which these settings read the window in.
const DAY = "2026-11-26"
const TEN_AM = Date.parse(`${DAY}T10:00:00Z`)
const HOUR = 3_600_000

/** Sets the server's clock, which decides the day a settings save lands on. */
const clockAt = (time: number) => vi.setSystemTime(time)

beforeEach(() => {
  // Only the date is faked, so the database and timers run as normal.
  vi.useFakeTimers({ toFake: ["Date"] })
  clockAt(TEN_AM)
  server = makeServer()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  await server.close()
})

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

/** Saves settings on `day`, at 10:00 on it: the server reads the day in the saved time zone, not the one sent. */
const setUp = async (me: Account, settings: Partial<MiniSettings> = {}, day = DAY) => {
  clockAt(Date.parse(`${day}T10:00:00Z`))

  return me.call("updateMinis", { day, settings: { ...SETTINGS, ...settings } })
}

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

  it("counts the day done when sets logged at once finish it, whichever request ends last", async () => {
    const me = await server.signUp()

    await setUp(me, { targets: [{ exercise: "Push-Up", unit: "reps", daily: 100, chunk: 25, growBy: 0 }] })
    await Promise.all([
      me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 40 }),
      me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 60 }),
    ])

    expect((await me.call("getMinis", { from: DAY, to: DAY })).metDays).toEqual([DAY])
  })

  it("matches sets to targets by the same name whatever its case, beyond ASCII too, in the streak as on screen", async () => {
    const me = await server.signUp()

    await setUp(me, { targets: [{ exercise: "Élévation", unit: "reps", daily: 20, chunk: 10, growBy: 0 }] })
    await me.call("logMini", { day: DAY, exercise: "Élévation", amount: 20 })
    await setUp(me, { targets: [{ exercise: "élévation", unit: "reps", daily: 20, chunk: 10, growBy: 0 }] })

    expect((await today(me)).met).toBe(true)
    expect((await me.call("getMinis", { from: DAY, to: DAY })).metDays).toEqual([DAY])
  })

  it("keeps a save that turns nudges off when last week's review and it happen together", async () => {
    const me = await server.signUp()
    const week = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]
    const targets = [{ exercise: "Push-Up", unit: "reps", daily: 100, chunk: 25, growBy: 10 }] as const

    await setUp(me, { targets, days: [0, 1, 2, 3, 4] }, week[0])

    for (const day of week) {
      clockAt(Date.parse(`${day}T10:00:00Z`))
      await me.call("logMini", { day, exercise: "Push-Up", amount: 100 })
    }

    clockAt(Date.parse("2026-11-23T10:00:00Z"))

    // Monday's first set (which reviews the week) and a save turning nudges off, sent at once.
    await Promise.all([
      me.call("logMini", { day: "2026-11-23", exercise: "Push-Up", amount: 10 }),
      me.call("updateMinis", { day: "2026-11-23", settings: { ...SETTINGS, targets, days: [0, 1, 2, 3, 4], nudges: false }, base: targets }),
    ])

    const { settings } = await me.call("getMinis", { from: "2026-11-23", to: "2026-11-23" })

    expect(settings.nudges).toBe(false)
    expect(settings.targets[0]!.daily).toBe(110)
    expect((await today(me, "2026-11-23")).progress[0]!.target).toBe(110)
  })

  it("never writes back a planned nudge time when a set is logged", async () => {
    const me = await server.signUp()

    await setUp(me)
    server.exec(`UPDATE mini_days SET next_nudge_at = 123456 WHERE day = '${DAY}'`)
    await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 25 })

    expect(server.readText(`SELECT CAST(next_nudge_at AS TEXT) FROM mini_days WHERE day = '${DAY}'`)).toBe("123456")
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
    // The harness serves plain http, so the server names an address rather than itself.
    expect(await readVapid(push.headers.get("authorization") ?? "")).toMatchObject({ aud: "https://web.push.apple.com", sub: "mailto:nudges@localhost" })
    expect(await message(0)).toEqual({
      title: "Got time for 25 push-ups?",
      body: "0 of 100 done today. Tap to log it.",
      url: `/minis?nudge=${nudge.id}`,
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
    // Two hours left with an hour gap: nudges at 15:00 and 16:00 only, as 17:00 is closed. 100 asks for 50,
    // held to twice the usual: 40.
    await tick(Date.parse(`${DAY}T15:00:00Z`))

    expect((await message(0)).title).toBe("Got time for 40 push-ups?")
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

  it("sends a test to every browser of the account, at most every half minute", async () => {
    const me = await server.signUp()

    await subscribe(me)

    expect(await me.call("testPush", {})).toEqual({ sent: 1, failed: 0 })
    expect((await message(0)).title).toBe("Nudges are on")
    expect((await server.request("call/testPush", { token: me.token })).status).toBe(400)

    clockAt(TEN_AM + 31_000)

    expect(await me.call("testPush", {})).toEqual({ sent: 1, failed: 0 })
  })

  it("sends one nudge when two runs look at once", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)

    const runs = await Promise.all([tick(TEN_AM), tick(TEN_AM), tick(TEN_AM)])

    expect(runs.reduce((total, run) => total + run.sent, 0)).toBe(1)
    expect(pushes).toHaveLength(1)
    expect((await me.call("getMinis", { from: DAY, to: DAY })).nudges).toHaveLength(1)
  })

  it("keeps nudging after the last ask of the day is passed over or only half done", async () => {
    const me = await server.signUp()

    await setUp(me, { targets: [{ exercise: "Push-Up", unit: "reps", daily: 25, chunk: 25, growBy: 0 }] })
    await subscribe(me)
    await tick(TEN_AM)

    const first = (await me.call("getMinis", { from: DAY, to: DAY })).nudges[0]!

    await me.call("skipNudge", { nudgeId: first.id })

    expect((await tick(TEN_AM + 4 * HOUR)).sent).toBe(1)

    await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 10 })

    expect((await tick(TEN_AM + 6 * HOUR)).sent).toBe(1)
    expect((await message(2)).title).toBe("Got time for 15 push-ups?")
  })

  it("tries again soon when no push service takes a nudge, and keeps no record of it", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)
    answer = 503

    expect((await tick(TEN_AM)).sent).toBe(0)
    expect((await me.call("getMinis", { from: DAY, to: DAY })).nudges).toEqual([])

    answer = 201

    expect((await tick(TEN_AM + 5 * 60_000)).sent).toBe(0)
    expect((await tick(TEN_AM + 10 * 60_000)).sent).toBe(1)
    expect((await me.call("getMinis", { from: DAY, to: DAY })).push.devices).toBe(1)
  })

  it("never sends sooner than the gap, even when a settings change plans the day again", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)
    await tick(TEN_AM)
    await setUp(me, { pausedUntil: shiftDay(DAY, 1) })
    await setUp(me)

    expect((await tick(TEN_AM + 5 * 60_000)).sent).toBe(0)
    expect((await tick(TEN_AM + 40 * 60_000)).sent).toBe(0)
    expect((await tick(TEN_AM + 45 * 60_000)).sent).toBe(1)
  })

  it("logs one set for a nudge, on the nudge's own day, however many times and days it is answered", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)
    await tick(TEN_AM)

    const nudge = (await me.call("getMinis", { from: DAY, to: DAY })).nudges[0]!
    const tomorrow = shiftDay(DAY, 1)
    const first = await me.call("logMini", { day: tomorrow, exercise: "Sit-Up", amount: 25, nudgeId: nudge.id, clientKey: "phone-1234" })
    const second = await me.call("logMini", { day: tomorrow, exercise: "Push-Up", amount: 25, nudgeId: nudge.id, clientKey: "laptop-1234" })

    expect(first).toMatchObject({ day: DAY, exercise: "Push-Up", nudgeId: nudge.id })
    expect(second.id).toBe(first.id)
    expect((await today(me)).progress[0]!.done).toBe(25)
    expect((await today(me, tomorrow)).progress.map((item) => item.done)).toEqual([0, 0])
    expect((await me.call("getMinis", { from: DAY, to: DAY })).nudges[0]!.status).toBe("done")
  })

  it("only takes subscriptions to a known push service, and only sends to one", async () => {
    const me = await server.signUp()

    const refused = await server.request("call/subscribePush", {
      token: me.token,
      body: { subscription: { endpoint: "https://internal.example.com/hook", keys: { p256dh: browser.p256dh, auth: browser.auth } }, origin: "https://gym.example.com" },
    })

    expect(refused.status).toBe(400)

    // One that got in some other way is never posted to, and is forgotten.
    server.exec(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, origin, created_at)
      SELECT id, 'https://internal.example.com/hook', '${browser.p256dh}', '${browser.auth}', 'https://gym.example.com', 0
      FROM users WHERE email = '${me.email}'`)

    expect(await me.call("testPush", {})).toEqual({ sent: 0, failed: 1 })
    expect(pushes).toHaveLength(0)
    expect((await me.call("getMinis", { from: DAY, to: DAY })).push.devices).toBe(0)
  })

  it("logs an answer in what the nudge asked for, even after the target changed to another unit", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)
    await tick(TEN_AM)

    const nudge = (await me.call("getMinis", { from: DAY, to: DAY })).nudges[0]!

    await setUp(me, { targets: [{ exercise: "Push-Up", unit: "seconds", daily: 100, chunk: 25, growBy: 0 }, SETTINGS.targets[1]!] })

    const entry = await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 25, nudgeId: nudge.id })

    expect(entry).toMatchObject({ exercise: "Push-Up", unit: "reps" })
    expect((await today(me)).progress[0]).toMatchObject({ unit: "seconds", done: 0 })
  })

  it("sends nothing when the settings change after a run has claimed a nudge", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)

    // A save that lands the moment the run claims the nudge: it turns nudges off.
    server.exec(`CREATE TRIGGER save_mid_claim AFTER UPDATE OF next_nudge_at ON mini_days WHEN NEW.next_nudge_at > ${TEN_AM}
      BEGIN UPDATE users SET mini_revision = mini_revision + 1, mini_settings = json_set(mini_settings, '$.nudges', json('false')); END`)

    expect((await tick(TEN_AM)).sent).toBe(0)
    expect(pushes).toHaveLength(0)
    expect((await me.call("getMinis", { from: DAY, to: DAY })).nudges).toEqual([])
  })

  it("sends nothing when the day is finished just as a nudge is claimed", async () => {
    const me = await server.signUp()

    await setUp(me, { targets: [{ exercise: "Push-Up", unit: "reps", daily: 25, chunk: 25, growBy: 0 }] })
    await subscribe(me)

    // A set that lands the moment the run claims the nudge, finishing the day.
    server.exec(`CREATE TRIGGER finish_mid_claim AFTER UPDATE OF next_nudge_at ON mini_days WHEN NEW.next_nudge_at > ${TEN_AM}
      BEGIN INSERT INTO mini_sets (user_id, day, exercise, exercise_key, unit, amount, created_at)
        VALUES (NEW.user_id, NEW.day, 'Push-Up', 'push-up', 'reps', 25, 0); END`)

    expect((await tick(TEN_AM)).sent).toBe(0)
    expect(pushes).toHaveLength(0)
  })

  it("sends nothing when nudges are turned off once the nudge is recorded but before it goes", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)

    server.exec(`CREATE TRIGGER save_after_record AFTER INSERT ON mini_nudges
      BEGIN UPDATE users SET mini_revision = mini_revision + 1, mini_settings = json_set(mini_settings, '$.nudges', json('false')); END`)

    expect((await tick(TEN_AM)).sent).toBe(0)
    expect(pushes).toHaveLength(0)
    expect((await me.call("getMinis", { from: DAY, to: DAY })).nudges).toEqual([])
  })

  it("plans the day's first nudge on a run that still falls inside the window", async () => {
    const me = await server.signUp()

    // Nudges turned on five minutes before the window closes, at 10:05.
    await setUp(me, { startMinute: 9 * 60, endMinute: 10 * 60 + 5 })
    await subscribe(me)

    // However late the random first delay would put it, the only run left inside the window is this one.
    expect((await server.run(runNudges(TEN_AM, () => 1))).sent).toBe(1)
  })

  it("keeps the gap across midnight", async () => {
    const me = await server.signUp()

    await setUp(me, { startMinute: 0, endMinute: 1440 })
    await subscribe(me)

    const lateNight = Date.parse(`${DAY}T23:55:00Z`)

    clockAt(lateNight)
    expect((await tick(lateNight)).sent).toBe(1)
    expect((await tick(lateNight + 5 * 60_000)).sent).toBe(0)
    expect((await tick(lateNight + 40 * 60_000)).sent).toBe(0)
    expect((await tick(lateNight + 45 * 60_000)).sent).toBe(1)
  })

  it("uses the last cron run before the window closes", async () => {
    const me = await server.signUp()

    await setUp(me, { startMinute: 10 * 60, endMinute: 10 * 60 + 31, gapMinutes: 30 })
    await subscribe(me)

    expect((await tick(TEN_AM)).sent).toBe(1)
    expect((await tick(TEN_AM + 30 * 60_000)).sent).toBe(1)
  })

  it("keeps the address the request came to, not the one the browser sends, and moves a browser to whoever subscribes it", async () => {
    const me = await server.signUp()
    const other = await server.signUp()

    await subscribe(me)

    expect(server.readText("SELECT origin FROM push_subscriptions")).toBe("http://gym.test")
    expect((await me.call("getMinis", { from: DAY, to: DAY })).push.endpoints).toEqual(["https://web.push.apple.com/device-1"])

    await subscribe(other)

    expect((await me.call("getMinis", { from: DAY, to: DAY })).push.endpoints).toEqual([])
    expect((await other.call("getMinis", { from: DAY, to: DAY })).push.endpoints).toEqual(["https://web.push.apple.com/device-1"])
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
      clockAt(Date.parse(`${day}T10:00:00Z`))
      await me.call("logMini", { day, exercise: "Push-Up", amount: 100 })

      if (day !== "2026-11-18") await me.call("logMini", { day, exercise: "Sit-Up", amount: 50 })
    }

    // The first thing logged in the next week looks back at the last one.
    clockAt(Date.parse("2026-11-23T10:00:00Z"))
    await me.call("logMini", { day: "2026-11-23", exercise: "Push-Up", amount: 10 })

    const minis = await me.call("getMinis", { from: "2026-11-23", to: "2026-11-23" })

    expect(minis.settings.targets.map((target) => [target.exercise, target.daily])).toEqual([
      ["Push-Up", 110],
      ["Sit-Up", 50],
    ])
    expect(minis.days[0]!.progress.map((item) => item.target)).toEqual([110, 50])
  })

  it("keep the growth when settings are saved unchanged on the first day of the new week, today included", async () => {
    const me = await server.signUp()
    const week = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]
    const targets = [{ exercise: "Push-Up", unit: "reps", daily: 100, chunk: 25, growBy: 10 }] as const

    await setUp(me, { targets, days: [0, 1, 2, 3, 4] }, week[0])

    for (const day of week) {
      clockAt(Date.parse(`${day}T10:00:00Z`))
      await me.call("logMini", { day, exercise: "Push-Up", amount: 100 })
    }

    // Monday: the screen still shows 100 when the user pauses for the day.
    const saved = await setUp(me, { targets, days: [0, 1, 2, 3, 4], pausedUntil: "2026-11-24" }, "2026-11-23")

    expect(saved.targets[0]!.daily).toBe(110)
    expect((await today(me, "2026-11-23")).progress[0]!.target).toBe(110)
    expect((await me.call("getMinis", { from: "2026-11-23", to: "2026-11-23" })).settings.targets[0]!.daily).toBe(110)
  })

  it("keep the growth through a second save from a form that still shows the old target", async () => {
    const me = await server.signUp()
    const week = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]
    const targets = [{ exercise: "Push-Up", unit: "reps", daily: 100, chunk: 25, growBy: 10 }] as const

    await setUp(me, { targets, days: [0, 1, 2, 3, 4] }, week[0])

    for (const day of week) {
      clockAt(Date.parse(`${day}T10:00:00Z`))
      await me.call("logMini", { day, exercise: "Push-Up", amount: 100 })
    }

    clockAt(Date.parse("2026-11-23T10:00:00Z"))

    const settings = { ...SETTINGS, targets, days: [0, 1, 2, 3, 4] }

    // Both saves come from a form loaded before the week was reviewed, so it starts from 100.
    await me.call("updateMinis", { day: "2026-11-23", settings: { ...settings, pausedUntil: "2026-11-24" }, base: targets })

    const saved = await me.call("updateMinis", { day: "2026-11-23", settings: { ...settings, endMinute: 18 * 60 }, base: targets })

    expect(saved.targets[0]!.daily).toBe(110)
    expect((await today(me, "2026-11-23")).progress[0]!.target).toBe(110)
  })

  it("refuse a day that has not started, so it cannot keep the next week from being reviewed", async () => {
    const me = await server.signUp()
    const week = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]
    const targets = [{ exercise: "Push-Up", unit: "reps", daily: 100, chunk: 25, growBy: 10 }] as const

    await setUp(me, { targets, days: [0, 1, 2, 3, 4] }, week[0])

    for (const day of week) {
      clockAt(Date.parse(`${day}T10:00:00Z`))
      await me.call("logMini", { day, exercise: "Push-Up", amount: 100 })
    }

    // On the Friday, neither the coming Monday nor a week later can be logged.
    for (const day of ["2026-11-23", "2026-11-30"]) {
      expect((await server.request("call/logMini", { token: me.token, body: { day, exercise: "Push-Up", amount: 10 } })).status).toBe(400)
    }

    clockAt(Date.parse("2026-11-23T10:00:00Z"))
    await me.call("logMini", { day: "2026-11-23", exercise: "Push-Up", amount: 10 })

    expect((await me.call("getMinis", { from: "2026-11-23", to: "2026-11-23" })).settings.targets[0]!.daily).toBe(110)
  })

  it("let a target the user changes on that day be what they set", async () => {
    const me = await server.signUp()
    const week = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]
    const targets = [{ exercise: "Push-Up", unit: "reps", daily: 100, chunk: 25, growBy: 10 }] as const

    await setUp(me, { targets, days: [0, 1, 2, 3, 4] }, week[0])

    for (const day of week) {
      clockAt(Date.parse(`${day}T10:00:00Z`))
      await me.call("logMini", { day, exercise: "Push-Up", amount: 100 })
    }

    const saved = await setUp(me, { targets: [{ ...targets[0], daily: 80 }], days: [0, 1, 2, 3, 4] }, "2026-11-23")

    expect(saved.targets[0]!.daily).toBe(80)
  })
})
