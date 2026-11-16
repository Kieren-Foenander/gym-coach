import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { ExercisePicker } from "~/components/exercise"
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CloseIcon, TrophyIcon } from "~/components/icons"
import {
  Button,
  buttonClass,
  Card,
  ErrorNote,
  parseNumber,
  SectionTitle,
  Segmented,
  Sheet,
  Stat,
  Stepper,
  useAction,
  useNow,
} from "~/components/ui"
import { isCardio } from "~/domain/catalog"
import { BAR_WEIGHTS, platesPerSide, warmupSets } from "~/domain/loading"
import { distanceUnit, type Unit } from "~/domain/schema"
import { formatClock, formatCompact, formatDay, formatPrescription, formatReps, formatSet, formatWeight } from "~/format"
import {
  addWorkoutExercise,
  deleteSet,
  discardWorkout,
  finishWorkout,
  getWorkout,
  logSet,
  removeWorkoutExercise,
  swapExercise,
} from "~/functions/api"
import {
  cancelRestAlert,
  primeRestAlert,
  scheduleRestAlert,
  setSoundEnabled,
  soundEnabled,
} from "~/restAlert"
import type { Adjustment, WorkoutDetail, WorkoutExercise } from "~/server/repo"

export const Route = createFileRoute("/_app/workout/$workoutId")({
  loader: ({ params }) => getWorkout({ data: { workoutId: Number(params.workoutId) } }),
  component: WorkoutPage,
})

function WorkoutPage() {
  const detail = Route.useLoaderData()
  const { user } = Route.useRouteContext()

  return detail.workout.finishedAt === null ? (
    <ActiveWorkout detail={detail} unit={user.unit} />
  ) : (
    <FinishedWorkout detail={detail} unit={user.unit} />
  )
}

interface WorkoutViewProps {
  readonly detail: WorkoutDetail
  readonly unit: Unit
}

/** How long the "rest over" message stays up. */
const REST_OVER_MS = 6000
const EFFORTS = [6, 7, 8, 9, 10] as const

interface Rest {
  readonly endsAt: number
  readonly total: number
}

const isDone = (exercise: WorkoutExercise) =>
  exercise.target !== null && exercise.target.sets > 0 && exercise.sets.length >= exercise.target.sets

function ActiveWorkout({ detail, unit }: WorkoutViewProps) {
  const navigate = useNavigate()
  const now = useNow(true)
  const { act, pending, error } = useAction()
  const [rest, setRest] = useState<Rest | null>(null)
  const workoutId = detail.workout.id
  const restLeft = rest !== null && now !== null ? Math.ceil((rest.endsAt - now) / 1000) : 0
  const loggedAnything = detail.exercises.some((exercise) => exercise.sets.length > 0)
  const prescribed = detail.exercises.reduce((total, exercise) => total + (exercise.target?.sets ?? 0), 0)

  const completed = detail.exercises.reduce(
    (total, exercise) => total + Math.min(exercise.sets.length, exercise.target?.sets ?? 0),
    0,
  )

  // The first planned exercise still to do, or failing that the one added most recently.
  const currentId = (
    detail.exercises.find((exercise) => exercise.target !== null && !isDone(exercise)) ?? detail.exercises.at(-1)
  )?.exerciseId

  const [adding, setAdding] = useState(false)
  const taken = detail.exercises.map((item) => item.exerciseName)
  const restOver = rest !== null && now !== null && restLeft <= 0 && now - rest.endsAt < REST_OVER_MS
  const [sound, setSound] = useState(true)

  useEffect(() => {
    setSound(soundEnabled())

    return cancelRestAlert
  }, [])

  // Phones that support it also buzz. iPhones do not allow this from a web page.
  useEffect(() => {
    if (restOver && "vibrate" in navigator) navigator.vibrate([200, 100, 200])
  }, [restOver])

  const startRest = (seconds: number) => {
    if (seconds <= 0) {
      cancelRestAlert()
      setRest(null)

      return
    }

    scheduleRestAlert(seconds)
    setRest({ endsAt: Date.now() + seconds * 1000, total: seconds })
  }

  const extendRest = (current: Rest) => {
    const endsAt = current.endsAt + 30_000

    scheduleRestAlert((endsAt - Date.now()) / 1000)
    setRest({ endsAt, total: current.total + 30 })
  }

  const toggleSound = (current: Rest) => {
    setSoundEnabled(!sound)
    setSound(!sound)

    if (sound) cancelRestAlert()
    else scheduleRestAlert((current.endsAt - Date.now()) / 1000)
  }

  const finish = () =>
    act(async () => {
      const result = await finishWorkout({ data: { workoutId } })

      if (result.discarded) await navigate({ to: "/" })
    })

  const discard = () => {
    if (!window.confirm("Discard this workout? Its logged sets will be deleted.")) return

    void act(async () => {
      await discardWorkout({ data: { workoutId } })
      await navigate({ to: "/" })
    })
  }

  return (
    <>
      <header className="sticky top-0 z-20 -mx-4 bg-ink/90 px-4 pb-3 pt-1 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="display truncate text-3xl">{detail.workout.name}</h1>
            <p className="tabular text-sm text-muted">
              {now === null ? " " : formatClock((now - detail.workout.startedAt) / 1000)}
              {prescribed > 0 ? ` · ${completed} of ${prescribed} sets` : ""}
            </p>
          </div>
          <Button variant={loggedAnything ? "primary" : "secondary"} disabled={pending} onClick={finish}>
            {loggedAnything ? "Finish" : "Cancel"}
          </Button>
        </div>
        {prescribed > 0 ? (
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised"
            role="progressbar"
            aria-label="Sets completed"
            aria-valuemin={0}
            aria-valuemax={prescribed}
            aria-valuenow={completed}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${(completed / prescribed) * 100}%` }}
            />
          </div>
        ) : null}
      </header>

      <ErrorNote message={error} />

      <div className={`space-y-3 pt-1 ${restLeft > 0 || restOver ? "pb-36" : "pb-4"}`}>
        {detail.exercises.map((exercise, index) => (
          <ExerciseCard
            key={exercise.exerciseId}
            exercise={exercise}
            position={index + 1}
            current={exercise.exerciseId === currentId}
            unit={unit}
            workoutId={workoutId}
            taken={taken}
            onLogged={startRest}
          />
        ))}
        {detail.exercises.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-line px-4 py-10 text-center text-muted">
            Nothing here yet. Add the first exercise you are going to do.
          </p>
        ) : null}
        <Button className="w-full" variant={detail.exercises.length === 0 ? "primary" : "secondary"} onClick={() => setAdding(true)}>
          Add exercise
        </Button>
      </div>

      {adding ? (
        <Sheet title="Add exercise" onClose={() => setAdding(false)}>
          <AddExerciseForm workoutId={workoutId} taken={taken} onDone={() => setAdding(false)} />
        </Sheet>
      ) : null}

      {loggedAnything ? (
        <Button variant="danger" className="w-full" disabled={pending} onClick={discard}>
          Discard workout
        </Button>
      ) : null}

      {restLeft > 0 && rest !== null ? (
        <div className="bottom-safe fixed inset-x-0 z-30 px-4">
          <div className="mx-auto max-w-md animate-pop overflow-hidden rounded-3xl border border-white/10 bg-surface/95 shadow-2xl shadow-black/70 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3 px-4 pt-3">
              <div>
                <p className="eyebrow text-xs text-accent">Rest</p>
                <p className="display tabular text-5xl" role="timer">
                  {formatClock(restLeft)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => extendRest(rest)}>+30s</Button>
                <Button
                  onClick={() => {
                    cancelRestAlert()
                    setRest(null)
                  }}
                >
                  Skip
                </Button>
              </div>
            </div>
            <button
              type="button"
              aria-pressed={sound}
              className="min-h-11 px-4 text-sm font-semibold text-muted"
              onClick={() => toggleSound(rest)}
            >
              Sound at the end: <span className={sound ? "text-accent" : "text-white"}>{sound ? "on" : "off"}</span>
            </button>
            <div className="h-1 bg-raised" aria-hidden="true">
              <div
                className="h-full bg-accent transition-[width] duration-1000 ease-linear"
                style={{ width: `${Math.min(100, (restLeft / rest.total) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {restOver ? (
        <div className="bottom-safe fixed inset-x-0 z-30 px-4" role="status">
          <button
            type="button"
            className="mx-auto flex w-full max-w-md animate-pop items-center justify-between rounded-3xl bg-accent px-5 py-4 text-left text-accent-ink shadow-2xl shadow-black/70"
            onClick={() => setRest(null)}
          >
            <span>
              <span className="eyebrow block text-xs">Rest over</span>
              <span className="display block text-4xl">Go</span>
            </span>
            <span className="text-sm font-semibold">Tap to dismiss</span>
          </button>
        </div>
      ) : null}
    </>
  )
}

interface ExerciseCardProps {
  readonly exercise: WorkoutExercise
  readonly position: number
  readonly current: boolean
  readonly unit: Unit
  readonly workoutId: number
  /** Every exercise already in this workout, so a swap does not offer them. */
  readonly taken: ReadonlyArray<string>
  readonly onLogged: (restSeconds: number) => void
}

function ExerciseCard({ exercise, position, current, unit, workoutId, taken, onLogged }: ExerciseCardProps) {
  const { act, pending, error } = useAction()
  const { target, sets, previous } = exercise
  const lastSet = sets.at(-1)
  const prescribed = target?.sets ?? 0
  const done = isDone(exercise)
  const [addingExtra, setAddingExtra] = useState(false)
  const [effort, setEffort] = useState<number | null>(null)
  const [sheet, setSheet] = useState<"swap" | "load" | null>(null)

  const [weight, setWeight] = useState(() =>
    formatWeight(lastSet?.weight ?? target?.targetWeight ?? previous[0]?.weight ?? 0),
  )

  const [reps, setReps] = useState(() =>
    String(lastSet?.reps ?? previous[sets.length]?.reps ?? target?.repMin ?? 8),
  )

  const cardio = isCardio(exercise.exerciseName)
  const lastEffort = lastSet ?? previous[sets.length] ?? previous[0]
  const [minutes, setMinutes] = useState(() => formatWeight((lastEffort?.durationSeconds ?? 1200) / 60))
  const [distance, setDistance] = useState(() => formatWeight(lastEffort?.distance ?? 0))
  const noun = cardio ? "round" : "set"

  const log = () => {
    const parsedWeight = cardio ? 0 : parseNumber(weight)
    const parsedReps = cardio ? 0 : parseNumber(reps)
    const parsedMinutes = parseNumber(minutes)
    const parsedDistance = parseNumber(distance)

    if (parsedWeight === null || parsedReps === null) return

    if (cardio && (parsedMinutes === null || parsedMinutes <= 0)) return

    const timed = cardio
      ? { durationSeconds: Math.round((parsedMinutes ?? 0) * 60), distance: parsedDistance || null }
      : {}

    // Audio has to be woken inside the tap itself, before the request goes out.
    primeRestAlert()

    void act(async () => {
      await logSet({
        data: {
          workoutId,
          exerciseId: exercise.exerciseId,
          set: { weight: parsedWeight, reps: parsedReps, rpe: effort, ...timed },
        },
      })
      setAddingExtra(false)
      setEffort(null)
      onLogged(target?.restSeconds ?? 120)
    })
  }

  return (
    <section
      className={`rounded-3xl border bg-surface p-4 transition-colors ${
        current ? "border-accent/40 shadow-[0_0_40px_-18px_rgb(215_255_62/0.5)]" : "border-white/5"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`display flex size-9 shrink-0 items-center justify-center rounded-full text-lg ${
            done ? "bg-accent text-accent-ink" : current ? "bg-accent/15 text-accent" : "bg-raised text-muted"
          }`}
        >
          {done ? <CheckIcon /> : position}
        </span>
        <div className="min-w-0 flex-1">
          {exercise.swappedFrom === null ? null : (
            <p className="eyebrow truncate text-xs text-accent">In for {exercise.swappedFrom}</p>
          )}
          <h2 className="display truncate pt-0.5 text-2xl">{exercise.exerciseName}</h2>
          {target && cardio ? <p className="tabular text-sm text-muted">{formatPrescription(target, unit)}</p> : null}
          {target && !cardio ? (
            <p className="tabular text-sm text-muted">
              {target.sets} × {formatReps(target.repMin, target.repMax)} ·{" "}
              <span className="font-semibold text-white">
                {target.targetWeight === null ? "find your weight" : `${formatWeight(target.targetWeight)} ${unit}`}
              </span>
            </p>
          ) : null}
        </div>
        {prescribed > 0 ? (
          <span className="flex shrink-0 gap-1 pt-3.5" aria-hidden="true">
            {Array.from({ length: prescribed }, (_, index) => index).map((index) => (
              <span key={index} className={`h-1.5 w-4 rounded-full ${index < sets.length ? "bg-accent" : "bg-line"}`} />
            ))}
          </span>
        ) : null}
      </div>

      {previous.length > 0 ? (
        <p className="tabular pt-3 text-sm text-faint">
          Last time{" "}
          <span className="text-muted">
            {previous.map((set) => formatSet(set, unit)).join(cardio ? ", " : "  ")}
          </span>
        </p>
      ) : null}
      {target?.notes ? <p className="pt-1 text-sm text-muted">{target.notes}</p> : null}

      {sets.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {sets.map((set, index) => (
            <li
              key={set.id}
              className="flex animate-pop items-center justify-between gap-3 rounded-2xl bg-raised/70 pl-3"
            >
              <span className="tabular flex items-center gap-3">
                <span className="display w-4 text-lg text-faint">{index + 1}</span>
                {set.durationSeconds === null ? (
                  <span className="display text-2xl">
                    {formatWeight(set.weight)}
                    <span className="px-1 text-base text-muted">{unit} ×</span>
                    {set.reps}
                  </span>
                ) : (
                  <span className="display text-2xl">{formatSet(set, unit)}</span>
                )}
                {set.rpe === null ? null : <span className="text-sm text-muted">RPE {formatWeight(set.rpe)}</span>}
              </span>
              <button
                type="button"
                aria-label={`Remove ${noun} ${index + 1}`}
                className="flex size-11 items-center justify-center text-faint"
                disabled={pending}
                onClick={() => act(() => deleteSet({ data: { setId: set.id } }))}
              >
                <CloseIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <ErrorNote message={error} />

      {done && !addingExtra ? (
        <Button variant="ghost" className="mt-2 w-full" onClick={() => setAddingExtra(true)}>
          Add another {noun}
        </Button>
      ) : (
        <div className="mt-4 space-y-3">
          {cardio ? (
            <div className="grid grid-cols-2 gap-2">
              <Stepper label="Minutes" value={minutes} step={1} decimal onChange={setMinutes} />
              <Stepper label={distanceUnit(unit)} value={distance} step={0.5} decimal onChange={setDistance} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Stepper label={unit} value={weight} step={target?.increment || 2.5} decimal onChange={setWeight} />
              <Stepper label="Reps" value={reps} step={1} onChange={setReps} />
            </div>
          )}
          <div role="group" aria-label="Effort, optional">
            <p className="flex items-baseline justify-between pb-1.5 text-xs text-faint">
              <span className="eyebrow text-xs">Effort · optional</span>
              <span>10 = nothing left</span>
            </p>
            <div className="flex gap-1 rounded-2xl bg-ink p-1">
              {EFFORTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={effort === value}
                  aria-label={`Effort ${value} out of 10`}
                  className={`display tabular min-h-11 flex-1 rounded-xl text-xl transition-colors ${
                    effort === value ? "bg-accent text-accent-ink" : "bg-raised text-muted"
                  }`}
                  onClick={() => setEffort(effort === value ? null : value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <Button variant={current || done ? "primary" : "secondary"} className="w-full" disabled={pending} onClick={log}>
            Log {noun} {sets.length + 1}
            {prescribed > 0 && !done ? ` of ${prescribed}` : ""}
          </Button>
          <div className="flex gap-2">
            {cardio ? null : (
              <Button variant="ghost" className="flex-1 px-2" onClick={() => setSheet("load")}>
                Warm-up and plates
              </Button>
            )}
            {target && sets.length === 0 ? (
              <Button variant="ghost" className="flex-1 px-2" onClick={() => setSheet("swap")}>
                Swap exercise
              </Button>
            ) : null}
            {!target && sets.length === 0 ? (
              <Button
                variant="ghost"
                className="flex-1 px-2"
                disabled={pending}
                onClick={() => act(() => removeWorkoutExercise({ data: { workoutId, exerciseId: exercise.exerciseId } }))}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {sheet === "load" ? (
        <Sheet title={exercise.exerciseName} onClose={() => setSheet(null)}>
          <LoadingGuide weight={parseNumber(weight) ?? 0} unit={unit} />
        </Sheet>
      ) : null}
      {sheet === "swap" && target ? (
        <Sheet title="Swap exercise" onClose={() => setSheet(null)}>
          <SwapForm
            workoutId={workoutId}
            planExerciseId={target.id}
            muscleGroup={target.muscleGroup}
            current={exercise.exerciseName}
            swappedFrom={exercise.swappedFrom}
            taken={taken}
            onDone={() => setSheet(null)}
          />
        </Sheet>
      ) : null}
    </section>
  )
}

const BAR_KEY = "gym.barWeight"

const savedBar = (options: ReadonlyArray<number>) => {
  try {
    const saved = Number(window.localStorage.getItem(BAR_KEY))

    return options.includes(saved) ? saved : null
  } catch {
    return null
  }
}

/** Warm-up sets leading to a weight, and the plates to put on each side of the bar for it. */
function LoadingGuide({ weight, unit }: { readonly weight: number; readonly unit: Unit }) {
  const bars = BAR_WEIGHTS[unit]
  const [bar, setBar] = useState(bars[0] ?? 0)

  useEffect(() => {
    const saved = savedBar(bars)

    if (saved !== null) setBar(saved)
  }, [bars])

  const chooseBar = (label: string) => {
    const next = Number(label)

    setBar(next)

    try {
      window.localStorage.setItem(BAR_KEY, String(next))
    } catch {
      // Without storage the choice lasts until the page reloads.
    }
  }

  const load = platesPerSide(weight, bar, unit)
  const warmups = warmupSets(weight, bar, unit)

  return (
    <div className="space-y-5 pb-3">
      <div>
        <p className="pb-1.5 text-sm text-muted">Bar weight ({unit})</p>
        <Segmented label="Bar weight" options={bars.map(String)} value={String(bar)} onChange={chooseBar} />
      </div>

      <div>
        <p className="eyebrow pb-2 text-muted">
          Each side for {formatWeight(weight)} {unit}
        </p>
        {load === null ? (
          <p className="text-muted">That is lighter than the bar.</p>
        ) : load.perSide.length === 0 ? (
          <p className="text-muted">Just the bar.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {load.perSide.map((plate, index) => (
              // The same plate size can appear twice, so the position is part of the key.
              <li key={`${index}-${plate}`} className="display tabular rounded-xl bg-accent px-3 py-2 text-2xl text-accent-ink">
                {formatWeight(plate)}
              </li>
            ))}
          </ul>
        )}
        {load !== null && load.leftover > 0 ? (
          <p className="pt-2 text-sm text-amber-300">
            Standard plates leave {formatWeight(load.leftover)} {unit} short.
          </p>
        ) : null}
      </div>

      <div>
        <p className="eyebrow pb-2 text-muted">Warm-up</p>
        {warmups.length === 0 ? (
          <p className="text-muted">No warm-up sets needed at this weight.</p>
        ) : (
          <ol className="space-y-1.5">
            {warmups.map((set) => (
              <li key={set.weight} className="flex items-center justify-between rounded-2xl bg-raised/70 px-4 py-2.5">
                <span className="display tabular text-2xl">
                  {formatWeight(set.weight)}
                  <span className="px-1 text-base text-muted">{unit} ×</span>
                  {set.reps}
                </span>
                <span className="tabular text-sm text-muted">
                  {(platesPerSide(set.weight, bar, unit)?.perSide ?? []).map(formatWeight).join(" + ") || "bar only"}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="pt-2 text-sm text-faint">Warm-up sets are a guide and are not logged.</p>
      </div>
    </div>
  )
}

interface AddExerciseFormProps {
  readonly workoutId: number
  readonly taken: ReadonlyArray<string>
  readonly onDone: () => void
}

/** Adds an exercise to the workout: search the library, pick one done before, or type a new one. */
function AddExerciseForm({ workoutId, taken, onDone }: AddExerciseFormProps) {
  const { act, pending, error } = useAction()

  const add = (exercise: string) =>
    act(async () => {
      await addWorkoutExercise({ data: { workoutId, exercise } })
      onDone()
    })

  return (
    <div className="space-y-4 pb-3">
      <ErrorNote message={error} />
      <ExercisePicker taken={taken} disabled={pending} onPick={add} />
    </div>
  )
}

interface SwapFormProps {
  readonly workoutId: number
  readonly planExerciseId: number
  readonly muscleGroup: string
  readonly current: string
  readonly swappedFrom: string | null
  readonly taken: ReadonlyArray<string>
  readonly onDone: () => void
}

/** Picks a stand-in for a planned exercise, for this workout only. */
function SwapForm({ workoutId, planExerciseId, muscleGroup, current, swappedFrom, taken, onDone }: SwapFormProps) {
  const { act, pending, error } = useAction()

  const swapTo = (exercise: string) =>
    act(async () => {
      await swapExercise({ data: { workoutId, planExerciseId, exercise } })
      onDone()
    })

  return (
    <div className="space-y-4 pb-3">
      <p className="text-muted">
        Replaces {current} for this workout only. Your plan stays the same, and the sets, reps and rest carry over.
      </p>
      <ErrorNote message={error} />

      {swappedFrom === null ? null : (
        <Button className="w-full" disabled={pending} onClick={() => swapTo(swappedFrom)}>
          Back to {swappedFrom}
        </Button>
      )}

      <ExercisePicker taken={taken} group={muscleGroup} disabled={pending} onPick={swapTo} />
    </div>
  )
}

function FinishedWorkout({ detail, unit }: WorkoutViewProps) {
  const { workout, exercises, adjustments, records } = detail
  const minutes = workout.finishedAt === null ? 0 : Math.round((workout.finishedAt - workout.startedAt) / 60000)
  const allSets = exercises.flatMap((exercise) => exercise.sets)
  const volume = allSets.reduce((total, set) => total + set.weight * set.reps, 0)

  return (
    <>
      <header className="pb-5 pt-2">
        <p className="eyebrow pb-1 text-accent">Workout complete · {formatDay(workout.startedAt)}</p>
        <h1 className="display text-5xl">{workout.name}</h1>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Minutes" value={minutes > 0 ? minutes : "–"} />
        <Stat label="Sets" value={allSets.length} />
        <Stat label="Lifted" value={formatCompact(volume)} unit={unit} />
      </div>

      {records.length > 0 ? (
        <p className="mt-3 flex items-center gap-2 rounded-2xl bg-accent px-4 py-3 font-semibold text-accent-ink">
          <TrophyIcon className="size-5" />
          {records.length === 1 ? "1 personal best" : `${records.length} personal bests`}
        </p>
      ) : null}

      {adjustments.length > 0 ? (
        <>
          <SectionTitle>Changes for next time</SectionTitle>
          <Card>
            <ul className="divide-y divide-white/5">
              {adjustments.map((adjustment) => (
                <li key={adjustment.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <ChangeArrow adjustment={adjustment} />
                  <div className="min-w-0">
                    <p className="font-semibold">{adjustment.exerciseName}</p>
                    <p className="text-sm text-muted">{adjustment.reason}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}

      <SectionTitle>What you did</SectionTitle>
      <div className="space-y-2">
        {exercises.map((exercise) => (
          <Link
            key={exercise.exerciseId}
            to="/exercise/$exerciseId"
            params={{ exerciseId: String(exercise.exerciseId) }}
            className="block rounded-3xl border border-white/5 bg-surface p-4 active:bg-raised"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="display truncate text-2xl">{exercise.exerciseName}</span>
              {records.includes(exercise.exerciseId) ? (
                <span className="eyebrow flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 text-xs text-accent">
                  <TrophyIcon className="size-3.5" />
                  Best
                </span>
              ) : null}
            </span>
            <span className="tabular flex flex-wrap gap-1.5 pt-2">
              {exercise.sets.map((set) => (
                <span key={set.id} className="rounded-lg bg-raised px-2 py-1 text-sm font-semibold">
                  {formatSet(set, unit)}
                </span>
              ))}
              {isCardio(exercise.exerciseName) ? null : <span className="self-center pl-1 text-sm text-faint">{unit}</span>}
            </span>
          </Link>
        ))}
      </div>

      <Link to="/" className={buttonClass("primary", "mt-6 w-full")}>
        Done
      </Link>
    </>
  )
}

function ChangeArrow({ adjustment }: { readonly adjustment: Adjustment }) {
  const { oldWeight, newWeight } = adjustment
  const down = oldWeight !== null && newWeight !== null && newWeight < oldWeight

  return (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
        down ? "bg-amber-400/12 text-amber-300" : "bg-accent/12 text-accent"
      }`}
    >
      {down ? <ArrowDownIcon /> : <ArrowUpIcon />}
    </span>
  )
}
