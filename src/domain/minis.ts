import { shiftDay } from "./days"
import type { StreakSession } from "./streaks"

/**
 * Mini workouts: small sets done through the day at home, such as 25 push-ups, toward daily
 * targets such as 100 push-ups and 100 sit-ups. The server sends a nudge now and then while the
 * user's window is open, asks for what keeps them on course for the day, and counts a day as met
 * when every target is done. The rules here are shared by the server, which plans the nudges,
 * and both clients, which show the progress.
 */

// ---------------------------------------------------------------- settings

/** What a target counts: repetitions, or seconds held (a plank). */
export const MINI_UNITS = ["reps", "seconds"] as const

export type MiniUnit = (typeof MINI_UNITS)[number]

export interface MiniTarget {
  /** A library exercise name, or any other. */
  readonly exercise: string
  readonly unit: MiniUnit
  /** How many to do in a day. */
  readonly daily: number
  /** About how many one nudge asks for. */
  readonly chunk: number
  /** Added to the daily target after a week with it met on every nudge day. 0 keeps the target fixed. */
  readonly growBy: number
}

export interface MiniSettings {
  readonly targets: ReadonlyArray<MiniTarget>
  /** Whether nudges are sent at all. Targets count toward the day either way. */
  readonly nudges: boolean
  /** The days nudges come on, 0 for Monday through 6 for Sunday. */
  readonly days: ReadonlyArray<number>
  /** The window nudges come in, as minutes after midnight in the user's time zone. */
  readonly startMinute: number
  readonly endMinute: number
  /** The least time between two nudges, in minutes. */
  readonly gapMinutes: number
  /** The user's IANA time zone, such as Australia/Brisbane, which the window is read in. */
  readonly timeZone: string
  /** No nudges before this day (YYYY-MM-DD), for a day off or a holiday. Null when not paused. */
  readonly pausedUntil: string | null
}

export const MINI_LIMITS = {
  targets: 6,
  daily: 5000,
  chunk: 1000,
  growBy: 100,
  minGap: 15,
  maxGap: 240,
  /** The shortest window nudges can come in. */
  window: 30,
} as const

export const DEFAULT_MINI_SETTINGS: MiniSettings = {
  targets: [],
  nudges: false,
  days: [0, 1, 2, 3, 4],
  startMinute: 9 * 60,
  endMinute: 17 * 60 + 30,
  gapMinutes: 45,
  timeZone: "",
  pausedUntil: null,
}

/** A target to start from for an exercise: what suits a set at home. */
export const suggestTarget = (exercise: string): MiniTarget => {
  const name = exercise.toLowerCase()

  if (name.includes("plank") || name.includes("hang") || name.includes("hold") || name.includes("wall sit")) {
    return { exercise, unit: "seconds", daily: 180, chunk: 60, growBy: 0 }
  }

  if (name.includes("pull-up") || name.includes("chin-up") || name.includes("dip")) {
    return { exercise, unit: "reps", daily: 50, chunk: 10, growBy: 0 }
  }

  return { exercise, unit: "reps", daily: 100, chunk: 25, growBy: 0 }
}

/** The same exercise, whatever the case or the spaces around it. */
/**
 * What two names of an exercise are compared by: trimmed, in one Unicode form, lower case. The
 * server keeps it beside every set, so the database matches sets to targets the same way (MET_NOW).
 */
export const exerciseKey = (name: string): string => name.trim().normalize("NFC").toLowerCase()

export const sameExercise = (a: string, b: string) => exerciseKey(a) === exerciseKey(b)

// ---------------------------------------------------------------- time

export interface LocalTime {
  /** The calendar day there, as YYYY-MM-DD. */
  readonly day: string
  /** 0 for Monday through 6 for Sunday. */
  readonly weekday: number
  /** Minutes after midnight there. */
  readonly minute: number
}

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const

/** Whether text names a time zone this runtime knows. */
export const isTimeZone = (zone: string): boolean => {
  if (zone === "") return false

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone })

    return true
  } catch {
    return false
  }
}

/** The day, weekday and minute it is at `time` in a time zone. */
export const localTime = (timeZone: string, time: number): LocalTime => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(time)

  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ""

  return {
    day: `${part("year")}-${part("month")}-${part("day")}`,
    weekday: Math.max(0, WEEKDAY_NAMES.findIndex((name) => name === part("weekday"))),
    minute: (Number(part("hour")) % 24) * 60 + Number(part("minute")),
  }
}

/** 0 for Monday through 6 for Sunday, for a day as YYYY-MM-DD. */
export const weekdayOf = (day: string): number => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7

/** The Monday of the week a day is in. */
export const mondayOf = (day: string): string => shiftDay(day, -weekdayOf(day))

/** Midday of a day on this device, so a day from the server lands on the same calendar day here. */
export const middayOf = (day: string): number => {
  const [year, month, date] = day.split("-").map(Number)

  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1, 12).getTime()
}

/** "9:00", "17:30": a minute of the day on a 24-hour clock. The midnight that ends the day is "24:00". */
export const formatMinute = (minute: number): string =>
  minute >= 1440 ? "24:00" : `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`

/** Reads "9:00" or "17:30" back as a minute of the day, or null. */
export const parseMinute = (text: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())

  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])

  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}

// ---------------------------------------------------------------- progress

export interface MiniEntry {
  readonly id: number
  readonly day: string
  readonly exercise: string
  readonly unit: MiniUnit
  readonly amount: number
  /** The nudge it answered, when it was logged from one. */
  readonly nudgeId: number | null
  readonly createdAt: number
}

export interface MiniProgress {
  readonly exercise: string
  readonly unit: MiniUnit
  readonly target: number
  readonly done: number
}

/** How far each target is on a day, from what was logged on it. */
export const dayProgress = (
  targets: ReadonlyArray<Pick<MiniTarget, "exercise" | "unit" | "daily">>,
  entries: ReadonlyArray<Pick<MiniEntry, "exercise" | "unit" | "amount">>,
): ReadonlyArray<MiniProgress> =>
  targets.map((target) => ({
    exercise: target.exercise,
    unit: target.unit,
    target: target.daily,
    done: entries
      .filter((entry) => entry.unit === target.unit && sameExercise(entry.exercise, target.exercise))
      .reduce((total, entry) => total + entry.amount, 0),
  }))

/** A day counts when it had targets and every one was done. */
export const isMet = (progress: ReadonlyArray<MiniProgress>): boolean =>
  progress.length > 0 && progress.every((item) => item.done >= item.target)

export const remainingOf = (progress: MiniProgress): number => Math.max(0, progress.target - progress.done)

/** Days the targets were met as streak sessions, at midday on this device. */
export const miniSessions = (metDays: ReadonlyArray<string>): ReadonlyArray<StreakSession & { readonly volume: number }> =>
  metDays.map((day) => ({ startedAt: middayOf(day), kind: "minis", volume: 0 }))

/** A set logged on a screen, waiting to be known to be in. Its client key is its own, made when it was logged. */
export interface PendingMiniSet {
  readonly clientKey: string
  readonly day: string
  readonly exercise: string
  readonly amount: number
  readonly nudgeId?: number | undefined
}

/** Somewhere a screen keeps a little text between visits: the browser's localStorage, the phone's store. */
export interface TextStore {
  readonly read: () => string | null
  readonly write: (text: string) => void
}

interface SavedSets {
  readonly userId: string
  readonly sets: ReadonlyArray<PendingMiniSet>
}

/**
 * The sets a screen has logged and not yet heard are in, kept across reloads. Each tap of Log is
 * a new set with a new key; one whose answer never came back is sent again under its own key,
 * which the server answers with the set it already has, so nothing is lost or logged twice.
 * Sets kept for another account are never sent as this one's.
 */
export const makeMiniOutbox = (store: TextStore, userId: string) => {
  const list = (): ReadonlyArray<PendingMiniSet> => {
    try {
      const text = store.read()
      const saved: SavedSets | null = text === null ? null : JSON.parse(text)

      return saved !== null && saved.userId === userId && Array.isArray(saved.sets) ? saved.sets : []
    } catch {
      return []
    }
  }

  const save = (sets: ReadonlyArray<PendingMiniSet>) => {
    try {
      store.write(JSON.stringify({ userId, sets } satisfies SavedSets))
    } catch {
      // Storage refused (a private window, say): the set is still sent, it just is not kept for a retry.
    }
  }

  return {
    list,
    add: (set: PendingMiniSet) => save([...list().filter((item) => item.clientKey !== set.clientKey), set]),
    remove: (clientKey: string) => save(list().filter((item) => item.clientKey !== clientKey)),
  }
}

// ---------------------------------------------------------------- nudges

/**
 * Today where the account is: in its saved time zone, which nudges follow, or the device's own
 * day before it has one. A phone that has moved zone may be on another day.
 */
export const settingsToday = (settings: MiniSettings, time: number, deviceDay: string): string =>
  isTimeZone(settings.timeZone) ? localTime(settings.timeZone, time).day : deviceDay

/** Whether nudges are paused now, read by the same day the nudges themselves follow. */
export const isPaused = (settings: MiniSettings, time: number, deviceDay: string): boolean =>
  settings.pausedUntil !== null && settings.pausedUntil > settingsToday(settings, time, deviceDay)

/** Whether a nudge may go now: nudges on, a nudge day, inside the window and not paused. */
export const nudgesOpen = (settings: MiniSettings, now: LocalTime): boolean =>
  settings.nudges &&
  settings.targets.length > 0 &&
  settings.days.includes(now.weekday) &&
  now.minute >= settings.startMinute &&
  now.minute < settings.endMinute &&
  (settings.pausedUntil === null || now.day >= settings.pausedUntil)

export interface NudgeAsk {
  readonly exercise: string
  readonly unit: MiniUnit
  readonly amount: number
  /** What was left of the day's target before this nudge. */
  readonly left: number
  readonly target: number
}

const chunkOf = (targets: ReadonlyArray<MiniTarget>, progress: MiniProgress) =>
  Math.max(1, targets.find((target) => sameExercise(target.exercise, progress.exercise))?.chunk ?? 1)

/** How many more nudges the day needs at the usual size of each. */
export const nudgesNeeded = (targets: ReadonlyArray<MiniTarget>, progress: ReadonlyArray<MiniProgress>): number =>
  progress.reduce((total, item) => total + Math.ceil(remainingOf(item) / chunkOf(targets, item)), 0)

/** An amount rounded up to a friendly number: a multiple of 5 from 10 up, never more than is left. */
const friendly = (amount: number, left: number) => Math.min(left, amount >= 10 ? Math.ceil(amount / 5) * 5 : amount)

/**
 * What to ask for now. One exercise a nudge, a different one from the last when there is a
 * choice, picked at random weighted by how much of it is left. When the day is running out of
 * time for nudges of the usual size, each one asks for more, up to twice the usual.
 */
export const chooseNudge = (
  targets: ReadonlyArray<MiniTarget>,
  progress: ReadonlyArray<MiniProgress>,
  minutesLeft: number,
  gapMinutes: number,
  lastExercise: string | null,
  random: () => number,
): NudgeAsk | null => {
  const open = progress.filter((item) => remainingOf(item) > 0)

  if (open.length === 0) return null

  const others = lastExercise === null ? open : open.filter((item) => !sameExercise(item.exercise, lastExercise))
  const pool = others.length > 0 ? others : open
  const wanted = (item: MiniProgress) => Math.ceil(remainingOf(item) / chunkOf(targets, item))
  const weights = pool.map(wanted)
  let roll = random() * weights.reduce((total, weight) => total + weight, 0)
  const picked = pool.find((_, index) => (roll -= weights[index]!) < 0) ?? pool.at(-1)!

  // How many nudges are left for it: what it wants, or its share of the time left when that is short.
  const slots = nudgeSlots(minutesLeft, gapMinutes)
  const total = open.reduce((sum, item) => sum + wanted(item), 0)
  const share = total <= slots ? wanted(picked) : Math.max(1, Math.floor((slots * wanted(picked)) / total))
  const left = remainingOf(picked)
  const chunk = chunkOf(targets, picked)
  const amount = Math.min(friendly(Math.ceil(left / share), left), chunk * 2)

  return { exercise: picked.exercise, unit: picked.unit, amount, left, target: picked.target }
}

/** The progress as it will be once a nudge's ask is done, for planning the next one. */
export const afterAsk = (progress: ReadonlyArray<MiniProgress>, ask: NudgeAsk): ReadonlyArray<MiniProgress> =>
  progress.map((item) => (sameExercise(item.exercise, ask.exercise) ? { ...item, done: item.done + ask.amount } : item))

/** How often the server looks for nudges that are due (the cron in alchemy.run.ts). */
export const CRON_MINUTES = 5

/**
 * The latest a nudge can still be due, in minutes from a cron run now: the last run before the
 * window closes. Runs come every CRON_MINUTES on the clock, and every time zone is a whole number
 * of quarter hours from UTC, so they land on the same minutes wherever the user is.
 */
export const lastRunWithin = (minutesLeft: number) => Math.floor((minutesLeft - 1) / CRON_MINUTES) * CRON_MINUTES

/** How many nudges still fit in the window from a cron run now, one now and then one a gap apart, each on a run. */
export const nudgeSlots = (minutesLeft: number, gapMinutes: number): number => {
  const gap = Math.ceil(gapMinutes / CRON_MINUTES) * CRON_MINUTES

  return 1 + Math.max(0, Math.floor(lastRunWithin(minutesLeft) / gap))
}

/**
 * Minutes until the next nudge, spreading what is still needed over the time left with some
 * randomness, never sooner than the gap and no later than the last cron run before the window
 * closes. Null when nothing is needed or no such time is left.
 */
export const nextNudgeDelay = (needed: number, minutesLeft: number, gapMinutes: number, random: () => number): number | null => {
  const latest = lastRunWithin(minutesLeft)

  if (needed <= 0 || latest < gapMinutes) return null

  const mean = minutesLeft / (needed + 0.5)

  return Math.round(Math.min(Math.max(gapMinutes, mean * (0.7 + 0.6 * random())), latest))
}

/** Minutes from the window opening to the first nudge of the day: soon, but not on the dot. */
export const firstNudgeDelay = (needed: number, windowMinutes: number, random: () => number): number =>
  Math.round(random() * Math.min(windowMinutes / (needed + 1), 90))

/**
 * The push services browsers subscribe through: Apple's for Safari and home-screen web apps on
 * iPhone, Google's for Chrome, Mozilla's for Firefox, Microsoft's for Edge. The server only ever
 * posts to these, so a made-up subscription cannot point it anywhere else.
 */
const PUSH_HOSTS: ReadonlyArray<string> = ["push.apple.com", "fcm.googleapis.com", "push.services.mozilla.com", "notify.windows.com"]

/** Whether an address is an https endpoint of a known push service. */
export const isPushEndpoint = (endpoint: string): boolean => {
  let url: URL

  try {
    url = new URL(endpoint)
  } catch {
    return false
  }

  const host = url.hostname.toLowerCase()

  return (
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    PUSH_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  )
}

/** An exercise as a count says it: "25 push-ups", "1 pull-up". */
export const describeAmount = (exercise: string, unit: MiniUnit, amount: number): string => {
  const name = exercise.trim().toLowerCase()

  if (unit === "seconds") return `${formatSeconds(amount)} ${name}`

  return `${amount} ${amount === 1 || name.endsWith("s") ? name : `${name}s`}`
}

/** Seconds as "45 s" or "1:30 min". */
export const formatSeconds = (seconds: number): string =>
  seconds < 60 ? `${seconds} s` : seconds % 60 === 0 ? `${seconds / 60} min` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} min`

/** A target's count with its unit: "75", "2:30 min". */
export const formatMiniAmount = (unit: MiniUnit, amount: number): string => (unit === "seconds" ? formatSeconds(amount) : `${amount}`)

const TITLES = [
  (what: string) => `Got time for ${what}?`,
  (what: string) => `Quick one: ${what}`,
  (what: string) => `${what.charAt(0).toUpperCase()}${what.slice(1)}, right now?`,
  (what: string) => `Up you get: ${what}`,
] as const

export interface NudgeMessage {
  readonly title: string
  readonly body: string
}

/** What the notification says. */
export const nudgeMessage = (ask: NudgeAsk, random: () => number): NudgeMessage => {
  const what = describeAmount(ask.exercise, ask.unit, ask.amount)
  const title = TITLES[Math.floor(random() * TITLES.length) % TITLES.length]!(what)
  const done = ask.target - ask.left
  const after = ask.left - ask.amount

  const body =
    after <= 0
      ? `That finishes today's ${formatMiniAmount(ask.unit, ask.target)}. Tap to log it.`
      : `${formatMiniAmount(ask.unit, done)} of ${formatMiniAmount(ask.unit, ask.target)} done today. Tap to log it.`

  return { title, body }
}

// ---------------------------------------------------------------- growing targets

export interface PastDay {
  readonly day: string
  readonly progress: ReadonlyArray<MiniProgress>
}

/**
 * The targets after a week: one set to grow goes up by its step when it was met on every nudge
 * day of that week. A week with no nudge days leaves it as it was.
 */
export const grownTargets = (
  targets: ReadonlyArray<MiniTarget>,
  nudgeDays: ReadonlyArray<number>,
  week: ReadonlyArray<PastDay>,
): ReadonlyArray<MiniTarget> => {
  const counted = week.filter((item) => nudgeDays.includes(weekdayOf(item.day)))

  return targets.map((target) => {
    if (target.growBy <= 0 || counted.length === 0) return target

    const kept = counted.every((item) => {
      const progress = item.progress.find((entry) => entry.unit === target.unit && sameExercise(entry.exercise, target.exercise))

      return progress !== undefined && progress.done >= progress.target
    })

    return kept ? { ...target, daily: Math.min(target.daily + target.growBy, MINI_LIMITS.daily) } : target
  })
}

/** The seven days of the week before the one a day is in, Monday first. */
export const weekBefore = (day: string): ReadonlyArray<string> => {
  const monday = shiftDay(mondayOf(day), -7)

  return [0, 1, 2, 3, 4, 5, 6].map((offset) => shiftDay(monday, offset))
}

export const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const
export const WEEKDAY_SHORT = WEEKDAY_NAMES

// ---------------------------------------------------------------- the settings form

/** A target as the form holds it: numbers as typed. */
export interface MiniTargetForm {
  readonly exercise: string
  readonly unit: MiniUnit
  readonly daily: string
  readonly chunk: string
  readonly growBy: string
}

/** The settings as the form on either client holds them. */
export interface MiniForm {
  readonly targets: ReadonlyArray<MiniTargetForm>
  readonly nudges: boolean
  readonly days: ReadonlyArray<number>
  readonly start: string
  readonly end: string
  readonly gap: string
}

export const targetFormFor = (target: MiniTarget): MiniTargetForm => ({
  exercise: target.exercise,
  unit: target.unit,
  daily: String(target.daily),
  chunk: String(target.chunk),
  growBy: String(target.growBy),
})

export const miniFormFor = (settings: MiniSettings): MiniForm => ({
  targets: settings.targets.map(targetFormFor),
  nudges: settings.nudges,
  days: settings.days,
  start: formatMinute(settings.startMinute),
  end: formatMinute(settings.endMinute),
  gap: String(settings.gapMinutes),
})

const wholeNumber = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null)

/** What a settings form reads as: settings to save, or what is wrong in words. */
export type MiniFormResult = { readonly ok: true; readonly settings: MiniSettings } | { readonly ok: false; readonly problem: string }

const problem = (text: string): MiniFormResult => ({ ok: false, problem: text })

/**
 * The settings a form makes, or what is wrong with it. The time zone is the device's, and a pause
 * carries over from what was saved.
 */
export const readMiniForm = (form: MiniForm, timeZone: string, pausedUntil: string | null): MiniFormResult => {
  const targets: Array<MiniTarget> = []

  for (const target of form.targets) {
    const daily = wholeNumber(target.daily)
    const chunk = wholeNumber(target.chunk)
    const growBy = wholeNumber(target.growBy === "" ? "0" : target.growBy)

    if (daily === null || daily < 1 || daily > MINI_LIMITS.daily) return problem(`Set a daily target for ${target.exercise}`)

    if (chunk === null || chunk < 1 || chunk > daily) {
      return problem(`Set how many each nudge asks for ${target.exercise}, up to the daily target`)
    }

    if (growBy === null || growBy > MINI_LIMITS.growBy) return problem(`Set how much ${target.exercise} grows, from 0 to ${MINI_LIMITS.growBy}`)

    targets.push({ exercise: target.exercise, unit: target.unit, daily, chunk, growBy })
  }

  const startMinute = parseMinute(form.start)
  const endMinute = form.end.trim() === "24:00" ? 1440 : parseMinute(form.end)

  if (startMinute === null || endMinute === null) return problem("Write the times as 9:00 or 17:30")

  if (endMinute - startMinute < MINI_LIMITS.window) return problem(`Nudges need a window of at least ${MINI_LIMITS.window} minutes`)

  const gapMinutes = wholeNumber(form.gap)

  if (gapMinutes === null || gapMinutes < MINI_LIMITS.minGap || gapMinutes > MINI_LIMITS.maxGap) {
    return problem(`Leave ${MINI_LIMITS.minGap} to ${MINI_LIMITS.maxGap} minutes between nudges`)
  }

  const days = [...form.days].toSorted((a, b) => a - b)

  return { ok: true, settings: { targets, nudges: form.nudges, days, startMinute, endMinute, gapMinutes, timeZone, pausedUntil } }
}

/** The days a screen asks for around the device's today: the day before, today and the day after. */
export const miniRange = (today: string) => ({ from: shiftDay(today, -1), to: shiftDay(today, 1) })

/** The day's progress as one fraction, for a ring or a bar: each target counts the same. */
export const dayFraction = (progress: ReadonlyArray<MiniProgress>): number =>
  progress.length === 0 ? 0 : progress.reduce((total, item) => total + Math.min(1, item.done / item.target), 0) / progress.length
