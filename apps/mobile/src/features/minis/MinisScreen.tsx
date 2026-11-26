import { useEffect, useState } from "react"
import { Pressable, Switch, View } from "react-native"
import { localDay } from "~/domain/health"
import { shiftDay } from "~/domain/days"
import {
  dayFraction,
  describeAmount,
  formatMiniAmount,
  MINI_LIMITS,
  MINI_UNITS,
  miniFormFor,
  miniRange,
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
import { describeGoal } from "~/domain/streaks"
import { testIds } from "~/domain/test-ids"
import type { MiniNudge } from "~/server/minis"
import { describeError } from "@/api/client"
import { call } from "@/api/session"
import { CloseIcon } from "@/components/icons"
import { BackLink, Button, Card, Display, ErrorNote, Eyebrow, Field, Loading, parseNumber, Screen, SectionTitle, Stepper, Text, TextInput } from "@/components/ui"
import { useAction, useCall } from "@/data/calls"
import { ExercisePicker } from "@/features/exercises/ExercisePicker"
import { useUser } from "@/features/user"
import { cn } from "@/lib/cn"
import { useNow } from "@/lib/useNow"
import type { AppScreenProps } from "@/navigation"
import { colors } from "@/theme"
import { ProgressBar } from "./parts"

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })

const UNIT_LABELS = { reps: "Reps", seconds: "Seconds" } as const

/** The phone's time zone, which the nudge window is read in. */
const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""

const clientKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/** Mini workouts: today's targets and what is done, a nudge to answer, and the settings. */
export function MinisScreen({ navigation, route }: AppScreenProps<"Minis">) {
  const today = localDay(useNow())
  const { data, error } = useCall("getMinis", miniRange(today))
  const user = useUser()
  const { act, pending, error: actionError } = useAction()

  if (!data) {
    return (
      <Screen>
        <BackLink testID={testIds.minis.back} onPress={navigation.goBack} />
        <Display accessibilityRole="header" className="pb-5 text-5xl">
          Mini workouts
        </Display>
        <Loading error={error ? describeError(error) : null} />
      </Screen>
    )
  }

  const day = data.days.find((item) => item.day === today) ?? data.days[1]!
  const entries = data.entries.filter((entry) => entry.day === today)
  const nudge = route.params.nudgeId === undefined ? undefined : data.nudges.find((item) => item.id === route.params.nudgeId)
  const minisGoal = user.streakGoals.find((goal) => goal.activity === "minis")

  const log = (exercise: string, amount: number, nudgeId?: number) =>
    act(async () => {
      await call("logMini", { day: today, exercise, amount, nudgeId, clientKey: clientKey() })
    })

  return (
    <Screen>
      <BackLink testID={testIds.minis.back} onPress={navigation.goBack} />
      <Eyebrow className="min-h-4 pb-1 text-mini">A few at a time</Eyebrow>
      <Display accessibilityRole="header" className="pb-5 text-5xl">
        Mini workouts
      </Display>
      <ErrorNote message={actionError} />

      {nudge ? (
        <NudgeCard
          key={nudge.id}
          nudge={nudge}
          pending={pending}
          onDone={(amount) => void log(nudge.exercise, amount, nudge.id)}
          onSkip={() => void act(() => call("skipNudge", { nudgeId: nudge.id }))}
        />
      ) : null}

      {day.progress.length > 0 ? (
        <>
          <View
            testID={testIds.minis.day}
            className="overflow-hidden rounded-[32px] border border-mini/25 bg-surface p-5"
          >
            <Eyebrow className="text-mini">{day.met ? "Every target done" : `${Math.round(dayFraction(day.progress) * 100)}% of today`}</Eyebrow>
            <View className="mt-4 gap-5">
              {day.progress.map((item) => (
                <ProgressRow
                  key={item.exercise}
                  item={item}
                  chunk={day.targets.find((target) => target.exercise === item.exercise)?.chunk ?? 10}
                  pending={pending}
                  onLog={(amount) => void log(item.exercise, amount)}
                />
              ))}
            </View>
          </View>
          <PauseNudges settings={data.settings} today={today} />
          <Text className="pt-3 text-sm text-faint">
            {minisGoal
              ? `Your streak goal: ${describeGoal(minisGoal)}. Days with every target done get a blue ring on the calendar.`
              : "Add a mini workouts streak goal in Settings to ring the days you finish every target on the calendar."}
          </Text>
          <SectionTitle>Done today</SectionTitle>
          <EntryList entries={entries} />
        </>
      ) : (
        <Text className="text-muted">
          Pick a few exercises you can do at home and a daily target for each, such as 100 push-ups and 50 pull-ups. Nudges then
          come at random through your day, each asking for a few, until the day is done.
        </Text>
      )}

      <SectionTitle>Targets and nudges</SectionTitle>
      <SettingsForm settings={data.settings} today={today} />

      <SectionTitle>Notifications</SectionTitle>
      <Card>
        <Text className="text-muted">
          {data.push.devices > 0
            ? `Nudges go to the web app on ${data.push.devices} ${data.push.devices === 1 ? "device" : "devices"}.`
            : "Nudges come through the web app for now. Open it from your home screen and turn them on under Mini workouts."}{" "}
          This app will show them itself once it is in the App Store.
        </Text>
      </Card>
    </Screen>
  )
}

interface ProgressRowProps {
  readonly item: MiniProgress
  readonly chunk: number
  readonly pending: boolean
  readonly onLog: (amount: number) => void
}

function ProgressRow({ item, chunk, pending, onLog }: ProgressRowProps) {
  const left = remainingOf(item)
  const suggested = left > 0 ? Math.min(chunk, left) : chunk
  const [amount, setAmount] = useState(String(suggested))
  const value = parseNumber(amount)
  const valid = value !== null && Number.isInteger(value) && value >= 1 && value <= MINI_LIMITS.daily

  useEffect(() => setAmount(String(suggested)), [suggested])

  return (
    <View testID={testIds.minis.progress(item.exercise)}>
      <View className="flex-row items-baseline justify-between gap-3 pb-1.5">
        <Display numberOfLines={1} className="flex-1 text-3xl">
          {item.exercise}
        </Display>
        <Text className="tabular-nums text-muted">
          <Display className="text-2xl">{formatMiniAmount(item.unit, item.done)}</Display> / {formatMiniAmount(item.unit, item.target)}
        </Text>
      </View>
      <ProgressBar fraction={item.done / item.target} label={`${item.exercise} today`} />
      <View className="mt-3 flex-row items-end gap-2">
        <Stepper label={item.unit === "seconds" ? "Seconds" : "Reps"} value={amount} step={5} onChange={setAmount} />
        <Button
          testID={testIds.minis.log}
          variant="primary"
          className="h-14"
          disabled={pending || !valid}
          onPress={() => value !== null && onLog(value)}
        >
          Log
        </Button>
      </View>
    </View>
  )
}

interface NudgeCardProps {
  readonly nudge: MiniNudge
  readonly pending: boolean
  readonly onDone: (amount: number) => void
  readonly onSkip: () => void
}

/** A nudge to answer: do what it asked (or a different amount), or pass. */
function NudgeCard({ nudge, pending, onDone, onSkip }: NudgeCardProps) {
  const [amount, setAmount] = useState(String(nudge.amount))
  const value = parseNumber(amount)
  const valid = value !== null && Number.isInteger(value) && value >= 1 && value <= MINI_LIMITS.daily

  return (
    <View testID={testIds.minis.nudge} className="mb-4 rounded-[32px] border border-mini/40 bg-mini/10 p-5">
      <Eyebrow className="text-mini">Nudge · {timeFormat.format(nudge.sentAt)}</Eyebrow>
      <Display className="pt-1 text-5xl">{describeAmount(nudge.exercise, nudge.unit, nudge.amount)}</Display>
      {nudge.status === "sent" ? (
        <>
          <View className="mt-4 flex-row">
            <Stepper label={nudge.unit === "seconds" ? "Seconds done" : "Reps done"} value={amount} step={5} onChange={setAmount} />
          </View>
          <View className="mt-3 flex-row gap-2">
            <Button testID={testIds.minis.nudgeSkip} className="flex-1" disabled={pending} onPress={onSkip}>
              Not now
            </Button>
            <Button
              testID={testIds.minis.nudgeDone}
              variant="primary"
              className="flex-[2]"
              disabled={pending || !valid}
              onPress={() => value !== null && onDone(value)}
            >
              {`Done ${value !== null && valid ? formatMiniAmount(nudge.unit, value) : ""}`}
            </Button>
          </View>
        </>
      ) : (
        <Text className="pt-2 text-muted">{nudge.status === "done" ? "Logged. Nice work." : "Passed on. The rest moves to later nudges."}</Text>
      )}
    </View>
  )
}

/** Today's sets, newest first, each with a way to take it back. */
function EntryList({ entries }: { readonly entries: ReadonlyArray<MiniEntry> }) {
  const { act, pending, error } = useAction()

  if (entries.length === 0) return <Text className="text-sm text-faint">Nothing logged yet today.</Text>

  return (
    <Card>
      <ErrorNote message={error} />
      {entries.toReversed().map((entry) => (
        <View key={entry.id} testID={testIds.minis.entry(entry.id)} className="flex-row items-center gap-3 py-1.5">
          <Text className="w-16 text-sm tabular-nums text-muted">{timeFormat.format(entry.createdAt)}</Text>
          <Text numberOfLines={1} className="flex-1 font-semibold">
            {describeAmount(entry.exercise, entry.unit, entry.amount)}
          </Text>
          {entry.nudgeId === null ? null : <Eyebrow className="text-xs text-mini">Nudge</Eyebrow>}
          <Pressable
            testID={testIds.minis.deleteEntry}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${describeAmount(entry.exercise, entry.unit, entry.amount)}`}
            disabled={pending}
            onPress={() => void act(() => call("deleteMini", { entryId: entry.id }))}
            className="size-11 items-center justify-center rounded-full active:bg-raised"
          >
            <CloseIcon size={16} color={colors.faint} />
          </Pressable>
        </View>
      ))}
    </Card>
  )
}

interface ChoiceProps {
  readonly testID: string
  readonly label: string
  readonly selected: boolean
  readonly onPress: () => void
  readonly className?: string
}

function Choice({ testID, label, selected, onPress, className }: ChoiceProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn("min-h-11 items-center justify-center rounded-full px-4", selected ? "bg-mini" : "bg-raised", className)}
    >
      <Text className={cn("font-semibold", selected ? "text-ink" : "text-muted")}>{label}</Text>
    </Pressable>
  )
}

/** The targets and when nudges may come, saved together. */
function SettingsForm({ settings, today }: { readonly settings: MiniSettings; readonly today: string }) {
  const { act, pending, error } = useAction()
  const [form, setForm] = useState<MiniForm>(() => miniFormFor(settings))
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
      await call("updateMinis", { day: today, settings: next.settings })
      setSaved(true)
    })
  }

  return (
    <Card>
      <Eyebrow className="pb-3 text-muted">Daily targets</Eyebrow>
      <View className="gap-4">
        {form.targets.map((target, index) => (
          <View key={target.exercise} testID={testIds.minis.target(target.exercise)} className="gap-3 rounded-2xl bg-raised/50 p-3">
            <View className="flex-row items-center justify-between gap-3">
              <Display numberOfLines={1} className="flex-1 text-2xl">
                {target.exercise}
              </Display>
              <Pressable
                testID={testIds.minis.removeTarget}
                accessibilityRole="button"
                onPress={() => edit({ ...form, targets: form.targets.filter((_, at) => at !== index) })}
                className="min-h-11 justify-center px-2"
              >
                <Text className="text-sm font-semibold text-muted">Remove</Text>
              </Pressable>
            </View>
            <View className="flex-row gap-2">
              {MINI_UNITS.map((unit) => (
                <Choice
                  key={unit}
                  testID={testIds.minis.targetUnit(unit)}
                  label={UNIT_LABELS[unit]}
                  selected={target.unit === unit}
                  onPress={() => editTarget(index, { unit })}
                />
              ))}
            </View>
            <View className="flex-row gap-2">
              <Stepper label="A day" value={target.daily} step={10} onChange={(daily) => editTarget(index, { daily })} />
              <Stepper label="A nudge" value={target.chunk} step={5} onChange={(chunk) => editTarget(index, { chunk })} />
            </View>
            <View className="flex-row">
              <Stepper label="Grow each week by" value={target.growBy} step={5} onChange={(growBy) => editTarget(index, { growBy })} />
            </View>
            <Text className="text-xs text-faint">
              {target.growBy === "0" || target.growBy === ""
                ? "Stays the same. Set a number to raise it after a week with every nudge day done."
                : `Rises by ${target.growBy} after a week with every nudge day done.`}
            </Text>
          </View>
        ))}
        {picking ? (
          <View className="gap-3">
            <ExercisePicker
              taken={form.targets.map((target) => target.exercise)}
              group="Chest"
              disabled={false}
              onPick={(exercise) => {
                edit({ ...form, targets: [...form.targets, targetFormFor(suggestTarget(exercise))] })
                setPicking(false)
              }}
            />
            <Button variant="ghost" onPress={() => setPicking(false)}>
              Cancel
            </Button>
          </View>
        ) : form.targets.length < MINI_LIMITS.targets ? (
          <Button testID={testIds.minis.addTarget} onPress={() => setPicking(true)}>
            Add an exercise
          </Button>
        ) : null}
      </View>

      <Eyebrow className="pb-3 pt-6 text-muted">Nudges</Eyebrow>
      <View testID={testIds.minis.nudges} className="min-h-12 flex-row items-center justify-between gap-3 rounded-2xl bg-raised/50 px-4">
        <Text className="font-semibold">Send nudges</Text>
        <Switch
          accessibilityLabel="Send nudges"
          value={form.nudges}
          onValueChange={(nudges) => edit({ ...form, nudges })}
          trackColor={{ true: colors.mini, false: colors.line }}
        />
      </View>
      <Text className="pb-3 pt-1.5 text-sm text-faint">At random times in the window, each asking for what keeps you on course for the day.</Text>

      <Text className="pb-1.5 text-sm text-muted">On</Text>
      <View className="flex-row gap-1">
        {WEEKDAY_LETTERS.map((letter, day) => (
          <Pressable
            key={WEEKDAY_SHORT[day]}
            testID={testIds.minis.weekday(day)}
            accessibilityRole="button"
            accessibilityLabel={WEEKDAY_SHORT[day]}
            accessibilityState={{ selected: form.days.includes(day) }}
            onPress={() => toggleDay(day)}
            className={cn("h-11 flex-1 items-center justify-center rounded-full", form.days.includes(day) ? "bg-mini" : "bg-raised")}
          >
            <Text className={cn("font-semibold", form.days.includes(day) ? "text-ink" : "text-muted")}>{letter}</Text>
          </Pressable>
        ))}
      </View>

      <View className="flex-row gap-2 pt-4">
        <View className="flex-1">
          <Field label="From">
            <TextInput testID={testIds.minis.start} keyboardType="numbers-and-punctuation" value={form.start} onChangeText={(start) => edit({ ...form, start })} />
          </Field>
        </View>
        <View className="flex-1">
          <Field label="Until">
            <TextInput testID={testIds.minis.end} keyboardType="numbers-and-punctuation" value={form.end} onChangeText={(end) => edit({ ...form, end })} />
          </Field>
        </View>
        <View className="flex-1">
          <Field label="Gap (min)">
            <TextInput testID={testIds.minis.gap} keyboardType="number-pad" value={form.gap} onChangeText={(gap) => edit({ ...form, gap })} />
          </Field>
        </View>
      </View>
      <Text className="pt-1.5 text-sm text-faint">Nothing comes outside these hours, or while a workout is open.</Text>

      <ErrorNote message={problem ?? error} />
      <Button testID={testIds.minis.save} variant="primary" className="mt-5" disabled={pending} onPress={save}>
        {saved && !pending ? "Saved" : "Save"}
      </Button>
    </Card>
  )
}

/** A day off from nudges, or back on. */
function PauseNudges({ settings, today }: { readonly settings: MiniSettings; readonly today: string }) {
  const { act, pending, error } = useAction()
  const paused = settings.pausedUntil !== null && settings.pausedUntil > today

  if (!settings.nudges || settings.targets.length === 0) return null

  const setPause = (pausedUntil: string | null) =>
    void act(async () => {
      await call("updateMinis", { day: today, settings: { ...settings, timeZone: settings.timeZone || deviceTimeZone(), pausedUntil } })
    })

  return (
    <View className="pt-3">
      <ErrorNote message={error} />
      {paused ? (
        <Button testID={testIds.minis.resume} disabled={pending} onPress={() => setPause(null)}>
          Nudges paused today. Turn them back on
        </Button>
      ) : (
        <Button testID={testIds.minis.pauseToday} disabled={pending} onPress={() => setPause(shiftDay(today, 1))}>
          No more nudges today
        </Button>
      )}
    </View>
  )
}
