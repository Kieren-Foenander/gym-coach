import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { Button, Card, ErrorNote, parseNumber, SectionTitle, Stepper, useAction } from "~/components/ui"
import { formatClock, formatDay, formatPrescription, formatWeight } from "~/format"
import { deleteSet, discardWorkout, finishWorkout, getWorkout, logSet } from "~/functions/api"
import type { WorkoutDetail, WorkoutExercise } from "~/server/repo"

export const Route = createFileRoute("/_app/workout/$workoutId")({
  loader: ({ params }) => getWorkout({ data: { workoutId: Number(params.workoutId) } }),
  component: WorkoutPage,
})

/** The current time, ticking once a second. Null until mounted so server and client render the same thing. */
const useNow = () => {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [])

  return now
}

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

function ActiveWorkout({ detail, unit }: WorkoutViewProps) {
  const navigate = useNavigate()
  const now = useNow()
  const { act, pending, error } = useAction()
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null)
  const workoutId = detail.workout.id
  const restLeft = restEndsAt !== null && now !== null ? Math.ceil((restEndsAt - now) / 1000) : 0
  const loggedAnything = detail.exercises.some((exercise) => exercise.sets.length > 0)

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
      <header className="sticky top-0 z-20 -mx-4 flex items-center justify-between gap-3 bg-ink/95 px-4 pb-3 backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{detail.workout.name}</h1>
          <p className="tabular text-sm text-neutral-400">
            {now === null ? " " : formatClock((now - detail.workout.startedAt) / 1000)}
          </p>
        </div>
        <Button variant="primary" disabled={pending} onClick={finish}>
          {loggedAnything ? "Finish" : "Cancel"}
        </Button>
      </header>

      <ErrorNote message={error} />

      <div className={`space-y-3 ${restLeft > 0 ? "pb-28" : "pb-4"}`}>
        {detail.exercises.map((exercise) => (
          <ExerciseCard
            key={exercise.exerciseId}
            exercise={exercise}
            unit={unit}
            workoutId={workoutId}
            onLogged={(restSeconds) => setRestEndsAt(restSeconds > 0 ? Date.now() + restSeconds * 1000 : null)}
          />
        ))}
      </div>

      {loggedAnything ? (
        <Button variant="danger" className="w-full" disabled={pending} onClick={discard}>
          Discard workout
        </Button>
      ) : null}

      {restLeft > 0 && restEndsAt !== null ? (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pt-3">
          <div className="mx-auto flex max-w-md items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-400">Rest</p>
              <p className="tabular text-3xl font-bold">{formatClock(restLeft)}</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setRestEndsAt(restEndsAt + 30_000)}>+30s</Button>
              <Button onClick={() => setRestEndsAt(null)}>Skip</Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

interface ExerciseCardProps {
  readonly exercise: WorkoutExercise
  readonly unit: string
  readonly workoutId: number
  readonly onLogged: (restSeconds: number) => void
}

function ExerciseCard({ exercise, unit, workoutId, onLogged }: ExerciseCardProps) {
  const { act, pending, error } = useAction()
  const { target, sets, previous } = exercise
  const lastSet = sets.at(-1)
  const prescribed = target?.sets ?? 0
  const done = prescribed > 0 && sets.length >= prescribed
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
    <Card className={done ? "opacity-80" : ""}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="truncate text-lg font-bold">{exercise.exerciseName}</h2>
        {done ? <span className="shrink-0 text-sm font-semibold text-accent">Done</span> : null}
      </div>
      {target ? <p className="tabular text-sm text-neutral-300">{formatPrescription(target, unit)}</p> : null}
      {previous.length > 0 ? (
        <p className="tabular text-sm text-neutral-500">
          Last time: {previous.map((set) => `${formatWeight(set.weight)}×${set.reps}`).join(", ")}
        </p>
      ) : null}
      {target?.notes ? <p className="pt-1 text-sm text-neutral-400">{target.notes}</p> : null}

      {sets.length > 0 ? (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {sets.map((set, index) => (
            <li key={set.id} className="flex items-center justify-between gap-3">
              <span className="tabular py-2">
                <span className="inline-block w-6 text-neutral-500">{index + 1}</span>
                <span className="font-semibold">
                  {formatWeight(set.weight)} {unit} × {set.reps}
                </span>
              </span>
              <button
                type="button"
                className="min-h-11 px-2 text-sm text-neutral-500"
                disabled={pending}
                onClick={() => act(() => deleteSet({ data: { setId: set.id } }))}
              >
                Remove
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
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Stepper label={unit} value={weight} step={target?.increment || 2.5} decimal onChange={setWeight} />
            <Stepper label="Reps" value={reps} step={1} onChange={setReps} />
          </div>
          <Button variant="primary" className="w-full" disabled={pending} onClick={log}>
            Log set {sets.length + 1}
            {prescribed > 0 && !done ? ` of ${prescribed}` : ""}
          </Button>
        </div>
      )}
    </Card>
  )
}

function FinishedWorkout({ detail, unit }: WorkoutViewProps) {
  const { workout, exercises, adjustments } = detail
  const minutes = workout.finishedAt === null ? 0 : Math.round((workout.finishedAt - workout.startedAt) / 60000)

  return (
    <>
      <header className="pb-4">
        <p className="text-sm text-neutral-400">
          {formatDay(workout.startedAt)}
          {minutes > 0 ? ` · ${minutes} min` : ""}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">{workout.name}</h1>
      </header>

      {adjustments.length > 0 ? (
        <>
          <SectionTitle>Changes for next time</SectionTitle>
          <Card>
            <ul className="space-y-3">
              {adjustments.map((adjustment) => (
                <li key={adjustment.id}>
                  <p className="font-semibold">{adjustment.exerciseName}</p>
                  <p className="text-sm text-neutral-400">{adjustment.reason}</p>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}

      <SectionTitle>What you did</SectionTitle>
      <div className="space-y-3">
        {exercises.map((exercise) => (
          <Card key={exercise.exerciseId}>
            <Link
              to="/exercise/$exerciseId"
              params={{ exerciseId: String(exercise.exerciseId) }}
              className="block pb-1 text-lg font-bold"
            >
              {exercise.exerciseName}
            </Link>
            <p className="tabular text-neutral-300">
              {exercise.sets.map((set) => `${formatWeight(set.weight)}×${set.reps}`).join("   ")} {unit}
            </p>
          </Card>
        ))}
      </div>

      <Link
        to="/"
        className="mt-6 flex min-h-12 items-center justify-center rounded-xl bg-accent-strong font-semibold text-white"
      >
        Done
      </Link>
    </>
  )
}
