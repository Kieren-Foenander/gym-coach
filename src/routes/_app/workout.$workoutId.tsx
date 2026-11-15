import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CloseIcon, TrophyIcon } from "~/components/icons"
import {
  Button,
  buttonClass,
  Card,
  ErrorNote,
  parseNumber,
  SectionTitle,
  Stat,
  Stepper,
  useAction,
  useNow,
} from "~/components/ui"
import { formatClock, formatCompact, formatDay, formatReps, formatWeight } from "~/format"
import { deleteSet, discardWorkout, finishWorkout, getWorkout, logSet } from "~/functions/api"
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
  readonly unit: string
}

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

  const currentId = detail.exercises.find((exercise) => !isDone(exercise))?.exerciseId

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

      <div className={`space-y-3 pt-1 ${restLeft > 0 ? "pb-32" : "pb-4"}`}>
        {detail.exercises.map((exercise, index) => (
          <ExerciseCard
            key={exercise.exerciseId}
            exercise={exercise}
            position={index + 1}
            current={exercise.exerciseId === currentId}
            unit={unit}
            workoutId={workoutId}
            onLogged={(seconds) => setRest(seconds > 0 ? { endsAt: Date.now() + seconds * 1000, total: seconds } : null)}
          />
        ))}
      </div>

      {loggedAnything ? (
        <Button variant="danger" className="w-full" disabled={pending} onClick={discard}>
          Discard workout
        </Button>
      ) : null}

      {restLeft > 0 && rest !== null ? (
        <div className="bottom-safe fixed inset-x-0 z-30 px-4">
          <div className="mx-auto max-w-md animate-pop overflow-hidden rounded-3xl border border-white/10 bg-surface/95 shadow-2xl shadow-black/70 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="eyebrow text-xs text-accent">Rest</p>
                <p className="display tabular text-5xl" role="timer">
                  {formatClock(restLeft)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setRest({ endsAt: rest.endsAt + 30_000, total: rest.total + 30 })}>+30s</Button>
                <Button onClick={() => setRest(null)}>Skip</Button>
              </div>
            </div>
            <div className="h-1 bg-raised" aria-hidden="true">
              <div
                className="h-full bg-accent transition-[width] duration-1000 ease-linear"
                style={{ width: `${Math.min(100, (restLeft / rest.total) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

interface ExerciseCardProps {
  readonly exercise: WorkoutExercise
  readonly position: number
  readonly current: boolean
  readonly unit: string
  readonly workoutId: number
  readonly onLogged: (restSeconds: number) => void
}

function ExerciseCard({ exercise, position, current, unit, workoutId, onLogged }: ExerciseCardProps) {
  const { act, pending, error } = useAction()
  const { target, sets, previous } = exercise
  const lastSet = sets.at(-1)
  const prescribed = target?.sets ?? 0
  const done = isDone(exercise)
  const [addingExtra, setAddingExtra] = useState(false)

  const [weight, setWeight] = useState(() =>
    formatWeight(lastSet?.weight ?? target?.targetWeight ?? previous[0]?.weight ?? 0),
  )

  const [reps, setReps] = useState(() =>
    String(lastSet?.reps ?? previous[sets.length]?.reps ?? target?.repMin ?? 8),
  )

  const log = () => {
    const parsedWeight = parseNumber(weight)
    const parsedReps = parseNumber(reps)

    if (parsedWeight === null || parsedReps === null) return

    void act(async () => {
      await logSet({
        data: { workoutId, exerciseId: exercise.exerciseId, set: { weight: parsedWeight, reps: parsedReps } },
      })
      setAddingExtra(false)
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
          <h2 className="display truncate pt-0.5 text-2xl">{exercise.exerciseName}</h2>
          {target ? (
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
            {previous.map((set) => `${formatWeight(set.weight)}×${set.reps}`).join("  ")}
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
                <span className="display text-2xl">
                  {formatWeight(set.weight)}
                  <span className="px-1 text-base text-muted">{unit} ×</span>
                  {set.reps}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Remove set ${index + 1}`}
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
          Add another set
        </Button>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stepper label={unit} value={weight} step={target?.increment || 2.5} decimal onChange={setWeight} />
            <Stepper label="Reps" value={reps} step={1} onChange={setReps} />
          </div>
          <Button variant={current || done ? "primary" : "secondary"} className="w-full" disabled={pending} onClick={log}>
            Log set {sets.length + 1}
            {prescribed > 0 && !done ? ` of ${prescribed}` : ""}
          </Button>
        </div>
      )}
    </section>
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
                  {formatWeight(set.weight)}
                  <span className="px-0.5 text-faint">×</span>
                  {set.reps}
                </span>
              ))}
              <span className="self-center pl-1 text-sm text-faint">{unit}</span>
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
