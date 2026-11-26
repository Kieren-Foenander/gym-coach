import { Clock, Effect, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"
import type { SqlError } from "effect/sql/SqlError"
import { daysBetween, daysFrom, shiftDay } from "~/domain/days"
import {
  afterAsk,
  chooseNudge,
  dayProgress,
  DEFAULT_MINI_SETTINGS,
  exerciseKey,
  firstNudgeDelay,
  grownTargets,
  isMet,
  isTimeZone,
  lastRunWithin,
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
import {
  dispatchPush,
  generateVapidKeys,
  preparePush,
  vapidSubject,
  type PreparedPush,
  type PushMessage,
  type PushOutcome,
  type Subscription,
  type VapidKeys,
} from "./push"
import { CurrentUser } from "./repo"

/**
 * Mini workouts on the server: the settings, what was done each day, and the nudges. The
 * Worker's cron (src/server.ts) runs runNudges every few minutes, which sends whatever nudge is
 * due to each browser the user turned nudges on in. src/domain/minis.ts holds the rules.
 *
 * Many things can happen at once here: saves from two devices, the coach, the cron, and the
 * weekly review of growing targets. So every write that depends on something read first says
 * so in the write itself, and is refused when that has changed:
 *   - the settings carry a revision; a write of them names the revision it read (writeSettings);
 *   - a day's targets follow the settings until the day has ended where the account is, and are
 *     only replaced by targets from a later revision (syncDay), then stay as they were;
 *   - a day's plan (next_nudge_at) is only moved on from the value read, under the revision read;
 *   - whether a day is done is worked out by the database as it writes (MET_NOW).
 */

const MINUTE = 60_000

/** Ask a day either side of a phone's today at most, as the screens do; a coach may look back further. */
export const MAX_MINI_DAYS = 120

/** A nudge is held back while a workout started this recently is still open. */
const WORKOUT_HOLD_MS = 3 * 3_600_000
const WORKOUT_RETRY_MS = 15 * MINUTE

/** How many times a write refused because something changed meanwhile is worked out again. */
const ATTEMPTS = 5

// ---------------------------------------------------------------- settings

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(MiniSettingsInput))
const decodeTargets = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(MiniTargetInput)))

/** The saved settings, or the defaults when there are none or they cannot be read. */
export const parseSettings = (json: string): MiniSettings =>
  json === "" ? DEFAULT_MINI_SETTINGS : Option.getOrElse(decodeSettings(json), () => DEFAULT_MINI_SETTINGS)

const parseTargets = (json: string): ReadonlyArray<MiniTarget> => Option.getOrElse(decodeTargets(json), () => [])

/** A day's targets as kept: each with the key its sets are matched by (exerciseKey), for MET_NOW. */
const snapshotOf = (targets: ReadonlyArray<MiniTarget>) =>
  JSON.stringify(targets.map((target) => ({ ...target, key: exerciseKey(target.exercise) })))

interface Stored {
  readonly settings: MiniSettings
  readonly reviewedWeek: string
  readonly revision: number
}

const settingsOf = Effect.fn("minis.settingsOf")(function* (userId: string) {
  const sql = yield* SqlClient.SqlClient

  const rows = yield* sql<{ miniSettings: string; miniReviewedWeek: string; miniRevision: number }>`
    SELECT mini_settings, mini_reviewed_week, mini_revision FROM users WHERE id = ${userId}`

  return {
    settings: parseSettings(rows[0]?.miniSettings ?? ""),
    reviewedWeek: rows[0]?.miniReviewedWeek ?? "",
    revision: rows[0]?.miniRevision ?? 0,
  } satisfies Stored
})

/**
 * Writes the settings, but only if they are still at `revision`. Answers the new revision, or
 * null when someone else wrote first, for the caller to work its change out again.
 */
const writeSettings = Effect.fn("minis.writeSettings")(function* (
  userId: string,
  revision: number,
  settings: MiniSettings,
  reviewedWeek: string | null,
) {
  const sql = yield* SqlClient.SqlClient

  const rows = yield* sql<{ miniRevision: number }>`
    UPDATE users SET mini_settings = ${JSON.stringify(settings)}, mini_revision = mini_revision + 1,
      mini_reviewed_week = COALESCE(${reviewedWeek}, mini_reviewed_week)
    WHERE id = ${userId} AND mini_revision = ${revision}
    RETURNING mini_revision`

  return rows[0]?.miniRevision ?? null
})

/** The account's own today: the day in its saved time zone, or null before it has one. */
const accountToday = (settings: MiniSettings, time: number): string | null =>
  isTimeZone(settings.timeZone) ? localTime(settings.timeZone, time).day : null

// ---------------------------------------------------------------- days

interface DayRow {
  readonly day: string
  readonly targets: string
  readonly met: number
  readonly nextNudgeAt: number | null
  readonly targetsRevision: number
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
    SELECT day, targets, met, next_nudge_at, targets_revision FROM mini_days
    WHERE user_id = ${userId} AND day >= ${from} AND day <= ${to}`
})

/**
 * Whether every target of the day is done, worked out by the database from the sets there are
 * at the moment it runs: the same rule as isMet in src/domain/minis.ts, matching names by the
 * key JavaScript made (exerciseKey) rather than SQLite's own lower(), which only knows ASCII.
 * It reads the mini_days row being written or looked at.
 */
const MET_NOW = `(
  SELECT CASE WHEN COUNT(*) > 0 AND SUM(
    CASE WHEN COALESCE((
      SELECT SUM(s.amount) FROM mini_sets s
      WHERE s.user_id = mini_days.user_id AND s.day = mini_days.day AND s.unit = json_extract(t.value, '$.unit')
        AND s.exercise_key = json_extract(t.value, '$.key')
    ), 0) >= json_extract(t.value, '$.daily') THEN 0 ELSE 1 END
  ) = 0 THEN 1 ELSE 0 END
  FROM json_each(mini_days.targets) t
)`

/**
 * Brings a day's keys up to date before it is judged: its sets' keys, and its targets' keys,
 * made by exerciseKey. Rows kept before the keys were (migration 0012 could only fold ASCII) are
 * put right the first time their day is touched.
 */
const repairKeys = Effect.fn("minis.repairKeys")(function* (userId: string, day: string) {
  const sql = yield* SqlClient.SqlClient

  const sets = yield* sql<{ id: number; exercise: string; exerciseKey: string }>`
    SELECT id, exercise, exercise_key FROM mini_sets WHERE user_id = ${userId} AND day = ${day}`

  for (const set of sets) {
    if (set.exerciseKey !== exerciseKey(set.exercise)) {
      yield* sql`UPDATE mini_sets SET exercise_key = ${exerciseKey(set.exercise)} WHERE id = ${set.id}`
    }
  }

  const row = (yield* dayRows(userId, day, day))[0]

  if (row && row.targets !== snapshotOf(parseTargets(row.targets))) {
    // Only if no one has changed them since: the targets are compared as they were read.
    yield* sql`UPDATE mini_days SET targets = ${snapshotOf(parseTargets(row.targets))}
      WHERE user_id = ${userId} AND day = ${day} AND targets = ${row.targets}`
  }
})

/** Works out again whether a day is done, from what is there when it runs. */
const recomputeMet = Effect.fn("minis.recomputeMet")(function* (userId: string, day: string) {
  const sql = yield* SqlClient.SqlClient

  yield* repairKeys(userId, day)
  // A day that had run out of nudges plans again when more is now needed, such as after a set was removed.
  yield* sql`
    UPDATE mini_days SET
      met = ${sql.unsafe(MET_NOW)},
      next_nudge_at = CASE WHEN next_nudge_at = 0 AND ${sql.unsafe(MET_NOW)} = 0 THEN NULL ELSE next_nudge_at END
    WHERE user_id = ${userId} AND day = ${day}`
})

/**
 * Gives a day the targets of the settings at `revision`, unless it already has a later
 * revision's. `replan` plans its nudges again, for a change the user made.
 */
const syncDay = Effect.fn("minis.syncDay")(function* (userId: string, day: string, settings: MiniSettings, revision: number, replan: boolean) {
  const sql = yield* SqlClient.SqlClient
  const targets = snapshotOf(settings.targets)

  yield* sql`
    INSERT INTO mini_days (user_id, day, targets, targets_revision) VALUES (${userId}, ${day}, ${targets}, ${revision})
    ON CONFLICT (user_id, day) DO UPDATE SET targets = excluded.targets, targets_revision = excluded.targets_revision,
      next_nudge_at = CASE WHEN ${replan ? 1 : 0} = 1 THEN NULL ELSE mini_days.next_nudge_at END
    WHERE mini_days.targets_revision < excluded.targets_revision`
  yield* recomputeMet(userId, day)
})

/**
 * Last week's targets grown as earned: a target set to grow goes up when it was met on every
 * nudge day of the week before `today`'s. Judged by the settings that held during that week.
 */
const grow = Effect.fn("minis.grow")(function* (userId: string, settings: MiniSettings, today: string) {
  if (!settings.targets.some((target) => target.growBy > 0)) return settings

  const week = weekBefore(today)
  const [rows, entries] = yield* Effect.all([dayRows(userId, week[0]!, week[6]!), entriesOn(userId, week[0]!, week[6]!)])

  const past = week.map((date) => {
    const row = rows.find((item) => item.day === date)

    return { day: date, progress: row ? dayProgress(parseTargets(row.targets), entries.filter((entry) => entry.day === date)) : [] }
  })

  return { ...settings, targets: grownTargets(settings.targets, settings.days, past) }
})

/**
 * Reviews last week once, in the account's own week (accountToday). A write refused because the
 * settings changed meanwhile is worked out again from the new ones, so a save made at the same
 * time (nudges turned off, say) is never undone. Answers the settings as they now stand.
 */
const reviewWeek = Effect.fn("minis.reviewWeek")(function* (userId: string) {
  const time = yield* Clock.currentTimeMillis

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const stored = yield* settingsOf(userId)
    const today = accountToday(stored.settings, time)

    if (today === null || stored.reviewedWeek >= mondayOf(today)) return stored

    const next = yield* grow(userId, stored.settings, today)
    const revision = yield* writeSettings(userId, stored.revision, next, mondayOf(today))

    if (revision !== null) {
      yield* syncDay(userId, today, next, revision, true)

      return { settings: next, reviewedWeek: mondayOf(today), revision } satisfies Stored
    }
  }

  // Refused every time: someone else is writing the settings, and their write reviews the week.
  return yield* settingsOf(userId)
})

/**
 * The kept row for a day, with its targets brought up to date: a day that has not ended where
 * the account is (or any day, before the account has a time zone) takes the latest settings'
 * targets, and one that has ended keeps the ones it had. Last week is reviewed first.
 */
const ensureDay = Effect.fn("minis.ensureDay")(function* (userId: string, day: string) {
  const time = yield* Clock.currentTimeMillis
  const stored = yield* reviewWeek(userId)
  const today = accountToday(stored.settings, time)
  const existing = (yield* dayRows(userId, day, day))[0]
  const follows = today === null || day >= today

  if (!existing || (follows && existing.targetsRevision < stored.revision)) {
    yield* syncDay(userId, day, stored.settings, stored.revision, false)
  }

  return { row: (yield* dayRows(userId, day, day))[0]!, stored }
})

/** Works out again whether a day's targets are all done, after a set is logged or removed. */
const refreshDay = Effect.fn("minis.refreshDay")(function* (userId: string, day: string) {
  yield* ensureDay(userId, day)
  yield* recomputeMet(userId, day)
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
  const time = yield* Clock.currentTimeMillis

  yield* checkSpan(from, to)

  const { settings, revision } = yield* settingsOf(user.id)
  const today = accountToday(settings, time)

  const { rows, entries, nudges, metDays, devices, keys } = yield* Effect.all(
    {
      rows: dayRows(user.id, from, to),
      entries: entriesOn(user.id, from, to),
      // A nudge is done when a set answers it, whatever was last written to its status.
      nudges: sql<MiniNudge>`
        SELECT n.id, n.day, n.exercise, n.unit, n.amount, n.sent_at,
          CASE WHEN EXISTS (SELECT 1 FROM mini_sets s WHERE s.nudge_id = n.id) THEN 'done'
            WHEN n.status = 'skipped' THEN 'skipped' ELSE 'sent' END AS status
        FROM mini_nudges n
        WHERE n.user_id = ${user.id} AND n.day >= ${from} AND n.day <= ${to} ORDER BY n.sent_at, n.id`,
      metDays: sql<{ day: string }>`SELECT day FROM mini_days WHERE user_id = ${user.id} AND met = 1 ORDER BY day`,
      devices: sql<{ endpoint: string }>`SELECT endpoint FROM push_subscriptions WHERE user_id = ${user.id} ORDER BY id`,
      keys: vapidKeys,
    },
    { concurrency: 3 },
  )

  const days = daysFrom(from, to).map((day): MiniDay => {
    const row = rows.find((item) => item.day === day)
    // A day still underway shows the settings as they are, as it will once it is next touched.
    const follows = (today === null || day >= today) && (!row || row.targetsRevision < revision)
    const targets = row && !follows ? parseTargets(row.targets) : settings.targets
    const progress = dayProgress(targets, entries.filter((entry) => entry.day === day))

    return { day, targets, progress, met: isMet(progress) }
  })

  return {
    settings,
    days,
    entries,
    nudges,
    metDays: metDays.map((row) => row.day),
    // The endpoints let a browser tell whether its own subscription belongs to this account.
    push: { publicKey: keys.publicKey, devices: devices.length, endpoints: devices.map((row) => row.endpoint) },
  }
})

const sameTarget = (a: Pick<MiniTarget, "exercise" | "unit">) => (b: Pick<MiniTarget, "exercise" | "unit">) =>
  sameExercise(a.exercise, b.exercise) && a.unit === b.unit

/**
 * Only what the user changed overrides what is saved. A target sent with the daily amount the
 * form started from (`base`) keeps the saved one, which may have grown since the form was loaded,
 * on this device or another.
 */
const keepGrowth = (
  submitted: MiniSettings,
  base: ReadonlyArray<Pick<MiniTarget, "exercise" | "unit" | "daily">>,
  saved: MiniSettings,
): MiniSettings => ({
  ...submitted,
  targets: submitted.targets.map((target) => {
    const from = base.find(sameTarget(target))
    const now = saved.targets.find(sameTarget(target))

    return from && now && target.daily === from.daily ? { ...target, daily: now.daily } : target
  }),
})

/** How the settings change: from what is saved now to what to save. */
type SettingsChange = (saved: MiniSettings) => Effect.Effect<MiniSettings, Invalid>

/**
 * Changes the settings. `change` is worked out from the settings as saved when the write goes
 * in, and worked out again if they changed meanwhile, so two saves, the coach and the weekly
 * review never undo one another. Last week is reviewed first, by the settings that held then.
 * The day the user is on takes the new targets straight away, and plans its nudges again; that
 * day is read in the new time zone, which is the device's, or is `deviceDay` without one. `base`
 * is the targets the change started from (keepGrowth); without it, what was saved stands in.
 * Answers the settings as saved.
 */
export const changeMinis = Effect.fn("changeMinis")(function* (
  deviceDay: string,
  change: SettingsChange,
  base?: ReadonlyArray<Pick<MiniTarget, "exercise" | "unit" | "daily">>,
) {
  const user = yield* CurrentUser
  const time = yield* Clock.currentTimeMillis

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const stored = yield* settingsOf(user.id)
    const today = accountToday(stored.settings, time)
    const week = today !== null && stored.reviewedWeek < mondayOf(today) ? mondayOf(today) : null
    const saved = week !== null && today !== null ? yield* grow(user.id, stored.settings, today) : stored.settings
    const submitted = yield* change(saved)
    const settings = keepGrowth(submitted, base ?? stored.settings.targets, saved)
    // The first save with a time zone starts the weeks: there is no week before it to review.
    const first = today === null ? accountToday(settings, time) : null
    const revision = yield* writeSettings(user.id, stored.revision, settings, week ?? (first === null ? null : mondayOf(first)))

    if (revision === null) continue

    // The day this save is for, and the account's today if that differs, take these targets
    // unless a later save has already given them its own.
    const day = accountToday(settings, time) ?? deviceDay

    yield* syncDay(user.id, day, settings, revision, true)

    if (today !== null && today !== day) yield* syncDay(user.id, today, settings, revision, true)

    return settings
  }

  return yield* new Invalid({ reason: "The settings were changing at the same time. Try again." })
})

/** Saves settings as a screen sends them, whole. */
export const updateMinis = (
  deviceDay: string,
  submitted: MiniSettings,
  base?: ReadonlyArray<Pick<MiniTarget, "exercise" | "unit" | "daily">>,
) => changeMinis(deviceDay, () => Effect.succeed(submitted), base)

/** Pauses nudges until a day, or ends a pause with null, changing nothing else that is saved. */
export const pauseMinis = (deviceDay: string, until: string | null) =>
  changeMinis(deviceDay, (saved) => Effect.succeed({ ...saved, pausedUntil: until }))

export interface MiniSetInput {
  readonly day: string
  readonly exercise: string
  readonly amount: number
  readonly unit?: MiniUnit | undefined
  readonly nudgeId?: number | undefined
  readonly clientKey?: string | undefined
}

/** Where a set goes: the day and exercise it counts toward, and the nudge it answers. */
interface SetPlace {
  readonly day: string
  readonly exercise: string
  readonly unit: MiniUnit | undefined
  readonly nudgeId: number | null
}

/**
 * Logs what was done. Its unit is the day's target for the exercise, when there is one.
 *
 * A set that answers a nudge is what the nudge asked for, on the nudge's own day, whenever and on
 * whichever device it is answered, and a nudge takes one set: answering it again answers with
 * that set. Each step can be repeated, so a retry after a failure part of the way through (with
 * the same client key, or for the same nudge) finishes the job rather than logging twice.
 *
 * A phone a long way east of the account's time zone can be a day ahead of it, so the day after
 * the account's today can be logged; its targets keep following the settings until it is over.
 * Anything later cannot.
 */
export const logMini = Effect.fn("logMini")(function* (input: MiniSetInput) {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser
  const time = yield* Clock.currentTimeMillis

  const finish = Effect.fn("minis.finishSet")(function* (entry: MiniEntry) {
    if (entry.nudgeId !== null) yield* sql`UPDATE mini_nudges SET status = 'done' WHERE id = ${entry.nudgeId} AND user_id = ${user.id}`

    yield* refreshDay(user.id, entry.day)

    return entry
  })

  if (input.clientKey !== undefined) {
    const again = yield* sql<MiniEntry>`
      SELECT ${sql.unsafe(ENTRY_COLUMNS)} FROM mini_sets WHERE user_id = ${user.id} AND client_key = ${input.clientKey}`

    if (again[0]) return yield* finish(again[0])
  }

  let set: SetPlace = { day: input.day, exercise: input.exercise, unit: input.unit, nudgeId: null }

  if (input.nudgeId !== undefined) {
    const nudge = (yield* sql<Pick<MiniNudge, "id" | "day" | "exercise" | "unit">>`
      SELECT id, day, exercise, unit FROM mini_nudges WHERE id = ${input.nudgeId} AND user_id = ${user.id}`)[0]

    if (!nudge) return yield* new NotFound({ what: `Nudge ${input.nudgeId}` })

    set = { day: nudge.day, exercise: nudge.exercise, unit: nudge.unit, nudgeId: nudge.id }
  } else {
    const today = accountToday((yield* settingsOf(user.id)).settings, time)

    if (today !== null && set.day > shiftDay(today, 1)) return yield* new Invalid({ reason: "That day has not started yet" })
  }

  const { row } = yield* ensureDay(user.id, set.day)
  const target = parseTargets(row.targets).find((item) => sameExercise(item.exercise, set.exercise))

  // A nudge's answer is what the nudge asked for, even if the day's targets have changed since.
  // Anything else takes the day's target for the exercise, for its unit and the way its name is written.
  const exercise = set.nudgeId !== null ? set.exercise : (target?.exercise ?? set.exercise)
  const unit = set.nudgeId !== null ? (set.unit ?? "reps") : (target?.unit ?? set.unit ?? "reps")

  // A second answer to the same nudge is left out by its unique index, and answered with the first.
  const rows = yield* sql<MiniEntry>`
    INSERT OR IGNORE INTO mini_sets (user_id, day, exercise, exercise_key, unit, amount, nudge_id, client_key, created_at)
    VALUES (${user.id}, ${set.day}, ${exercise}, ${exerciseKey(exercise)}, ${unit}, ${input.amount}, ${set.nudgeId},
      ${input.clientKey ?? null}, ${time})
    RETURNING ${sql.unsafe(ENTRY_COLUMNS)}`

  const entry =
    rows[0] ??
    (yield* sql<MiniEntry>`
      SELECT ${sql.unsafe(ENTRY_COLUMNS)} FROM mini_sets
      WHERE user_id = ${user.id} AND (nudge_id = ${set.nudgeId} OR client_key = ${input.clientKey ?? null})`)[0]

  if (!entry) return yield* new Invalid({ reason: "That set could not be logged. Try again." })

  return yield* finish(entry)
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

/**
 * Turns nudges on in a browser. A browser already known moves to this account. `origin` is the
 * address the request came to, which the transport supplies (src/functions/api.ts, src/server/http.ts).
 */
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

/** What came of pushing to a user's browsers. `cancelled`: the last check said not to send, and nothing was. */
interface Delivery {
  readonly sent: number
  readonly failed: number
  readonly cancelled: boolean
}

/**
 * Sends one message to every browser of a user, forgetting the ones the push service says are
 * gone. A subscription is only forgotten if it is still the one that was sent to: a browser that
 * subscribed again meanwhile has new keys, and stays. The pushes are all encrypted and signed
 * first; `stillWanted` is asked after that, and nothing is posted if it says no.
 */
const pushToUser = Effect.fn("minis.pushToUser")(function* (
  userId: string,
  message: PushMessage,
  time: number,
  expiresAt?: number,
  stillWanted: Effect.Effect<boolean, SqlError, SqlClient.SqlClient> = Effect.succeed(true),
) {
  const sql = yield* SqlClient.SqlClient
  const keys = yield* vapidKeys
  const subscriptions = yield* subscriptionsOf(userId)

  const forget = (subscription: SubscriptionRow) =>
    Effect.asVoid(sql`
      DELETE FROM push_subscriptions
      WHERE id = ${subscription.id} AND user_id = ${userId} AND p256dh = ${subscription.p256dh} AND auth = ${subscription.auth}`)

  const prepared = yield* Effect.forEach(
    subscriptions,
    (subscription) =>
      Effect.promise(
        (): Promise<PreparedPush | "gone" | "failed"> =>
          preparePush(subscription, message, keys, vapidSubject(subscription.origin), time, expiresAt).catch(() => "failed"),
      ).pipe(Effect.map((push) => ({ subscription, push }))),
    { concurrency: 4 },
  )

  if (!(yield* stillWanted)) return { sent: 0, failed: 0, cancelled: true } satisfies Delivery

  const outcomes = yield* Effect.forEach(
    prepared,
    ({ subscription, push }) =>
      (push === "gone" || push === "failed"
        ? Effect.succeed<PushOutcome>(push)
        : Effect.promise((): Promise<PushOutcome> => dispatchPush(push).catch(() => "failed"))
      ).pipe(Effect.tap((outcome) => (outcome === "gone" ? forget(subscription) : Effect.void))),
    { concurrency: 4 },
  )

  return {
    sent: outcomes.filter((outcome) => outcome === "sent").length,
    failed: outcomes.filter((outcome) => outcome !== "sent").length,
    cancelled: false,
  } satisfies Delivery
})

/** The least time between two test notifications from one account. */
const TEST_INTERVAL_MS = 30_000

/** Sends a notification now, to check nudges reach the phone. At most one every 30 seconds. */
export const testPush = Effect.fn("testPush")(function* () {
  const sql = yield* SqlClient.SqlClient
  const user = yield* CurrentUser
  const time = yield* Clock.currentTimeMillis

  const allowed = yield* sql<{ id: string }>`
    UPDATE users SET push_tested_at = ${time}
    WHERE id = ${user.id} AND (push_tested_at IS NULL OR push_tested_at <= ${time - TEST_INTERVAL_MS}) RETURNING id`

  if (allowed.length === 0) return yield* new Invalid({ reason: "A test was just sent. Wait half a minute before sending another." })

  const { sent, failed } = yield* pushToUser(
    user.id,
    { title: "Nudges are on", body: "This is what a mini workout nudge looks like.", url: "/minis", tag: "mini-test" },
    time,
  )

  return { sent, failed }
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

    const outcome = yield* nudgeUser(user.id, time, random).pipe(
      Effect.catch((error) => Effect.as(Effect.logError("A mini workout nudge failed", error), false)),
    )

    if (outcome) sent += 1
  }

  return { checked: users.length, sent } satisfies NudgeRun
})

/** How soon to try again when no push service took a nudge. */
const FAILED_RETRY_MS = 10 * MINUTE

/** What a plan change needs the day to be, as the database sees it when it writes. */
type DayIs = "any" | "met" | "open"

/**
 * Sends the nudge due for one user, if there is one. Answers whether one was sent.
 *
 * A day's `next_nudge_at` is null until planned, 0 once nothing more will be sent (every target
 * done, or no time left for one), or when the next one is due. A run claims a due nudge by moving
 * that time on before it sends, and only a run holding the claim may plan the next one, so two
 * runs at once send one nudge, and a settings change made meanwhile (which plans the day again)
 * is never overwritten. Every one of those changes also needs the settings to be the ones this
 * run planned under (`revision`, read after the day and last week's review are settled), and
 * closing the day or recording a nudge needs the day to be as the database finds it then (done,
 * or not), so a run that read something since changed sends nothing. The last check, which
 * also needs the exercise asked for to be unfinished, is made once the pushes are encrypted and
 * signed, just before they are posted. However it was planned, no nudge goes sooner than the gap
 * after the last one that reached the user, on whatever day that was.
 */
const nudgeUser = Effect.fn("minis.nudgeUser")(function* (userId: string, time: number, random: () => number) {
  const sql = yield* SqlClient.SqlClient
  const before = yield* settingsOf(userId)

  if (!isTimeZone(before.settings.timeZone)) return false

  // Settles the day and last week's review first, which may change the settings: plan under what they are after.
  const { row, stored } = yield* ensureDay(userId, localTime(before.settings.timeZone, time).day)
  const { settings, revision } = stored

  if (!isTimeZone(settings.timeZone)) return false

  const now = localTime(settings.timeZone, time)

  if (row.day !== now.day || !nudgesOpen(settings, now)) return false

  if (row.nextNudgeAt === 0 || (row.nextNudgeAt !== null && row.nextNudgeAt > time)) return false

  const targets = parseTargets(row.targets)
  const progress = dayProgress(targets, yield* entriesOn(userId, now.day, now.day))
  const minutesLeft = settings.endMinute - now.minute
  const gap = settings.gapMinutes * MINUTE
  const lastRun = time + lastRunWithin(minutesLeft) * MINUTE
  const current = sql`EXISTS (SELECT 1 FROM users WHERE id = ${userId} AND mini_revision = ${revision})`
  const dayIs = (state: DayIs) => sql.unsafe(state === "any" ? "1 = 1" : `${MET_NOW} = ${state === "met" ? 1 : 0}`)

  /** Moves the plan on from what this run read, unless someone else already has, the settings changed, or the day is not `state`. */
  const replace = (from: number | null, to: number | null, state: DayIs = "any") =>
    Effect.map(
      sql<{ day: string }>`
        UPDATE mini_days SET next_nudge_at = ${to}
        WHERE user_id = ${userId} AND day = ${now.day} AND next_nudge_at IS ${from} AND ${current} AND ${dayIs(state)}
        RETURNING day`,
      (rows) => rows.length > 0,
    )

  // The last nudge on any day: one sent just before midnight still keeps the gap after it.
  const last = (yield* sql<{ exercise: string; sentAt: number }>`
    SELECT exercise, sent_at FROM mini_nudges WHERE user_id = ${userId} ORDER BY sent_at DESC, id DESC LIMIT 1`)[0]

  const earliest = last ? last.sentAt + gap : time

  if (isMet(progress)) {
    yield* replace(row.nextNudgeAt, 0, "met")

    return false
  }

  if (row.nextNudgeAt === null) {
    // Soon after the window opens, and never past the last run that can still send it.
    const delay = firstNudgeDelay(nudgesNeeded(targets, progress), minutesLeft, random)
    const due = Math.max(Math.min(time + delay * MINUTE, lastRun), earliest)

    if (due > lastRun) {
      yield* replace(null, 0)

      return false
    }

    if (due > time) {
      yield* replace(null, due)

      return false
    }
  } else if (earliest > time) {
    yield* replace(row.nextNudgeAt, earliest > lastRun ? 0 : earliest)

    return false
  }

  // The claim: until this run plans the next nudge, no other run sees one due. Its own value, so
  // nothing else could hold the same one.
  const claim = time + gap + (crypto.getRandomValues(new Uint32Array(1))[0]! % 1000)

  if (!(yield* replace(row.nextNudgeAt, claim))) return false

  const training = yield* sql<{ id: number }>`
    SELECT id FROM workouts WHERE user_id = ${userId} AND finished_at IS NULL AND started_at > ${time - WORKOUT_HOLD_MS} LIMIT 1`

  if (training.length > 0) {
    yield* replace(claim, time + WORKOUT_RETRY_MS)

    return false
  }

  const ask = chooseNudge(targets, progress, minutesLeft, settings.gapMinutes, last?.exercise ?? null, random)

  if (ask === null) {
    // Done, as far as this run saw. If a set was taken back meanwhile, plan the day again instead.
    if (!(yield* replace(claim, 0, "met"))) yield* replace(claim, null)

    return false
  }

  // Whether this run may still send: it holds the claim, the settings are the ones it planned
  // under, the day is not done, and neither is the exercise it asks for.
  const holds = sql`
    EXISTS (SELECT 1 FROM mini_days WHERE user_id = ${userId} AND day = ${now.day} AND next_nudge_at = ${claim}
      AND ${dayIs("open")})
    AND ${current}
    AND COALESCE((SELECT SUM(amount) FROM mini_sets WHERE user_id = ${userId} AND day = ${now.day}
      AND exercise_key = ${exerciseKey(ask.exercise)} AND unit = ${ask.unit}), 0) < ${ask.target}`

  const nudge = (yield* sql<{ id: number }>`
    INSERT INTO mini_nudges (user_id, day, exercise, unit, amount, sent_at)
    SELECT ${userId}, ${now.day}, ${ask.exercise}, ${ask.unit}, ${ask.amount}, ${time} WHERE ${holds}
    RETURNING id`)[0]

  if (!nudge) {
    yield* replace(claim, null)

    return false
  }

  const message = nudgeMessage(ask, random)
  const isWanted = Effect.map(sql<{ ok: number }>`SELECT 1 AS ok WHERE ${holds}`, (rows) => rows.length > 0)

  // Kept by the push service no longer than the window stays open: a nudge after it closes is no use.
  const delivery = yield* pushToUser(
    userId,
    { ...message, url: `/minis?nudge=${nudge.id}`, tag: `mini-${nudge.id}` },
    time,
    time + minutesLeft * MINUTE,
    isWanted,
  )

  if (delivery.cancelled) {
    // Something changed after it was recorded: it never went, so it is forgotten, and the day planned again.
    yield* sql`DELETE FROM mini_nudges WHERE id = ${nudge.id}`
    yield* replace(claim, null)

    return false
  }

  if (delivery.sent === 0) {
    // It reached no one: forget it, so it neither counts toward the gap nor waits to be answered, and try again soon.
    yield* sql`DELETE FROM mini_nudges WHERE id = ${nudge.id}`
    yield* replace(claim, time + FAILED_RETRY_MS)

    return false
  }

  // Planned as if this one is done. Until every target is, another check is planned, so a nudge
  // passed over or half done is made up later in the day.
  const needed = Math.max(1, nudgesNeeded(targets, afterAsk(progress, ask)))
  const delay = nextNudgeDelay(needed, minutesLeft, settings.gapMinutes, random)

  yield* replace(claim, delay === null ? 0 : time + delay * MINUTE)

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
