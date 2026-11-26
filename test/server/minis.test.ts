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

    await setUp(me)
    await me.call("pauseMinis", { day: DAY, pause: true })
    expect((await tick(TEN_AM)).sent).toBe(0)

    await me.call("pauseMinis", { day: DAY, pause: false })
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
    await me.call("pauseMinis", { day: DAY, pause: true })
    await me.call("pauseMinis", { day: DAY, pause: false })

    expect((await tick(TEN_AM + 5 * 60_000)).sent).toBe(0)
    expect((await tick(TEN_AM + 40 * 60_000)).sent).toBe(0)
    expect((await tick(TEN_AM + 45 * 60_000)).sent).toBe(1)
  })

  it("keeps a pause when a settings form opened before it is saved", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)
    await me.call("pauseMinis", { day: DAY, pause: true })

    // Another device's form, opened before the pause, changes only the gap.
    const saved = await setUp(me, { gapMinutes: 60, pausedUntil: null })

    expect(saved.pausedUntil).toBe(shiftDay(DAY, 1))
    expect((await tick(TEN_AM)).sent).toBe(0)
  })

  it("never gives a removed set's id to the next one, so a stale Remove cannot take a different set", async () => {
    const me = await server.signUp()

    await setUp(me)

    const first = await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 25 })

    // One device takes it back and logs another; the other still shows the first.
    await me.call("deleteMini", { entryId: first.id })

    const replacement = await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 30 })

    expect(replacement.id).not.toBe(first.id)
    expect((await server.request("call/deleteMini", { token: me.token, body: { entryId: first.id } })).status).toBe(404)
    expect((await today(me)).progress[0]!.done).toBe(30)
  })

  it("logs a set all at once or not at all, so trying again logs it once", async () => {
    const me = await server.signUp()

    await setUp(me)

    // Working out the day fails once, after the set went in within the same step.
    server.exec(`CREATE TRIGGER refuse_once BEFORE UPDATE OF met ON mini_days BEGIN SELECT RAISE(ABORT, 'refused'); END`)

    const body = { day: DAY, exercise: "Push-Up", amount: 10, clientKey: "first-try-1" }

    expect((await server.request("call/logMini", { token: me.token, body })).status).toBe(500)
    expect((await today(me)).progress[0]!.done).toBe(0)

    server.exec(`DROP TRIGGER refuse_once`)
    await me.call("logMini", { ...body, clientKey: "second-try-2" })

    expect((await today(me)).progress[0]!.done).toBe(10)
  })

  it("merges targets one by one: a stale form adding one does not bring back one another device took out", async () => {
    const me = await server.signUp()
    const loaded = await setUp(me)

    // Another device takes Sit-Up out.
    await setUp(me, { targets: [SETTINGS.targets[0]!] })

    const pullUps = { exercise: "Pull-Up", unit: "reps", daily: 50, chunk: 10, growBy: 0 } as const
    const saved = await me.call("updateMinis", { day: DAY, settings: { ...loaded, targets: [...loaded.targets, pullUps] }, loaded })

    expect(saved.targets.map((target) => target.exercise)).toEqual(["Push-Up", "Pull-Up"])
  })

  it("merges nudge days one by one, whatever order they were kept in", async () => {
    const me = await server.signUp()
    const loaded = await setUp(me, { days: [4, 0] })

    // Another device makes it Tuesdays only; this one, loaded with Friday and Monday, changes only the gap.
    await setUp(me, { days: [1] })

    const saved = await me.call("updateMinis", { day: DAY, settings: { ...loaded, days: [0, 4], gapMinutes: 60 }, loaded })

    expect(saved).toMatchObject({ days: [1], gapMinutes: 60 })
  })

  it("keeps the saved time zone on an ordinary save, and keeps a pause running when the zone is moved", async () => {
    const me = await server.signUp()

    // Thursday afternoon in Los Angeles, paused for the rest of it; Friday 09:00 in Brisbane.
    const fridayInBrisbane = Date.parse(`${DAY}T23:00:00Z`)

    await setUp(me, { timeZone: "America/Los_Angeles" })
    await subscribe(me)
    clockAt(fridayInBrisbane)
    await me.call("pauseMinis", { day: DAY, pause: true })

    const loaded = (await me.call("getMinis", { from: DAY, to: DAY })).settings

    // A gap change sent from a phone in Brisbane keeps the account in Los Angeles.
    const kept = await me.call("updateMinis", { day: shiftDay(DAY, 1), settings: { ...loaded, gapMinutes: 60, timeZone: "Australia/Brisbane" }, loaded: { ...loaded, timeZone: "Australia/Brisbane" } })

    expect(kept.timeZone).toBe("America/Los_Angeles")

    // Asked to move to Brisbane, the pause still runs through Brisbane's Friday.
    const moved = await me.call("moveMinisZone", { day: shiftDay(DAY, 1), timeZone: "Australia/Brisbane" })

    expect(moved.timeZone).toBe("Australia/Brisbane")
    expect(moved.pausedUntil).toBe(shiftDay(DAY, 2))
    expect((await tick(fridayInBrisbane)).sent).toBe(0)
  })

  it("refuses a set tried again for an account other than the one signed in", async () => {
    const me = await server.signUp()
    const other = await server.signUp()

    await setUp(other)

    // A screen opened for `me`, sending with `other`'s session after a switch of account.
    const sent = await server.request("call/logMini", {
      token: other.token,
      body: { day: DAY, exercise: "Push-Up", amount: 25, clientKey: "stale-tab-1", account: (await me.call("getSession", {})).id },
    })

    expect(sent.status).toBe(400)
    expect((await today(other)).progress[0]!.done).toBe(0)
  })

  it("keeps a set taken back on another device taken back when the first tries it again", async () => {
    const me = await server.signUp()

    await setUp(me)

    const entry = await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 25, clientKey: "lost-answer-1" })

    await me.call("deleteMini", { entryId: entry.id })

    const again = await server.request("call/logMini", {
      token: me.token,
      body: { day: DAY, exercise: "Push-Up", amount: 25, clientKey: "lost-answer-1" },
    })

    expect(again.status).toBe(400)
    expect((await today(me)).progress[0]!.done).toBe(0)
  })

  it("keeps a set in the unit the screen showed, even after the target changed unit on another device", async () => {
    const me = await server.signUp()

    await setUp(me)
    await setUp(me, { targets: [{ ...SETTINGS.targets[0]!, unit: "seconds" }, SETTINGS.targets[1]!] })

    const entry = await me.call("logMini", { day: DAY, exercise: "Push-Up", unit: "reps", amount: 25 })

    expect(entry.unit).toBe("reps")
  })

  it("lets a form set the time zone only while none is saved", async () => {
    const me = await server.signUp()

    // Two forms opened before any time zone was saved; one saves Los Angeles first.
    const fresh = (await me.call("getMinis", { from: DAY, to: DAY })).settings
    const first = { ...SETTINGS, timeZone: "America/Los_Angeles" }

    await me.call("updateMinis", { day: DAY, settings: first, loaded: fresh })

    const second = await me.call("updateMinis", { day: DAY, settings: { ...first, timeZone: "UTC", gapMinutes: 60 }, loaded: fresh })

    expect(second).toMatchObject({ timeZone: "America/Los_Angeles", gapMinutes: 60 })
  })

  it("keeps a pause running to the moment it would have ended, when the time zone moves on the same date", async () => {
    const me = await server.signUp()

    // Thursday in Los Angeles, paused: it ends at midnight there, 08:00 Friday in UTC.
    const thursdayInLosAngeles = Date.parse(`${DAY}T20:00:00Z`)

    await setUp(me, { timeZone: "America/Los_Angeles", startMinute: 0, endMinute: 1440 })
    await subscribe(me)
    clockAt(thursdayInLosAngeles)
    await me.call("pauseMinis", { day: DAY, pause: true })
    await me.call("moveMinisZone", { day: DAY, timeZone: "UTC" })

    // 01:00 on Friday in UTC is still Thursday evening in Los Angeles: still paused.
    const fridayEarly = Date.parse(`${shiftDay(DAY, 1)}T01:00:00Z`)

    clockAt(fridayEarly)
    expect((await tick(fridayEarly)).sent).toBe(0)
  })

  it("merges two devices' edits to different fields of one target", async () => {
    const me = await server.signUp()
    const loaded = await setUp(me)

    // Another device makes push-ups 35 a nudge; this one, loaded before, sets them to grow.
    await setUp(me, { targets: [{ ...SETTINGS.targets[0]!, chunk: 35 }, SETTINGS.targets[1]!] })

    const saved = await me.call("updateMinis", {
      day: DAY,
      settings: { ...loaded, targets: [{ ...loaded.targets[0]!, growBy: 5 }, loaded.targets[1]!] },
      loaded,
    })

    expect(saved.targets[0]).toMatchObject({ chunk: 35, growBy: 5 })
  })

  it("keeps a nudge's set taken back under every key it was answered with", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)
    await tick(TEN_AM)

    // The nudge is answered on the phone and the laptop, each with its own key: one set.
    const nudge = (await me.call("getMinis", { from: DAY, to: DAY })).nudges[0]!
    const entry = await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 25, nudgeId: nudge.id, clientKey: "phone-5678" })

    await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 25, nudgeId: nudge.id, clientKey: "laptop-5678" })
    await me.call("deleteMini", { entryId: entry.id })

    // The laptop, never sure its answer went in, tries it again.
    const again = await server.request("call/logMini", {
      token: me.token,
      body: { day: DAY, exercise: "Push-Up", amount: 25, nudgeId: nudge.id, clientKey: "laptop-5678" },
    })

    expect(again.status).toBe(400)
    expect((await today(me)).progress[0]!.done).toBe(0)
  })

  it("asks again rather than merging amounts into a target whose unit another device changed", async () => {
    const me = await server.signUp()
    const loaded = await setUp(me)

    // Another device makes push-ups a hold in seconds; this one, loaded before, sets 150 reps a day.
    await setUp(me, { targets: [{ ...SETTINGS.targets[0]!, unit: "seconds" }, SETTINGS.targets[1]!] })

    const saved = await server.request("call/updateMinis", {
      token: me.token,
      body: { day: DAY, settings: { ...loaded, targets: [{ ...loaded.targets[0]!, daily: 150 }, loaded.targets[1]!] }, loaded },
    })

    expect(saved.status).toBe(400)
    expect((await me.call("getMinis", { from: DAY, to: DAY })).settings.targets[0]).toMatchObject({ unit: "seconds", daily: SETTINGS.targets[0]!.daily })
  })

  it("asks again rather than saving a target that would ask for more a nudge than in a day", async () => {
    const me = await server.signUp()
    const loaded = await setUp(me)
    const target = loaded.targets[0]!

    // Another device lowers the day to 20; this one, loaded before, raises each nudge to 30.
    await setUp(me, { targets: [{ ...target, daily: 20, chunk: 10 }, SETTINGS.targets[1]!] })

    const saved = await server.request("call/updateMinis", {
      token: me.token,
      body: { day: DAY, settings: { ...loaded, targets: [{ ...target, chunk: 30 }, loaded.targets[1]!] }, loaded },
    })

    expect(saved.status).toBe(400)
    expect((await me.call("getMinis", { from: DAY, to: DAY })).settings.targets[0]).toMatchObject({ daily: 20, chunk: 10 })
  })

  it("keeps a pause running when its last day starts late after a daylight saving change", async () => {
    const me = await server.signUp()

    // Cairo moves its clocks on at midnight into Friday 24 April 2026: that day begins at 01:00,
    // 22:00 Thursday in UTC. Paused on Thursday, the pause ends then.
    const thursday = "2026-04-23"
    const thursdayInCairo = Date.parse(`${thursday}T12:00:00Z`)

    await setUp(me, { timeZone: "Africa/Cairo", startMinute: 0, endMinute: 1440 }, thursday)
    await subscribe(me)
    clockAt(thursdayInCairo)
    await me.call("pauseMinis", { day: thursday, pause: true })
    await me.call("moveMinisZone", { day: thursday, timeZone: "Europe/Moscow" })

    // 21:30 in UTC is 00:30 Friday in Moscow but still Thursday in Cairo: still paused, so nothing goes.
    const justBefore = Date.parse(`${thursday}T21:30:00Z`)

    clockAt(justBefore)
    expect((await tick(justBefore)).sent).toBe(0)
    expect((await me.call("getMinis", { from: thursday, to: thursday })).settings.pausedUntil).toBe(shiftDay(thursday, 2))
  })

  it("keeps a pause no longer than the moment it would have ended, moving a day back across the date line", async () => {
    const me = await server.signUp()

    // Thursday in Kiritimati (UTC+14), paused: it ends at midnight there, 10:00 Thursday in UTC,
    // which is still Wednesday in Pago Pago (UTC-11). Its form said Friday, a date that meant less there.
    const thursdayInKiritimati = Date.parse(`${shiftDay(DAY, -1)}T12:00:00Z`)

    await setUp(me, { timeZone: "Pacific/Kiritimati", startMinute: 0, endMinute: 1440 })
    clockAt(thursdayInKiritimati)
    await me.call("pauseMinis", { day: DAY, pause: true })

    const moved = await me.call("moveMinisZone", { day: DAY, timeZone: "Pacific/Pago_Pago" })

    // Through Wednesday there, and today (Wednesday) at least: it ends as Thursday begins.
    expect(moved.pausedUntil).toBe(DAY)
  })

  it("does not bring back a pause that is over, moving west to a zone still on its date", async () => {
    const me = await server.signUp()

    await setUp(me, { timeZone: "Pacific/Kiritimati", startMinute: 0, endMinute: 1440 })

    // Paused on Wednesday 25th in Kiritimati, so until Thursday 26th there.
    clockAt(Date.parse(`${shiftDay(DAY, -2)}T12:00:00Z`))
    await me.call("pauseMinis", { day: shiftDay(DAY, -1), pause: true })

    // Thursday 26th there now, the pause over; still Wednesday 25th in Pago Pago.
    clockAt(Date.parse(`${shiftDay(DAY, -1)}T12:00:00Z`))

    const moved = await me.call("moveMinisZone", { day: shiftDay(DAY, -1), timeZone: "Pacific/Pago_Pago" })

    expect(moved.pausedUntil).toBeNull()
  })

  it("leaves a nudge open when a set for it is taken back while it is being logged", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)
    await tick(TEN_AM)

    const nudge = (await me.call("getMinis", { from: DAY, to: DAY })).nudges[0]!

    // Another device takes the set back the moment it goes in, before the nudge is marked answered.
    server.exec(`CREATE TRIGGER take_back AFTER INSERT ON mini_set_keys BEGIN
      DELETE FROM mini_sets WHERE id = NEW.set_id;
      INSERT INTO mini_removed_keys (user_id, client_key) VALUES (NEW.user_id, NEW.client_key);
    END`)

    const sent = await server.request("call/logMini", {
      token: me.token,
      body: { day: DAY, exercise: "Push-Up", amount: 25, nudgeId: nudge.id, clientKey: "racing-1" },
    })

    server.exec(`DROP TRIGGER take_back`)

    expect(sent.status).toBe(400)
    expect((await me.call("getMinis", { from: DAY, to: DAY })).nudges[0]!.status).toBe("sent")

    await me.call("skipNudge", { nudgeId: nudge.id })
    expect((await me.call("getMinis", { from: DAY, to: DAY })).nudges[0]!.status).toBe("skipped")
  })

  it("lets a nudge left answered with no set be skipped", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)
    await tick(TEN_AM)

    const nudge = (await me.call("getMinis", { from: DAY, to: DAY })).nudges[0]!

    // As an earlier version could leave it.
    server.exec(`UPDATE mini_nudges SET status = 'done' WHERE id = ${nudge.id}`)
    await me.call("skipNudge", { nudgeId: nudge.id })

    expect((await me.call("getMinis", { from: DAY, to: DAY })).nudges[0]!.status).toBe("skipped")
  })

  it("asks again when the nudge size a stale form sets is more than the day another device set", async () => {
    const me = await server.signUp()
    const loaded = await setUp(me)
    const target = loaded.targets[0]!

    // Another device lowers the day to 20; an older screen, which sends only the targets it
    // started from, raises each nudge to 30. The day it keeps is the 20.
    await setUp(me, { targets: [{ ...target, daily: 20, chunk: 10 }, SETTINGS.targets[1]!] })

    const saved = await server.request("call/updateMinis", {
      token: me.token,
      body: { day: DAY, settings: { ...loaded, targets: [{ ...target, chunk: 30 }, loaded.targets[1]!] }, base: loaded.targets },
    })

    expect(saved.status).toBe(400)
    expect((await me.call("getMinis", { from: DAY, to: DAY })).settings.targets[0]).toMatchObject({ daily: 20, chunk: 10 })
  })

  it("asks again when another device added the same exercise differently meanwhile", async () => {
    const me = await server.signUp()
    const loaded = await setUp(me, { targets: [SETTINGS.targets[1]!] })
    const pushUps = { exercise: "Push-Up", unit: "reps", daily: 100, chunk: 25, growBy: 0 } as const

    await me.call("updateMinis", { day: DAY, settings: { ...loaded, targets: [...loaded.targets, pushUps] }, loaded })

    const second = await server.request("call/updateMinis", {
      token: me.token,
      body: { day: DAY, settings: { ...loaded, targets: [...loaded.targets, { ...pushUps, unit: "seconds", daily: 120, chunk: 30 }] }, loaded },
    })

    expect(second.status).toBe(400)

    // The same addition from both is no conflict.
    const same = await me.call("updateMinis", { day: DAY, settings: { ...loaded, targets: [...loaded.targets, pushUps] }, loaded })

    expect(same.targets.map((target) => target.exercise)).toEqual([SETTINGS.targets[1]!.exercise, "Push-Up"])
  })

  it("keeps nudges off when a form opened before they were turned off is saved", async () => {
    const me = await server.signUp()
    const loaded = await setUp(me)

    await subscribe(me)
    // Another device turns nudges off.
    await setUp(me, { nudges: false })

    // This one, loaded while they were on, changes only the gap.
    const saved = await me.call("updateMinis", { day: DAY, settings: { ...loaded, gapMinutes: 60 }, loaded })

    expect(saved).toMatchObject({ nudges: false, gapMinutes: 60 })
    expect((await tick(TEN_AM)).sent).toBe(0)
  })

  it("pauses for the account's own today, whatever day the phone that asks is on", async () => {
    const me = await server.signUp()

    // Brisbane's Friday 09:00 is Thursday afternoon in Los Angeles, where the phone is.
    const fridayInBrisbane = Date.parse(`${DAY}T23:00:00Z`)

    await setUp(me, { timeZone: "Australia/Brisbane" })
    await subscribe(me)
    clockAt(fridayInBrisbane)
    await me.call("pauseMinis", { day: DAY, pause: true })

    expect((await me.call("getMinis", { from: DAY, to: DAY })).settings.pausedUntil).toBe(shiftDay(DAY, 2))
    expect((await tick(fridayInBrisbane)).sent).toBe(0)
  })

  it("takes a set back all at once or not at all", async () => {
    const me = await server.signUp()

    await setUp(me, { targets: [{ exercise: "Push-Up", unit: "reps", daily: 25, chunk: 25, growBy: 0 }] })

    const entry = await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 25 })

    // Working out the day again fails once, after the set itself was deleted in the same step.
    server.exec(`CREATE TRIGGER refuse_once BEFORE UPDATE OF met ON mini_days BEGIN SELECT RAISE(ABORT, 'refused'); END`)
    expect((await server.request("call/deleteMini", { token: me.token, body: { entryId: entry.id } })).status).toBe(500)
    expect((await today(me)).progress[0]!.done).toBe(25)

    server.exec(`DROP TRIGGER refuse_once`)
    await me.call("deleteMini", { entryId: entry.id })

    const minis = await me.call("getMinis", { from: DAY, to: DAY })

    expect(minis.days[0]!.progress[0]!.done).toBe(0)
    expect(minis.metDays).toEqual([])
  })

  it("lets only the pause change when pausing from a screen that shows older settings", async () => {
    const me = await server.signUp()

    await setUp(me)
    // Another device turns nudges off; this one still shows them on, and pauses for the day.
    await setUp(me, { nudges: false })
    await me.call("pauseMinis", { day: DAY, pause: true })

    const { settings } = await me.call("getMinis", { from: DAY, to: DAY })

    expect(settings).toMatchObject({ nudges: false, pausedUntil: shiftDay(DAY, 1) })
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

  it("sends nothing when nudges are turned off while the push is being prepared", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)

    // A save that lands while the push is signed, after every check made before it.
    const sign = crypto.subtle.sign.bind(crypto.subtle)

    vi.spyOn(crypto.subtle, "sign").mockImplementation((...args: Parameters<typeof crypto.subtle.sign>) => {
      server.exec(`UPDATE users SET mini_revision = mini_revision + 1, mini_settings = json_set(mini_settings, '$.nudges', json('false'))`)

      return sign(...args)
    })

    expect((await tick(TEN_AM)).sent).toBe(0)
    expect(pushes).toHaveLength(0)
    expect((await me.call("getMinis", { from: DAY, to: DAY })).nudges).toEqual([])
    vi.restoreAllMocks()
  })

  it("posts to no browser that was signed in to another account while the push was being prepared", async () => {
    const me = await server.signUp()
    const other = await server.signUp()

    await setUp(me)
    await subscribe(me)

    // The browser is handed to another account while the push for this one is signed.
    const sign = crypto.subtle.sign.bind(crypto.subtle)

    vi.spyOn(crypto.subtle, "sign").mockImplementation((...args: Parameters<typeof crypto.subtle.sign>) => {
      server.exec(`UPDATE push_subscriptions SET user_id = (SELECT id FROM users WHERE email = '${other.email}')`)

      return sign(...args)
    })

    expect((await tick(TEN_AM)).sent).toBe(0)
    expect(pushes).toHaveLength(0)
    vi.restoreAllMocks()
  })

  it("checks again before each browser, so one turned off after the first went gets nothing", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)
    await me.call("subscribePush", {
      subscription: { endpoint: "https://web.push.apple.com/device-2", keys: { p256dh: browser.p256dh, auth: browser.auth } },
      origin: "https://gym.example.com",
    })

    // Nudges are turned off as soon as the first browser has been posted to.
    vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
      pushes.push({ url: input, headers: new Headers(init.headers), body: new Uint8Array(await new Response(init.body).arrayBuffer()) })
      server.exec(`UPDATE users SET mini_revision = mini_revision + 1, mini_settings = json_set(mini_settings, '$.nudges', json('false'))`)

      return new Response(null, { status: 201 })
    })

    await server.run(runNudges(TEN_AM, () => 0))

    expect(pushes).toHaveLength(1)
    // It reached one browser, so it stays on record to be answered.
    expect((await me.call("getMinis", { from: DAY, to: DAY })).nudges).toHaveLength(1)
  })

  it("stops the browsers not yet posted to once a workout begins", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)
    await me.call("subscribePush", {
      subscription: { endpoint: "https://web.push.apple.com/device-2", keys: { p256dh: browser.p256dh, auth: browser.auth } },
      origin: "https://gym.example.com",
    })

    // A workout is started as soon as the first browser has been posted to.
    vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
      pushes.push({ url: input, headers: new Headers(init.headers), body: new Uint8Array(await new Response(init.body).arrayBuffer()) })
      server.exec(`INSERT INTO workouts (user_id, name, started_at) SELECT id, 'Push day', ${TEN_AM} FROM users WHERE email = '${me.email}'`)

      return new Response(null, { status: 201 })
    })

    await server.run(runNudges(TEN_AM, () => 0))

    expect(pushes).toHaveLength(1)
  })

  it("sends nothing for a day that ended before a move west made it today again", async () => {
    const me = await server.signUp()

    await setUp(me, { timeZone: "Australia/Brisbane" })
    await subscribe(me)

    // Friday 09:00 in Brisbane is still Thursday 15:00 in Los Angeles, inside the window there.
    const fridayInBrisbane = Date.parse(`${DAY}T23:00:00Z`)

    clockAt(fridayInBrisbane)
    await me.call("moveMinisZone", { day: shiftDay(DAY, 1), timeZone: "America/Los_Angeles" })

    expect((await tick(fridayInBrisbane)).sent).toBe(0)
    expect(pushes).toHaveLength(0)
  })

  it("asks for nothing that was finished after the run chose it", async () => {
    const me = await server.signUp()

    await setUp(me)
    await subscribe(me)

    // Push-ups (the run's choice) are finished the moment it claims the nudge; sit-ups are still to do.
    server.exec(`CREATE TRIGGER finish_choice AFTER UPDATE OF next_nudge_at ON mini_days WHEN NEW.next_nudge_at > ${TEN_AM}
      BEGIN INSERT INTO mini_sets (user_id, day, exercise, exercise_key, unit, amount, created_at)
        VALUES (NEW.user_id, NEW.day, 'Push-Up', 'push-up', 'reps', 100, 0); END`)

    expect((await tick(TEN_AM)).sent).toBe(0)
    expect(pushes).toHaveLength(0)
  })

  it("sends the first nudge of a week whose review just grew a target", async () => {
    const me = await server.signUp()
    const week = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]
    const targets = [{ exercise: "Push-Up", unit: "reps", daily: 100, chunk: 25, growBy: 10 }] as const

    await setUp(me, { targets, days: [0, 1, 2, 3, 4] }, week[0])

    for (const day of week) {
      clockAt(Date.parse(`${day}T10:00:00Z`))
      await me.call("logMini", { day, exercise: "Push-Up", amount: 100 })
    }

    await subscribe(me)

    // Monday's first run reviews the week itself, which changes the settings it read.
    const monday = Date.parse("2026-11-23T10:00:00Z")

    clockAt(monday)
    expect((await tick(monday)).sent).toBe(1)
    expect((await message(0)).body).toBe("0 of 110 done today. Tap to log it.")
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

describe("the day's targets", () => {
  it("go in with the settings as one: a save whose day targets cannot be written saves nothing", async () => {
    const me = await server.signUp()

    await setUp(me)

    // Writing the day's new targets fails, after the settings themselves were written in the same save.
    server.exec(`CREATE TRIGGER refuse_targets BEFORE UPDATE OF targets ON mini_days WHEN NEW.targets LIKE '%"daily":125%'
      BEGIN SELECT RAISE(ABORT, 'refused'); END`)

    const body = { day: DAY, settings: { ...SETTINGS, targets: [{ ...SETTINGS.targets[0]!, daily: 125 }, SETTINGS.targets[1]!] } }

    expect((await server.request("call/updateMinis", { token: me.token, body })).status).toBe(500)

    const minis = await me.call("getMinis", { from: DAY, to: DAY })

    expect(minis.settings.targets[0]!.daily).toBe(100)
    expect(minis.days[0]!.progress[0]!.target).toBe(100)
  })

  it("take a save's targets on every day still open, and keep both agreeing on whether each is done", async () => {
    const me = await server.signUp()
    const tomorrow = shiftDay(DAY, 1)

    await setUp(me)
    // A day logged ahead, done against today's targets, then a bigger target saved today.
    await me.call("logMini", { day: tomorrow, exercise: "Push-Up", amount: 100 })
    await me.call("logMini", { day: tomorrow, exercise: "Sit-Up", amount: 50 })
    await setUp(me, { targets: [{ ...SETTINGS.targets[0]!, daily: 125 }, SETTINGS.targets[1]!] })

    const minis = await me.call("getMinis", { from: tomorrow, to: tomorrow })

    expect(minis.days[0]).toMatchObject({ met: false, progress: [{ target: 125, done: 100 }, { target: 50, done: 50 }] })
    expect(minis.metDays).not.toContain(tomorrow)
  })

  it("keep a day that has ended closed when the time zone moves west", async () => {
    const me = await server.signUp()

    // Thursday done in Brisbane; by Friday morning there, it is still Thursday in Los Angeles.
    await setUp(me, { timeZone: "Australia/Brisbane" })
    await me.call("logMini", { day: DAY, exercise: "Push-Up", amount: 100 })
    await me.call("logMini", { day: DAY, exercise: "Sit-Up", amount: 50 })

    clockAt(Date.parse(`${DAY}T23:00:00Z`))
    await me.call("updateMinis", {
      day: shiftDay(DAY, 1),
      settings: { ...SETTINGS, timeZone: "America/Los_Angeles", targets: [{ ...SETTINGS.targets[0]!, daily: 125 }, SETTINGS.targets[1]!] },
    })

    const minis = await me.call("getMinis", { from: DAY, to: DAY })

    expect(minis.days[0]).toMatchObject({ met: true, progress: [{ target: 100 }, { target: 50 }] })
    expect(minis.metDays).toEqual([DAY])
  })

  it("follow the settings until the day is over, for a day logged ahead of an account with no time zone yet", async () => {
    const me = await server.signUp()
    const tomorrow = shiftDay(DAY, 1)

    // Before any settings: a set logged for tomorrow keeps a day with no targets.
    await me.call("logMini", { day: tomorrow, exercise: "Push-Up", amount: 10 })
    await setUp(me)

    clockAt(Date.parse(`${tomorrow}T10:00:00Z`))
    await me.call("logMini", { day: tomorrow, exercise: "Push-Up", amount: 15 })

    expect((await today(me, tomorrow)).progress[0]).toMatchObject({ target: 100, done: 25 })
  })

  it("take a set for the day after the account's today, from a phone further east", async () => {
    const me = await server.signUp()

    // Saved in Los Angeles, where it is still Thursday morning when Friday has begun in Brisbane.
    clockAt(Date.parse(`${DAY}T18:30:00Z`))
    await me.call("updateMinis", { day: DAY, settings: { ...SETTINGS, timeZone: "America/Los_Angeles" } })

    const friday = shiftDay(DAY, 1)

    expect((await me.call("logMini", { day: friday, exercise: "Push-Up", amount: 20 })).day).toBe(friday)
    expect((await server.request("call/logMini", { token: me.token, body: { day: shiftDay(DAY, 2), exercise: "Push-Up", amount: 20 } })).status).toBe(400)
  })

  it("match names kept before their keys were, once their day is touched", async () => {
    const me = await server.signUp()

    await setUp(me, { targets: [{ exercise: "Élévation", unit: "reps", daily: 20, chunk: 10, growBy: 0 }] })
    await me.call("logMini", { day: DAY, exercise: "Élévation", amount: 10 })

    // As 0012 left them: the target with no key, the set keyed by SQLite's ASCII-only lower().
    server.exec(`UPDATE mini_days SET targets = json_remove(targets, '$[0].key')`)
    server.exec(`UPDATE mini_sets SET exercise_key = lower(trim(exercise))`)

    await me.call("logMini", { day: DAY, exercise: "Élévation", amount: 10 })

    expect((await me.call("getMinis", { from: DAY, to: DAY })).metDays).toEqual([DAY])
  })

  it("keep the streak for names kept before their keys were when settings are saved", async () => {
    const me = await server.signUp()

    await setUp(me, { targets: [{ exercise: "Élévation", unit: "reps", daily: 20, chunk: 10, growBy: 0 }] })
    await me.call("logMini", { day: DAY, exercise: "Élévation", amount: 20 })

    server.exec(`UPDATE mini_days SET targets = json_remove(targets, '$[0].key')`)
    server.exec(`UPDATE mini_sets SET exercise_key = lower(trim(exercise))`)

    await setUp(me, { targets: [{ exercise: "Élévation", unit: "reps", daily: 20, chunk: 10, growBy: 0 }], gapMinutes: 60 })

    expect((await me.call("getMinis", { from: DAY, to: DAY })).metDays).toEqual([DAY])
  })

  it("refuse two targets that are one exercise written two ways", async () => {
    const me = await server.signUp()

    const twice = [
      { exercise: "Élévation".normalize("NFC"), unit: "reps", daily: 20, chunk: 10, growBy: 0 },
      { exercise: "Élévation".normalize("NFD"), unit: "reps", daily: 20, chunk: 10, growBy: 0 },
    ]

    expect((await server.request("call/updateMinis", { token: me.token, body: { day: DAY, settings: { ...SETTINGS, targets: twice } } })).status).toBe(400)
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

  it("review a week that ended only in the new time zone, by the settings that held during it", async () => {
    const me = await server.signUp()
    const targets = [{ exercise: "Push-Up", unit: "reps", daily: 100, chunk: 25, growBy: 10 }] as const

    // Sundays only, in Los Angeles; Sunday 22 November is done there.
    await setUp(me, { targets, days: [6], timeZone: "America/Los_Angeles" }, "2026-11-16")
    clockAt(Date.parse("2026-11-22T20:00:00Z"))
    await me.call("logMini", { day: "2026-11-22", exercise: "Push-Up", amount: 100 })

    // Off the plane in Brisbane, where it is Monday, while Los Angeles is still on Sunday: Mondays are added.
    clockAt(Date.parse("2026-11-23T06:00:00Z"))
    await me.call("moveMinisZone", { day: "2026-11-23", timeZone: "Australia/Brisbane" })

    const saved = await me.call("updateMinis", {
      day: "2026-11-23",
      settings: { ...SETTINGS, targets, days: [0, 6], timeZone: "Australia/Brisbane" },
      base: targets,
    })

    expect(saved.targets[0]!.daily).toBe(110)
  })

  it("work a save out for one moment, even when it lands just after midnight", async () => {
    const me = await server.signUp()
    const targets = [{ exercise: "Push-Up", unit: "reps", daily: 100, chunk: 25, growBy: 0 }] as const

    await setUp(me, { targets }, "2026-11-22")
    await me.call("logMini", { day: "2026-11-22", exercise: "Push-Up", amount: 50 })

    // The save starts at 23:59:59 on Sunday; its write lands at 00:00:01 on Monday.
    clockAt(Date.parse("2026-11-22T23:59:59Z"))

    const randomUUID = crypto.randomUUID.bind(crypto)

    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      clockAt(Date.parse("2026-11-23T00:00:01Z"))

      return randomUUID()
    })

    await me.call("updateMinis", { day: "2026-11-22", settings: { ...SETTINGS, targets: [{ ...targets[0], daily: 50 }] }, base: targets })
    vi.restoreAllMocks()

    // Made on Sunday, the save is Sunday's: Sunday takes its target, and is done against it.
    const sunday = await me.call("getMinis", { from: "2026-11-22", to: "2026-11-22" })

    expect(sunday.days[0]).toMatchObject({ met: true, progress: [{ target: 50, done: 50 }] })
    expect(sunday.metDays).toEqual(["2026-11-22"])
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
