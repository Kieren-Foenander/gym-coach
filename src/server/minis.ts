import { Clock, Effect, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { daysBetween, daysFrom } from "~/domain/days"
import {
  afterAsk,
  chooseNudge,
  dayProgress,
  DEFAULT_MINI_SETTINGS,
  firstNudgeDelay,
  grownTargets,
  isMet,
  isTimeZone,
  localTime,
  mondayOf,
  nextNudgeDelay,
  nudgeMessage,
  nudgesNeeded,
  nudgesOpen,
  sameExercise,
  weekBefore,
  type MiniEntry,
  type MiniProgress,
  type MiniSettings,
  type MiniTarget,
  type MiniUnit,
} from "~/domain/minis"
import { MiniSettingsInput, MiniTargetInput, type PushSubscriptionInput } from "~/domain/schema"
import { Invalid, NotFound } from "./errors"
import { generateVapidKeys, sendPush, vapidSubject, type PushMessage, type PushOutcome, type Subscription, type VapidKeys } from "./push"
import { CurrentUser } from "./repo"

/**
 * Mini workouts on the server: the settings, what was done each day, and the nudges. The
 * Worker's cron (src/server.ts) runs runNudges every few minutes, which sends whatever nudge is
 * due to each browser the user turned nudges on in. src/domain/minis.ts holds the rules.
 */

const MINUTE = 60_000

/** Ask a day either side of a phone's today at most, as the screens do; a coach may look back further. */
export const MAX_MINI_DAYS = 120

/** A nudge is held back while a workout started this recently is still open. */
const WORKOUT_HOLD_MS = 3 * 3_600_000
const WORKOUT_RETRY_MS = 15 * MINUTE

// ---------------------------------------------------------------- settings

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(MiniSettingsInput))
const decodeTargets = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(MiniTargetInput)))

/** The saved settings, or the defaults when there are none or they cannot be read. */
export const parseSettings = (json: string): MiniSettings =>
  json === "" ? DEFAULT_MINI_SETTINGS : Option.getOrElse(decodeSettings(json), () => DEFAULT_MINI_SETTINGS)

const parseTargets = (json: string): ReadonlyArray<MiniTarget> => Option.getOrElse(decodeTargets(json), () => [])

const settingsOf = Effect.fn("minis.settingsOf")(function* (userId: string) {
  const sql = yield* SqlClient.SqlClient

  const rows = yield* sql<{ miniSettings: string; miniReviewedWeek: string }>`
    SELECT mini_settings, mini_reviewed_week FROM users WHERE id = ${userId}`

  return { settings: parseSettings(rows[0]?.miniSettings ?? ""), reviewedWeek: rows[0]?.miniReviewedWeek ?? "" }
})

// ---------------------------------------------------------------- days

interface DayRow {
  readonly day: string
  readonly targets: string
  readonly met: number
  readonly nextNudgeAt: number | null
}

export interface MiniDay {
  readonly day: string
  readonly targets: ReadonlyArray<MiniTarget>
  readonly progress: ReadonlyArray<MiniProgress>
  readonly met: boolean
}

const ENTRY_COLUMNS = `id, day, exercise, unit, amount, nudge_id, created_at`

const entriesOn = Effect.fn("minis.entriesOn")(function* (userId: string, from: string, to: string) {
  const sql = yield* SqlClient.SqlClient

  return yield* sql<MiniEntry>`
    SELECT ${sql.unsafe(ENTRY_COLUMNS)} FROM mini_sets
    WHERE user_id = ${userId} AND day >= ${from} AND day <= ${to}
    ORDER BY day, created_at, id`
})

const dayRows = Effect.fn("minis.dayRows")(function* (userId: string, from: string, to: string) {
  const sql = yield* SqlClient.SqlClient

  return yield* sql<DayRow>`
    SELECT day, targets, met, next_nudge_at FROM mini_days
    WHERE user_id = ${userId} AND day >= ${from} AND day <= ${to}`
})

/**
 * Checks last week's targets once a week, before the first day of the new week is kept: a
 * target set to grow goes up when it was met on every nudge day.
 */
const reviewWeek = Effect.fn("minis.reviewWeek")(function* (userId: string, day: string) {
  const sql = yield* SqlClient.SqlClient
  const { settings, reviewedWeek } = yield* settingsOf(userId)
  const monday = mondayOf(day)

  if (reviewedWeek >= monday) return settings

  let next = settings

  if (settings.targets.some((target) => target.growBy > 0)) {
    const week = weekBefore(day)
    const [rows, entries] = yield* Effect.all([dayRows(userId, week[0]!, week[6]!), entriesOn(userId, week[0]!, week[6]!)])

    const past = week.map((date) => {
      const row = rows.find((item) => item.day === date)

      return { day: date, progress: row ? dayProgress(parseTargets(row.targets), entries.filter((entry) => entry.day === date)) : [] }
    })

    next = { ...settings, targets: grownTargets(settings.targets, settings.days, past) }
  }

  yield* sql`UPDATE users SET mini_settings = ${JSON.stringify(next)}, mini_reviewed_week = ${monday} WHERE id = ${userId}`

  return next
})

/** The kept row for a day, made with the targets as they are now if there is none yet. */
const ensureDay = Effect.fn("minis.ensureDay")(function* (userId: string, day: string) {
  const sql = yield* SqlClient.SqlClient
  const existing = yield* dayRows(userId, day, day)

  if (existing[0]) return existing[0]

  const settings = yield* reviewWeek(userId, day)

  yield* sql`
    INSERT INTO mini_days (user_id, day, targets) VALUES (${userId}, ${day}, ${JSON.stringify(settings.targets)})
    ON CONFLICT (user_id, day) DO NOTHING`

  return (yield* dayRows(userId, day, day))[0]!
})

/** Works out again whether a day's targets are all done, after a set is logged or removed. */
const refreshDay = Effect.fn("minis.refreshDay")(function* (userId: string, day: string) {
  const sql = yield* SqlClient.SqlClient
  const row = yield* ensureDay(userId, day)
  const entries = yield* entriesOn(userId, day, day)
  const progress = dayProgress(parseTargets(row.targets), entries)
  const met = isMet(progress) ? 1 : 0
  // A day that had run out of nudges plans again when more is now needed, such as after a set was removed.
  const replan = row.nextNudgeAt === 0 && !isMet(progress)

  yield* sql`
    UPDATE mini_days SET met = ${met}, next_nudge_at = ${replan ? null : row.nextNudgeAt}
    WHERE user_id = ${userId} AND day = ${day}`
})

// ---------------------------------------------------------------- calls

export interface MiniNudge {
  readonly id: number
  readonly day: string
  readonly exercise: string
  readonly unit: MiniUnit
  readonly amount: number
  readonly status: "sent" | "done" | "skipped"
  readonly sentAt: number
}

const checkSpan = (from: string, to: string) => {
  const span = daysBetween(from, to)

  if (span < 0) return Effect.fail(new Invalid({ reason: "The first day comes after the last" }))

  if (span >= MAX_MINI_DAYS) return Effect.fail(new Invalid({ reason: `Ask for at most ${MAX_MINI_DAYS} days at a time` }))

  return Effect.void
}

/**
 * Mini workouts from `from` to `to`: the settings, each day's progress against its targets (a
 * day not started yet shows today's targets), what was logged, the nudges sent, every day the
 * targets were met (for the streak), and what the browser needs to turn nudges on.
 */
export const getMinis = Effect.fn("getMinis")(function* (from: string, to: string) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser

  yield* checkSpan(from, to)

  const { settings } = yield* settingsOf(user.id)

  const { rows, entries, nudges, metDays, devices, keys } = yield* Effect.all(
    {
      rows: dayRows(user.id, from, to),
      entries: entriesOn(user.id, from, to),
      nudges: sql<MiniNudge>`
        SELECT id, day, exercise, unit, amount, status, sent_at FROM mini_nudges
        WHERE user_id = ${user.id} AND day >= ${from} AND day <= ${to} ORDER BY sent_at, id`,
      metDays: sql<{ day: string }>`SELECT day FROM mini_days WHERE user_id = ${user.id} AND met = 1 ORDER BY day`,
      devices: sql<{ count: number }>`SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ${user.id}`,
      keys: vapidKeys,
    },
    { concurrency: 3 },
  )

  const days = daysFrom(from, to).map((day): MiniDay => {
    const row = rows.find((item) => item.day === day)
    const targets = row ? parseTargets(row.targets) : settings.targets
    const progress = dayProgress(targets, entries.filter((entry) => entry.day === day))

    return { day, targets, progress, met: isMet(progress) }
  })

  return {
    settings,
    days,
    entries,
    nudges,
    metDays: metDays.map((row) => row.day),
    push: { publicKey: keys.publicKey, devices: devices[0]?.count ?? 0 },
  }
})

/**
 * Saves the settings. The day the user is on takes the new targets straight away, and plans its
 * nudges again, so a change shows and counts at once.
 */
export const updateMinis = Effect.fn("updateMinis")(function* (day: string, settings: MiniSettings) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser

  yield* sql`UPDATE users SET mini_settings = ${JSON.stringify(settings)} WHERE id = ${user.id}`
  yield* ensureDay(user.id, day)
  yield* sql`
    UPDATE mini_days SET targets = ${JSON.stringify(settings.targets)}, next_nudge_at = NULL
    WHERE user_id = ${user.id} AND day = ${day}`
  yield* refreshDay(user.id, day)

  return settings
})

export interface MiniSetInput {
  readonly day: string
  readonly exercise: string
  readonly amount: number
  readonly unit?: MiniUnit | undefined
  readonly nudgeId?: number | undefined
  readonly clientKey?: string | undefined
}

/** Logs what was done. Its unit is the day's target for the exercise, when there is one. */
export const logMini = Effect.fn("logMini")(function* (input: MiniSetInput) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser
  const time = yield* Clock.currentTimeMillis

  if (input.clientKey !== undefined) {
    const again = yield* sql<MiniEntry>`
      SELECT ${sql.unsafe(ENTRY_COLUMNS)} FROM mini_sets WHERE user_id = ${user.id} AND client_key = ${input.clientKey}`

    if (again[0]) return again[0]
  }

  const row = yield* ensureDay(user.id, input.day)
  const target = parseTargets(row.targets).find((item) => sameExercise(item.exercise, input.exercise))
  const unit = target?.unit ?? input.unit ?? "reps"

  let nudgeId: number | null = null

  if (input.nudgeId !== undefined) {
    const nudges = yield* sql<{ id: number }>`
      UPDATE mini_nudges SET status = 'done' WHERE id = ${input.nudgeId} AND user_id = ${user.id} RETURNING id`

    if (!nudges[0]) return yield* new NotFound({ what: `Nudge ${input.nudgeId}` })
    nudgeId = nudges[0].id
  }

  const rows = yield* sql<MiniEntry>`
    INSERT INTO mini_sets (user_id, day, exercise, unit, amount, nudge_id, client_key, created_at)
    VALUES (${user.id}, ${input.day}, ${target?.exercise ?? input.exercise}, ${unit}, ${input.amount}, ${nudgeId},
      ${input.clientKey ?? null}, ${time})
    RETURNING ${sql.unsafe(ENTRY_COLUMNS)}`

  yield* refreshDay(user.id, input.day)

  return rows[0]!
})

export const deleteMini = Effect.fn("deleteMini")(function* (entryId: number) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser

  const rows = yield* sql<{ day: string; nudgeId: number | null }>`
    DELETE FROM mini_sets WHERE id = ${entryId} AND user_id = ${user.id} RETURNING day, nudge_id`

  const removed = rows[0]

  if (!removed) return yield* new NotFound({ what: `Mini workout set ${entryId}` })

  if (removed.nudgeId !== null) yield* sql`UPDATE mini_nudges SET status = 'sent' WHERE id = ${removed.nudgeId} AND user_id = ${user.id}`

  yield* refreshDay(user.id, removed.day)
})

/** Marks a nudge as passed over, so its page stops asking. */
export const skipNudge = Effect.fn("skipNudge")(function* (nudgeId: number) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser

  const rows = yield* sql<{ id: number }>`
    UPDATE mini_nudges SET status = 'skipped' WHERE id = ${nudgeId} AND user_id = ${user.id} AND status = 'sent' RETURNING id`

  if (rows.length === 0) {
    const known = yield* sql<{ id: number }>`SELECT id FROM mini_nudges WHERE id = ${nudgeId} AND user_id = ${user.id}`

    if (known.length === 0) return yield* new NotFound({ what: `Nudge ${nudgeId}` })
  }
})

// ---------------------------------------------------------------- push

/** This server's signing keys, made and kept the first time anything needs them. */
export const vapidKeys = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const kept = yield* sql<VapidKeys>`SELECT public_key, private_key FROM push_keys WHERE id = 1`

  if (kept[0]) return kept[0]

  const made = yield* Effect.promise(generateVapidKeys)

  // Two requests at once may both make a pair; the first one kept wins and both read it back.
  yield* sql`INSERT INTO push_keys (id, public_key, private_key) VALUES (1, ${made.publicKey}, ${made.privateKey})
    ON CONFLICT (id) DO NOTHING`

  return (yield* sql<VapidKeys>`SELECT public_key, private_key FROM push_keys WHERE id = 1`)[0]!
})

/** Turns nudges on in a browser. A browser already known moves to this account. */
export const subscribePush = Effect.fn("subscribePush")(function* (subscription: PushSubscriptionInput, origin: string) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser
  const time = yield* Clock.currentTimeMillis

  yield* sql`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, origin, created_at)
    VALUES (${user.id}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth}, ${origin}, ${time})
    ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
      origin = excluded.origin`
})

export const unsubscribePush = Effect.fn("unsubscribePush")(function* (endpoint: string) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser

  yield* sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint} AND user_id = ${user.id}`
})

interface SubscriptionRow extends Subscription {
  readonly id: number
  readonly origin: string
}

const subscriptionsOf = Effect.fn("minis.subscriptionsOf")(function* (userId: string) {
  const sql = yield* SqlClient.SqlClient

  return yield* sql<SubscriptionRow>`SELECT id, endpoint, p256dh, auth, origin FROM push_subscriptions WHERE user_id = ${userId}`
})

/** Sends one message to every browser of a user, forgetting the ones the push service says are gone. */
const pushToUser = Effect.fn("minis.pushToUser")(function* (userId: string, message: (origin: string) => PushMessage, time: number) {
  const sql = yield* SqlClient.SqlClient
  const keys = yield* vapidKeys
  const subscriptions = yield* subscriptionsOf(userId)

  const outcomes = yield* Effect.forEach(
    subscriptions,
    (subscription) =>
      Effect.promise(
        (): Promise<PushOutcome> =>
          sendPush(subscription, message(subscription.origin), keys, vapidSubject(subscription.origin), time).catch(() => "failed"),
      ).pipe(
        Effect.tap((outcome) =>
          outcome === "gone" ? Effect.asVoid(sql`DELETE FROM push_subscriptions WHERE id = ${subscription.id}`) : Effect.void,
        ),
      ),
    { concurrency: 4 },
  )

  return { sent: outcomes.filter((outcome) => outcome === "sent").length, failed: outcomes.filter((outcome) => outcome !== "sent").length }
})

/** Sends a notification now, to check nudges reach the phone. */
export const testPush = Effect.fn("testPush")(function* () {
  const user = yield* CurrentUser
  const time = yield* Clock.currentTimeMillis

  return yield* pushToUser(
    user.id,
    (origin) => ({ title: "Nudges are on", body: "This is what a mini workout nudge looks like.", url: `${origin}/minis`, tag: "mini-test" }),
    time,
  )
})

// ---------------------------------------------------------------- the cron

export interface NudgeRun {
  readonly checked: number
  readonly sent: number
}

/**
 * Sends every nudge that is due at `time`, for every user with nudges on. A day's first nudge is
 * planned when its window opens; each one sent plans the next. What a nudge asks for is worked
 * out when it is sent, from what has been done so far, so a skipped nudge is made up later.
 */
export const runNudges = Effect.fn("runNudges")(function* (time: number, random: () => number = Math.random) {
  const sql = yield* SqlClient.SqlClient

  const users = yield* sql<{ id: string; miniSettings: string }>`
    SELECT u.id, u.mini_settings FROM users u
    WHERE u.mini_settings != '' AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)`

  let sent = 0

  for (const user of users) {
    const settings = parseSettings(user.miniSettings)

    if (!settings.nudges || !isTimeZone(settings.timeZone)) continue

    const outcome = yield* nudgeUser(user.id, settings, time, random).pipe(
      Effect.catch((error) => Effect.as(Effect.logError("A mini workout nudge failed", error), false)),
    )

    if (outcome) sent += 1
  }

  return { checked: users.length, sent } satisfies NudgeRun
})

/** Sends the nudge due for one user, if there is one. Answers whether one was sent. */
const nudgeUser = Effect.fn("minis.nudgeUser")(function* (userId: string, settings: MiniSettings, time: number, random: () => number) {
  const sql = yield* SqlClient.SqlClient
  const now = localTime(settings.timeZone, time)

  if (!nudgesOpen(settings, now)) return false

  const row = yield* ensureDay(userId, now.day)
  const targets = parseTargets(row.targets)
  const progress = dayProgress(targets, yield* entriesOn(userId, now.day, now.day))
  const minutesLeft = settings.endMinute - now.minute
  const plan = (next: number | null) => sql`UPDATE mini_days SET next_nudge_at = ${next} WHERE user_id = ${userId} AND day = ${now.day}`

  if (row.nextNudgeAt === null) {
    const needed = nudgesNeeded(targets, progress)

    if (needed === 0) {
      yield* plan(0)

      return false
    }

    const delay = firstNudgeDelay(needed, minutesLeft, random)

    if (delay > 0) {
      yield* plan(time + delay * MINUTE)

      return false
    }
  } else if (row.nextNudgeAt === 0 || row.nextNudgeAt > time) {
    return false
  }

  const training = yield* sql<{ id: number }>`
    SELECT id FROM workouts WHERE user_id = ${userId} AND finished_at IS NULL AND started_at > ${time - WORKOUT_HOLD_MS} LIMIT 1`

  if (training.length > 0) {
    yield* plan(time + WORKOUT_RETRY_MS)

    return false
  }

  const last = yield* sql<{ exercise: string }>`
    SELECT exercise FROM mini_nudges WHERE user_id = ${userId} AND day = ${now.day} ORDER BY id DESC LIMIT 1`

  const ask = chooseNudge(targets, progress, minutesLeft, settings.gapMinutes, last[0]?.exercise ?? null, random)

  if (ask === null) {
    yield* plan(0)

    return false
  }

  const nudge = (yield* sql<{ id: number }>`
    INSERT INTO mini_nudges (user_id, day, exercise, unit, amount, sent_at)
    VALUES (${userId}, ${now.day}, ${ask.exercise}, ${ask.unit}, ${ask.amount}, ${time}) RETURNING id`)[0]!

  const message = nudgeMessage(ask, random)

  yield* pushToUser(userId, (origin) => ({ ...message, url: `${origin}/minis?nudge=${nudge.id}`, tag: `mini-${nudge.id}` }), time)

  const delay = nextNudgeDelay(nudgesNeeded(targets, afterAsk(progress, ask)), minutesLeft, settings.gapMinutes, random)

  yield* plan(delay === null ? 0 : time + delay * MINUTE)

  return true
})

/** Every day's totals for the coach, newest first, from `from` to `to`. */
export const miniHistory = Effect.fn("minis.miniHistory")(function* (from: string, to: string) {
  const minis = yield* getMinis(from, to)

  return {
    settings: minis.settings,
    days: minis.days
      .filter((day) => day.progress.some((item) => item.done > 0) || minis.entries.some((entry) => entry.day === day.day))
      .map((day) => ({ day: day.day, met: day.met, progress: day.progress }))
      .toReversed(),
    nudges: minis.nudges.map(({ day, exercise, unit, amount, status }) => ({ day, exercise, unit, amount, status })),
  }
})
