import { describe, expect, it } from "vitest"
import {
  afterAsk,
  chooseNudge,
  CRON_MINUTES,
  dayProgress,
  DEFAULT_MINI_SETTINGS,
  describeAmount,
  firstNudgeDelay,
  formatMinute,
  grownTargets,
  isMet,
  isPushEndpoint,
  localTime,
  middayOf,
  miniFormFor,
  miniSessions,
  mondayOf,
  nextNudgeDelay,
  nudgeMessage,
  nudgesNeeded,
  nudgesOpen,
  parseMinute,
  readMiniForm,
  suggestTarget,
  weekBefore,
  weekdayOf,
  type MiniSettings,
  type MiniTarget,
} from "~/domain/minis"

const PUSH_UPS: MiniTarget = { exercise: "Push-Up", unit: "reps", daily: 100, chunk: 25, growBy: 0 }
const PULL_UPS: MiniTarget = { exercise: "Pull-Up", unit: "reps", daily: 50, chunk: 10, growBy: 0 }
const PLANK: MiniTarget = { exercise: "Plank", unit: "seconds", daily: 180, chunk: 60, growBy: 0 }

const SETTINGS: MiniSettings = { ...DEFAULT_MINI_SETTINGS, targets: [PUSH_UPS, PULL_UPS], nudges: true, timeZone: "Australia/Brisbane" }

/** A random that hands out the given numbers in turn. */
const sequence = (...values: ReadonlyArray<number>) => {
  let index = 0

  return () => values[index++ % values.length]!
}

describe("time in the user's zone", () => {
  it("reads the day, weekday and minute where the user is", () => {
    // 23:30 UTC on Wednesday is 9:30 on Thursday in Brisbane (UTC+10, no daylight saving).
    expect(localTime("Australia/Brisbane", Date.parse("2026-11-25T23:30:00Z"))).toEqual({ day: "2026-11-26", weekday: 3, minute: 9 * 60 + 30 })
    expect(localTime("UTC", Date.parse("2026-11-29T00:05:00Z"))).toEqual({ day: "2026-11-29", weekday: 6, minute: 5 })
  })

  it("names weekdays and weeks from Monday", () => {
    expect(weekdayOf("2026-11-23")).toBe(0)
    expect(weekdayOf("2026-11-29")).toBe(6)
    expect(mondayOf("2026-11-29")).toBe("2026-11-23")
    expect(weekBefore("2026-11-26")).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"])
  })

  it("puts a day from the server at midday on this device, so it stays on its own calendar day", () => {
    const midday = new Date(middayOf("2026-11-26"))

    expect([midday.getFullYear(), midday.getMonth(), midday.getDate(), midday.getHours()]).toEqual([2026, 10, 26, 12])
    expect(miniSessions(["2026-11-26"])).toEqual([{ startedAt: middayOf("2026-11-26"), kind: "minis", volume: 0 }])
  })

  it("writes and reads minutes of the day", () => {
    expect(formatMinute(9 * 60)).toBe("9:00")
    expect(formatMinute(17 * 60 + 30)).toBe("17:30")
    expect(parseMinute(" 7:05 ")).toBe(7 * 60 + 5)
    expect(parseMinute("25:00")).toBeNull()
    expect(parseMinute("9am")).toBeNull()
  })

  it("keeps a window that ends at midnight as 24:00, so saving it again works", () => {
    const form = miniFormFor({ ...SETTINGS, endMinute: 1440 })

    expect(form.end).toBe("24:00")
    expect(readMiniForm(form, "UTC", null)).toMatchObject({ ok: true, settings: { endMinute: 1440 } })
  })
})

describe("progress", () => {
  it("adds up what was logged for each target, whatever the case of the name", () => {
    const progress = dayProgress(
      [PUSH_UPS, PLANK],
      [
        { exercise: "Push-Up", unit: "reps", amount: 40 },
        { exercise: "push-up", unit: "reps", amount: 60 },
        { exercise: "Plank", unit: "seconds", amount: 90 },
        { exercise: "Squat", unit: "reps", amount: 20 },
      ],
    )

    expect(progress).toEqual([
      { exercise: "Push-Up", unit: "reps", target: 100, done: 100 },
      { exercise: "Plank", unit: "seconds", target: 180, done: 90 },
    ])
    expect(isMet(progress)).toBe(false)
    expect(isMet(progress.slice(0, 1))).toBe(true)
    expect(isMet([])).toBe(false)
  })
})

describe("when nudges may go", () => {
  const at = (minute: number, weekday = 2, day = "2026-11-25") => ({ day, weekday, minute })

  it("only on a nudge day, inside the window, with nudges on and targets set", () => {
    expect(nudgesOpen(SETTINGS, at(9 * 60))).toBe(true)
    expect(nudgesOpen(SETTINGS, at(9 * 60 - 1))).toBe(false)
    expect(nudgesOpen(SETTINGS, at(17 * 60 + 30))).toBe(false)
    expect(nudgesOpen(SETTINGS, at(12 * 60, 5))).toBe(false)
    expect(nudgesOpen({ ...SETTINGS, nudges: false }, at(12 * 60))).toBe(false)
    expect(nudgesOpen({ ...SETTINGS, targets: [] }, at(12 * 60))).toBe(false)
  })

  it("not before the day a pause ends", () => {
    const paused = { ...SETTINGS, pausedUntil: "2026-11-26" }

    expect(nudgesOpen(paused, at(12 * 60, 2, "2026-11-25"))).toBe(false)
    expect(nudgesOpen(paused, at(12 * 60, 3, "2026-11-26"))).toBe(true)
  })
})

describe("what a nudge asks for", () => {
  const fresh = dayProgress([PUSH_UPS, PULL_UPS], [])

  it("asks for the usual amount when there is time for it", () => {
    expect(nudgesNeeded([PUSH_UPS, PULL_UPS], fresh)).toBe(9)
    expect(chooseNudge([PUSH_UPS, PULL_UPS], fresh, 8 * 60, 45, null, () => 0)).toEqual({
      exercise: "Push-Up",
      unit: "reps",
      amount: 25,
      left: 100,
      target: 100,
    })
  })

  it("moves to another exercise than the last, when there is one", () => {
    expect(chooseNudge([PUSH_UPS, PULL_UPS], fresh, 8 * 60, 45, "Push-Up", () => 0)?.exercise).toBe("Pull-Up")
    expect(chooseNudge([PUSH_UPS], dayProgress([PUSH_UPS], []), 8 * 60, 45, "Push-Up", () => 0)?.exercise).toBe("Push-Up")
  })

  it("picks between exercises by how much of each is left", () => {
    // Push-ups want 4 nudges and pull-ups 5, so a roll past 4 of 9 lands on pull-ups.
    expect(chooseNudge([PUSH_UPS, PULL_UPS], fresh, 8 * 60, 45, null, () => 0.4)?.exercise).toBe("Push-Up")
    expect(chooseNudge([PUSH_UPS, PULL_UPS], fresh, 8 * 60, 45, null, () => 0.5)?.exercise).toBe("Pull-Up")
  })

  it("never asks for more than is left, or for a target already done", () => {
    const nearly = dayProgress([PUSH_UPS, PULL_UPS], [
      { exercise: "Push-Up", unit: "reps", amount: 92 },
      { exercise: "Pull-Up", unit: "reps", amount: 50 },
    ])

    expect(chooseNudge([PUSH_UPS, PULL_UPS], nearly, 8 * 60, 45, null, () => 0.9)).toMatchObject({ exercise: "Push-Up", amount: 8 })
    expect(chooseNudge([PUSH_UPS], dayProgress([PUSH_UPS], [{ exercise: "Push-Up", unit: "reps", amount: 100 }]), 600, 45, null, () => 0)).toBeNull()
  })

  it("asks for more at a time when the day is running short, up to twice the usual", () => {
    // An hour and a half left with a 45 minute gap: three nudges for four nudges' worth.
    expect(chooseNudge([PUSH_UPS], dayProgress([PUSH_UPS], []), 90, 45, null, () => 0)?.amount).toBe(35)
    // No time at all: one last nudge, capped at twice the usual.
    expect(chooseNudge([PUSH_UPS], dayProgress([PUSH_UPS], []), 0, 45, null, () => 0)?.amount).toBe(50)
  })

  it("keeps to twice the usual after rounding to a friendly number", () => {
    const odd = { ...PUSH_UPS, chunk: 11 }

    expect(chooseNudge([odd], dayProgress([odd], []), 0, 45, null, () => 0)?.amount).toBe(22)
  })

  it("plans what is left as if the nudge was done", () => {
    const ask = chooseNudge([PUSH_UPS], dayProgress([PUSH_UPS], []), 480, 45, null, () => 0)!

    expect(nudgesNeeded([PUSH_UPS], afterAsk(dayProgress([PUSH_UPS], []), ask))).toBe(3)
  })
})

describe("when the next nudge comes", () => {
  it("spreads what is needed over the time left, with some chance either way", () => {
    // Three more in 480 minutes is one about every 137: from 70% to 130% of that.
    expect(nextNudgeDelay(3, 480, 45, () => 0)).toBe(96)
    expect(nextNudgeDelay(3, 480, 45, () => 1)).toBe(178)
  })

  it("never comes sooner than the gap, and stops when nothing is needed or no gap fits", () => {
    expect(nextNudgeDelay(20, 480, 45, () => 0)).toBe(45)
    expect(nextNudgeDelay(0, 480, 45, () => 0.5)).toBeNull()
    expect(nextNudgeDelay(2, 30, 45, () => 0.5)).toBeNull()
  })

  it("plans a nudge only where a cron run will still find the window open, and never inside the gap", () => {
    // 16 minutes left and a 16 minute gap: the next nudge would land as the window shuts.
    expect(nextNudgeDelay(3, 16, 16, () => 0)).toBeNull()
    expect(nextNudgeDelay(3, 21, 16, () => 0)).toBe(16)
    expect(nextNudgeDelay(1, 30, 20, () => 1)).toBe(30 - CRON_MINUTES)
  })

  it("starts the day soon after the window opens, but not on the dot", () => {
    expect(firstNudgeDelay(9, 510, () => 0)).toBe(0)
    expect(firstNudgeDelay(9, 510, () => 1)).toBe(51)
    expect(firstNudgeDelay(1, 510, () => 1)).toBe(90)
  })
})

describe("push services", () => {
  it("takes the browsers' push services and nothing else", () => {
    expect(isPushEndpoint("https://web.push.apple.com/QGuQyavXutnMH...")).toBe(true)
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true)
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true)
    expect(isPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=abc")).toBe(true)
    expect(isPushEndpoint("http://web.push.apple.com/abc")).toBe(false)
    expect(isPushEndpoint("https://web.push.apple.com.evil.example/abc")).toBe(false)
    expect(isPushEndpoint("https://evilpush.apple.com.example/abc")).toBe(false)
    expect(isPushEndpoint("https://web.push.apple.com:8443/abc")).toBe(false)
    expect(isPushEndpoint("https://user@web.push.apple.com/abc")).toBe(false)
    expect(isPushEndpoint("https://169.254.169.254/latest")).toBe(false)
    expect(isPushEndpoint("not a url")).toBe(false)
  })
})

describe("what a nudge says", () => {
  it("names the amount as people say it", () => {
    expect(describeAmount("Push-Up", "reps", 25)).toBe("25 push-ups")
    expect(describeAmount("Pull-Up", "reps", 1)).toBe("1 pull-up")
    expect(describeAmount("Dumbbell Lunges", "reps", 20)).toBe("20 dumbbell lunges")
    expect(describeAmount("Plank", "seconds", 45)).toBe("45 s plank")
    expect(describeAmount("Plank", "seconds", 90)).toBe("1:30 min plank")
  })

  it("asks a question and says how the day stands", () => {
    const ask = { exercise: "Push-Up", unit: "reps", amount: 25, left: 75, target: 100 } as const

    expect(nudgeMessage(ask, () => 0)).toEqual({ title: "Got time for 25 push-ups?", body: "25 of 100 done today. Tap to log it." })
    expect(nudgeMessage({ ...ask, left: 25 }, sequence(0.3)).body).toBe("That finishes today's 100. Tap to log it.")
    expect(nudgeMessage(ask, () => 0.3).title).toBe("Quick one: 25 push-ups")
  })
})

describe("growing targets", () => {
  const grower = { ...PUSH_UPS, growBy: 10 }
  const week = weekBefore("2026-11-23")
  const met = (day: string) => ({ day, progress: [{ exercise: "Push-Up", unit: "reps" as const, target: 100, done: 100 }] })
  const missed = (day: string) => ({ day, progress: [{ exercise: "Push-Up", unit: "reps" as const, target: 100, done: 75 }] })

  it("raises a target met on every nudge day of the week, whatever happened on the others", () => {
    const days = week.map((day, index) => (index < 5 ? met(day) : missed(day)))

    expect(grownTargets([grower, PULL_UPS], [0, 1, 2, 3, 4], days)).toEqual([{ ...grower, daily: 110 }, PULL_UPS])
  })

  it("keeps a target missed on one nudge day, or with no day kept for it", () => {
    expect(grownTargets([grower], [0, 1, 2, 3, 4], week.map((day, index) => (index === 2 ? missed(day) : met(day))))).toEqual([grower])
    expect(grownTargets([grower], [0, 1, 2, 3, 4], week.map((day) => ({ day, progress: [] })))).toEqual([grower])
    expect(grownTargets([grower], [], week.map(met))).toEqual([grower])
  })
})

describe("the settings form", () => {
  const form = miniFormFor({ ...SETTINGS, targets: [PUSH_UPS] })

  const problemWith = (next: typeof form) => {
    const result = readMiniForm(next, "UTC", null)

    return result.ok ? null : result.problem
  }

  it("reads back the settings it was made from", () => {
    expect(readMiniForm(form, "Australia/Brisbane", null)).toEqual({ ok: true, settings: { ...SETTINGS, targets: [PUSH_UPS] } })
  })

  it("says what is wrong in words", () => {
    expect(problemWith({ ...form, start: "9" })).toBe("Write the times as 9:00 or 17:30")
    expect(problemWith({ ...form, start: "17:20" })).toMatch(/at least 30 minutes/)
    expect(problemWith({ ...form, gap: "5" })).toMatch(/15 to 240 minutes/)
    expect(problemWith({ ...form, targets: [{ ...form.targets[0]!, chunk: "200" }] })).toMatch(/up to the daily target/)
  })

  it("starts a target with what suits the exercise", () => {
    expect(suggestTarget("Plank")).toMatchObject({ unit: "seconds", daily: 180, chunk: 60 })
    expect(suggestTarget("Pull-Up")).toMatchObject({ unit: "reps", daily: 50, chunk: 10 })
    expect(suggestTarget("Push-Up")).toMatchObject({ unit: "reps", daily: 100, chunk: 25 })
  })
})
