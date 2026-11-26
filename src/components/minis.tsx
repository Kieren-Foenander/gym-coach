import { Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { ChevronIcon, CloseIcon } from "~/components/icons"
import { Button, buttonClass, Card, cardClass, ErrorNote, parseNumber, SectionTitle, Sheet, Stepper, TextInput, useAction } from "~/components/ui"
import { ExercisePicker } from "~/components/exercise"
import { shiftDay } from "~/domain/days"
import {
  dayFraction,
  describeAmount,
  formatMiniAmount,
  MINI_LIMITS,
  MINI_UNITS,
  miniFormFor,
  readMiniForm,
  remainingOf,
  suggestTarget,
  targetFormFor,
  WEEKDAY_LETTERS,
  WEEKDAY_SHORT,
  type MiniEntry,
  type MiniForm,
  type MiniProgress,
  type MiniSettings,
  type MiniTargetForm,
} from "~/domain/minis"
import { CHOICE_STATES, MINI_DAY_STATES, PUSH_STATES, SAVE_STATES, testIds, TOGGLE_STATES, type PushState } from "~/domain/test-ids"
import { deleteMini, subscribePush, testPush, unsubscribePush, updateMinis } from "~/functions/api"
import { currentSubscription, deviceTimeZone, pushSupport, subscribe, unsubscribe } from "~/push"
import type { MiniDay, MiniNudge } from "~/server/minis"

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })

const UNIT_LABELS = { reps: "Reps", seconds: "Seconds" } as const

/** A bar filling up towards a target. */
function ProgressBar({ fraction, label }: { readonly fraction: number; readonly label: string }) {
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-raised"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
    >
      <div className={`h-full rounded-full ${fraction >= 1 ? "bg-mini" : "bg-mini/70"}`} style={{ width: `${Math.min(1, fraction) * 100}%` }} />
    </div>
  )
}

// ---------------------------------------------------------------- Today

interface MiniCardProps {
  /** Today, or undefined before the device's day is known. */
  readonly day: MiniDay | undefined
}

/** Today's mini workouts on the home screen, leading to their screen. Invites setting them up when there are none. */
export function MiniCard({ day }: MiniCardProps) {
  const progress = day?.progress ?? []

  return (
    <>
      <SectionTitle>Mini workouts</SectionTitle>
      <Link to="/minis" search={{}} className={`${cardClass} block active:bg-raised`} data-testid={testIds.today.miniCard}>
        <div className="flex items-center gap-3">
          {progress.length === 0 ? (
            <p className="min-w-0 flex-1 text-muted">
              Set daily targets, such as 100 push-ups, and get nudged to do a few at a time through the day.
            </p>
          ) : (
            <ul className="min-w-0 flex-1 space-y-2.5">
              {progress.map((item) => (
                <li key={item.exercise} data-testid={testIds.today.mini(item.exercise)} data-value={item.done}>
                  <div className="flex items-baseline justify-between gap-3 pb-1">
                    <span className="truncate font-semibold">{item.exercise}</span>
                    <span className="tabular shrink-0 text-sm text-muted">
                      <span className="font-semibold text-white">{formatMiniAmount(item.unit, item.done)}</span> /{" "}
                      {formatMiniAmount(item.unit, item.target)}
                    </span>
                  </div>
                  <ProgressBar fraction={item.done / item.target} label={`${item.exercise} today`} />
                </li>
              ))}
            </ul>
          )}
          <ChevronIcon className="size-5 shrink-0 text-faint" />
        </div>
      </Link>
    </>
  )
}

// ---------------------------------------------------------------- today's progress

interface DayProgressProps {
  readonly day: MiniDay
  readonly onLog: (exercise: string, amount: number) => Promise<boolean>
  readonly pending: boolean
  readonly chunks: ReadonlyMap<string, number>
}

/** Each target today: how far it is, and a quick way to log a set of it. */
export function DayProgress({ day, onLog, pending, chunks }: DayProgressProps) {
  const fraction = dayFraction(day.progress)

  return (
    <section
      className="relative overflow-hidden rounded-[2rem] border border-mini/25 bg-surface p-5"
      data-testid={testIds.minis.day}
      data-state={day.met ? MINI_DAY_STATES.met : MINI_DAY_STATES.open}
    >
      <div className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-mini/15 blur-3xl" aria-hidden="true" />
      <div className="relative">
        <p className="eyebrow text-mini">{day.met ? "Every target done" : `${Math.round(fraction * 100)}% of today`}</p>
        <div className="mt-4 space-y-5">
          {day.progress.map((item) => (
            <ProgressRow key={item.exercise} item={item} chunk={chunks.get(item.exercise) ?? 10} pending={pending} onLog={onLog} />
          ))}
        </div>
      </div>
    </section>
  )
}

interface ProgressRowProps {
  readonly item: MiniProgress
  readonly chunk: number
  readonly pending: boolean
  readonly onLog: (exercise: string, amount: number) => Promise<boolean>
}

function ProgressRow({ item, chunk, pending, onLog }: ProgressRowProps) {
  const left = remainingOf(item)
  const suggested = left > 0 ? Math.min(chunk, left) : chunk
  const [amount, setAmount] = useState(String(suggested))
  const value = parseNumber(amount)
  const valid = value !== null && Number.isInteger(value) && value >= 1 && value <= MINI_LIMITS.daily

  useEffect(() => setAmount(String(suggested)), [suggested])

  return (
    <div data-testid={testIds.minis.progress(item.exercise)} data-value={item.done} data-state={left === 0 ? MINI_DAY_STATES.met : MINI_DAY_STATES.open}>
      <div className="flex items-baseline justify-between gap-3 pb-1.5">
        <h3 className="display truncate text-3xl">{item.exercise}</h3>
        <p className="tabular shrink-0 text-muted">
          <span className="display text-2xl text-white">{formatMiniAmount(item.unit, item.done)}</span> / {formatMiniAmount(item.unit, item.target)}
        </p>
      </div>
      <ProgressBar fraction={item.done / item.target} label={`${item.exercise} today`} />
      <div className="mt-3 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Stepper testId={testIds.minis.amount} label={item.unit === "seconds" ? "Seconds" : "Reps"} value={amount} step={5} onChange={setAmount} />
        </div>
        <Button
          variant="primary"
          className="h-14 shrink-0"
          disabled={pending || !valid}
          data-testid={testIds.minis.log}
          onClick={() => void (value === null ? null : onLog(item.exercise, value))}
        >
          Log
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- a nudge

interface NudgeCardProps {
  readonly nudge: MiniNudge
  readonly pending: boolean
  readonly onDone: (amount: number) => void
  readonly onSkip: () => void
}

/** The nudge a notification opened: do what it asked (or a different amount), or pass. */
export function NudgeCard({ nudge, pending, onDone, onSkip }: NudgeCardProps) {
  const [amount, setAmount] = useState(String(nudge.amount))
  const value = parseNumber(amount)
  const valid = value !== null && Number.isInteger(value) && value >= 1 && value <= MINI_LIMITS.daily

  return (
    <section className="mb-4 animate-pop rounded-[2rem] border border-mini/40 bg-mini/[0.08] p-5" data-testid={testIds.minis.nudge} data-state={nudge.status}>
      <p className="eyebrow text-mini">Nudge · {timeFormat.format(nudge.sentAt)}</p>
      <h2 className="display pt-1 text-5xl">{describeAmount(nudge.exercise, nudge.unit, nudge.amount)}</h2>
      {nudge.status === "sent" ? (
        <>
          <div className="mt-4">
            <Stepper label={nudge.unit === "seconds" ? "Seconds done" : "Reps done"} value={amount} step={5} onChange={setAmount} />
          </div>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" disabled={pending} data-testid={testIds.minis.nudgeSkip} onClick={onSkip}>
              Not now
            </Button>
            <Button
              variant="primary"
              className="flex-[2]"
              disabled={pending || !valid}
              data-testid={testIds.minis.nudgeDone}
              onClick={() => value !== null && onDone(value)}
            >
              Done {value !== null && valid ? formatMiniAmount(nudge.unit, value) : ""}
            </Button>
          </div>
        </>
      ) : (
        <p className="pt-2 text-muted">{nudge.status === "done" ? "Logged. Nice work." : "Passed on. The rest moves to later nudges."}</p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- what was done

interface EntryListProps {
  readonly entries: ReadonlyArray<MiniEntry>
}

/** Today's sets, newest first, each with a way to take it back. */
export function EntryList({ entries }: EntryListProps) {
  const { act, pending, error } = useAction()

  if (entries.length === 0) return <p className="text-sm text-faint">Nothing logged yet today.</p>

  return (
    <Card>
      <ErrorNote message={error} />
      <ul className="divide-y divide-white/5">
        {entries.toReversed().map((entry) => (
          <li key={entry.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0" data-testid={testIds.minis.entry(entry.id)}>
            <span className="tabular w-16 shrink-0 text-sm text-muted">{timeFormat.format(entry.createdAt)}</span>
            <span className="min-w-0 flex-1 truncate font-semibold">{describeAmount(entry.exercise, entry.unit, entry.amount)}</span>
            {entry.nudgeId === null ? null : <span className="eyebrow shrink-0 text-xs text-mini">Nudge</span>}
            <button
              type="button"
              aria-label={`Remove ${describeAmount(entry.exercise, entry.unit, entry.amount)}`}
              data-testid={testIds.minis.deleteEntry}
              disabled={pending}
              onClick={() => void act(() => deleteMini({ data: { entryId: entry.id } }))}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-faint active:bg-raised"
            >
              <CloseIcon className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ---------------------------------------------------------------- settings

interface ChoiceProps {
  readonly testId: string
  readonly label: string
  readonly selected: boolean
  readonly onClick: () => void
  readonly className?: string
}

function Choice({ testId, label, selected, onClick, className = "" }: ChoiceProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-testid={testId}
      data-state={selected ? CHOICE_STATES.selected : CHOICE_STATES.unselected}
      onClick={onClick}
      className={`min-h-11 rounded-full px-4 font-semibold transition-colors ${selected ? "bg-mini text-ink" : "bg-raised text-muted"} ${className}`}
    >
      {label}
    </button>
  )
}

interface SettingsFormProps {
  readonly settings: MiniSettings
  /** The device's today, which takes new targets at once. */
  readonly today: string
}

/** The targets and when nudges may come, saved together. */
export function MiniSettingsForm({ settings, today }: SettingsFormProps) {
  const { act, pending, error } = useAction()
  const [form, setForm] = useState<MiniForm>(() => miniFormFor(settings))
  // The targets the form started from, so the server keeps any that grew since (keepGrowth in src/server/minis.ts).
  const [base, setBase] = useState(settings.targets)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [picking, setPicking] = useState(false)

  const edit = (next: MiniForm) => {
    setForm(next)
    setSaved(false)
    setProblem(null)
  }

  const editTarget = (index: number, patch: Partial<MiniTargetForm>) =>
    edit({ ...form, targets: form.targets.map((target, at) => (at === index ? { ...target, ...patch } : target)) })

  const toggleDay = (day: number) =>
    edit({ ...form, days: form.days.includes(day) ? form.days.filter((item) => item !== day) : [...form.days, day] })

  const save = () => {
    const next = readMiniForm(form, deviceTimeZone(), settings.pausedUntil)

    if (!next.ok) {
      setProblem(next.problem)

      return
    }

    void act(async () => {
      // What was saved, which may differ: a target saved unchanged keeps growth it earned meanwhile.
      const stored = await updateMinis({ data: { day: today, settings: next.settings, base } })

      setForm(miniFormFor(stored))
      setBase(stored.targets)
      setSaved(true)
    })
  }

  return (
    <Card>
      <h3 className="eyebrow pb-3 text-muted">Daily targets</h3>
      <div className="space-y-4">
        {form.targets.map((target, index) => (
          <fieldset key={target.exercise} className="space-y-3 rounded-2xl bg-raised/50 p-3" data-testid={testIds.minis.target(target.exercise)}>
            <legend className="sr-only">{target.exercise}</legend>
            <div className="flex items-center justify-between gap-3">
              <span className="display truncate text-2xl">{target.exercise}</span>
              <button
                type="button"
                className="min-h-11 px-2 text-sm font-semibold text-muted"
                data-testid={testIds.minis.removeTarget}
                onClick={() => edit({ ...form, targets: form.targets.filter((_, at) => at !== index) })}
              >
                Remove
              </button>
            </div>
            <div className="flex gap-2" role="group" aria-label="Counted in">
              {MINI_UNITS.map((unit) => (
                <Choice
                  key={unit}
                  testId={testIds.minis.targetUnit(unit)}
                  label={UNIT_LABELS[unit]}
                  selected={target.unit === unit}
                  onClick={() => editTarget(index, { unit })}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Stepper testId={testIds.minis.targetDaily} label="A day" value={target.daily} step={10} onChange={(daily) => editTarget(index, { daily })} />
              <Stepper testId={testIds.minis.targetChunk} label="A nudge" value={target.chunk} step={5} onChange={(chunk) => editTarget(index, { chunk })} />
            </div>
            <Stepper
              testId={testIds.minis.targetGrow}
              label="Grow each week by"
              value={target.growBy}
              step={5}
              onChange={(growBy) => editTarget(index, { growBy })}
            />
            <p className="text-xs text-faint">
              {target.growBy === "0" || target.growBy === ""
                ? "Stays the same. Set a number to raise it after a week with every nudge day done."
                : `Rises by ${target.growBy} after a week with every nudge day done.`}
            </p>
          </fieldset>
        ))}
        {form.targets.length < MINI_LIMITS.targets ? (
          <Button className="w-full" data-testid={testIds.minis.addTarget} onClick={() => setPicking(true)}>
            Add an exercise
          </Button>
        ) : null}
      </div>

      <h3 className="eyebrow pb-3 pt-6 text-muted">Nudges</h3>
      <button
        type="button"
        role="switch"
        aria-checked={form.nudges}
        data-testid={testIds.minis.nudges}
        data-state={form.nudges ? TOGGLE_STATES.on : TOGGLE_STATES.off}
        onClick={() => edit({ ...form, nudges: !form.nudges })}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl bg-raised/50 px-4"
      >
        <span className="font-semibold">Send nudges</span>
        <span className={`flex h-7 w-12 items-center rounded-full p-0.5 transition-colors ${form.nudges ? "bg-mini" : "bg-line"}`}>
          <span className={`size-6 rounded-full bg-white transition-transform ${form.nudges ? "translate-x-5" : ""}`} />
        </span>
      </button>
      <p className="pb-3 pt-1.5 text-sm text-faint">At random times in the window, each asking for what keeps you on course for the day.</p>

      <span className="mb-1.5 block text-sm text-muted">On</span>
      <div className="grid grid-cols-7 gap-1" role="group" aria-label="Days nudges come on">
        {WEEKDAY_LETTERS.map((letter, day) => (
          <button
            key={WEEKDAY_SHORT[day]}
            type="button"
            aria-label={WEEKDAY_SHORT[day]}
            aria-pressed={form.days.includes(day)}
            data-testid={testIds.minis.weekday(day)}
            data-state={form.days.includes(day) ? CHOICE_STATES.selected : CHOICE_STATES.unselected}
            onClick={() => toggleDay(day)}
            className={`h-11 rounded-full font-semibold ${form.days.includes(day) ? "bg-mini text-ink" : "bg-raised text-muted"}`}
          >
            {letter}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 pt-4">
        <label className="block">
          <span className="mb-1.5 block text-sm text-muted">From</span>
          <TextInput data-testid={testIds.minis.start} inputMode="numeric" value={form.start} onChange={(event) => edit({ ...form, start: event.target.value })} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-muted">Until</span>
          <TextInput data-testid={testIds.minis.end} inputMode="numeric" value={form.end} onChange={(event) => edit({ ...form, end: event.target.value })} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-muted">Gap (min)</span>
          <TextInput data-testid={testIds.minis.gap} inputMode="numeric" value={form.gap} onChange={(event) => edit({ ...form, gap: event.target.value })} />
        </label>
      </div>
      <p className="pt-1.5 text-sm text-faint">Nothing comes outside these hours, or while a workout is open.</p>

      <ErrorNote message={problem ?? error} />
      <Button
        variant="primary"
        className="mt-5 w-full"
        disabled={pending}
        data-testid={testIds.minis.save}
        data-state={saved && !pending ? SAVE_STATES.saved : SAVE_STATES.unsaved}
        onClick={save}
      >
        {saved && !pending ? "Saved" : "Save"}
      </Button>

      {picking ? (
        <Sheet title="Add an exercise" onClose={() => setPicking(false)}>
          <div className="pb-6">
            <ExercisePicker
              taken={form.targets.map((target) => target.exercise)}
              group="Chest"
              disabled={false}
              onPick={(exercise) => {
                edit({ ...form, targets: [...form.targets, targetFormFor(suggestTarget(exercise))] })
                setPicking(false)
              }}
            />
          </div>
        </Sheet>
      ) : null}
    </Card>
  )
}

interface PauseProps {
  readonly settings: MiniSettings
  readonly today: string
}

/** A day off from nudges, or back on. */
export function PauseNudges({ settings, today }: PauseProps) {
  const { act, pending, error } = useAction()
  const paused = settings.pausedUntil !== null && settings.pausedUntil > today

  if (!settings.nudges || settings.targets.length === 0) return null

  const setPause = (pausedUntil: string | null) =>
    void act(async () => {
      await updateMinis({
        data: { day: today, settings: { ...settings, timeZone: settings.timeZone || deviceTimeZone(), pausedUntil }, base: settings.targets },
      })
    })

  return (
    <div className="pt-3">
      <ErrorNote message={error} />
      {paused ? (
        <Button className="w-full" disabled={pending} data-testid={testIds.minis.resume} onClick={() => setPause(null)}>
          Nudges paused today. Turn them back on
        </Button>
      ) : (
        <Button className="w-full" disabled={pending} data-testid={testIds.minis.pauseToday} onClick={() => setPause(shiftDay(today, 1))}>
          No more nudges today
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- this browser

const PUSH_NOTES = {
  unsupported: "This browser cannot show nudges. On an iPhone, open the app from your home screen.",
  install: "On an iPhone, nudges come to the app on your home screen. In Safari, tap Share, then Add to Home Screen, and open it from there.",
  blocked: "Notifications are off for this app. Turn them on in Settings, Notifications, Gym, then come back here.",
  off: "Nudges are not coming to this device yet.",
  on: "Nudges come to this device.",
} as const satisfies Record<PushState, string>

interface PushCardProps {
  readonly publicKey: string
  /** The push addresses this account has nudges going to, this browser's or others'. */
  readonly endpoints: ReadonlyArray<string>
}

/**
 * Turns nudges on or off on this device, and sends a test. Nudges are on here only when this
 * browser's subscription is one the server holds for this account; a subscription it holds for
 * no one, or for someone else, shows as off, and turning nudges on sends it again.
 */
export function PushCard({ publicKey, endpoints }: PushCardProps) {
  const { act, pending, error } = useAction()
  const [state, setState] = useState<PushState | null>(null)
  const [tested, setTested] = useState<string | null>(null)
  const known = endpoints.join(" ")

  useEffect(() => {
    const support = pushSupport()

    if (support !== "ready") {
      setState(support)

      return
    }

    void currentSubscription().then((subscription) => setState(subscription && known.split(" ").includes(subscription.endpoint) ? "on" : "off"))
  }, [known])

  const devices = endpoints.length

  const enable = () =>
    void act(async () => {
      const outcome = await subscribe(publicKey)

      if (outcome === "blocked") setState("blocked")
      else if (outcome !== "dismissed") {
        await subscribePush({ data: { subscription: outcome, origin: window.location.origin } })
        setState("on")
      }
    })

  const disable = () =>
    void act(async () => {
      const endpoint = await unsubscribe()

      if (endpoint) await unsubscribePush({ data: { endpoint } })
      setState("off")
    })

  const test = () =>
    void act(async () => {
      const { sent } = await testPush()

      setTested(sent > 0 ? `Sent to ${sent} ${sent === 1 ? "device" : "devices"}. It should arrive in a moment.` : "No device took it. Turn nudges on again here.")
    })

  return (
    <Card>
      <p data-testid={testIds.minis.push} data-state={state === null ? undefined : PUSH_STATES[state]} className="text-muted">
        {state === null ? "Checking this device…" : PUSH_NOTES[state]}
        {devices > 0 && state !== "on" ? ` ${devices} other ${devices === 1 ? "device gets" : "devices get"} them.` : ""}
        {state === "on" && devices > 1 ? ` So ${devices === 2 ? "does 1 other device" : `do ${devices - 1} other devices`}.` : ""}
      </p>
      <ErrorNote message={error} />
      {state === "off" ? (
        <Button variant="primary" className="mt-4 w-full" disabled={pending} data-testid={testIds.minis.enablePush} onClick={enable}>
          Get nudges on this device
        </Button>
      ) : null}
      {state === "on" ? (
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" disabled={pending} data-testid={testIds.minis.testPush} onClick={test}>
            Send a test
          </Button>
          <Button variant="ghost" className="flex-1" disabled={pending} data-testid={testIds.minis.disablePush} onClick={disable}>
            Turn off here
          </Button>
        </div>
      ) : null}
      {tested ? <p className="pt-2 text-sm text-faint">{tested}</p> : null}
    </Card>
  )
}

/** The way into the nudges' settings from a page that only shows progress. */
export function SetupLink() {
  return (
    <a href="#setup" className={buttonClass("secondary", "w-full")}>
      Set up targets and nudges
    </a>
  )
}
