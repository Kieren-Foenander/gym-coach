import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { ExercisePicker, ExerciseThumbnail } from "~/components/exercise"
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CloseIcon, TrophyIcon } from "~/components/icons"
import {
  Button,
  buttonClass,
  Card,
  ErrorNote,
  Field,
  parseNumber,
  SectionTitle,
  Segmented,
  Sheet,
  Stat,
  Stepper,
  TextArea,
  TextInput,
  useAction,
  useNow,
} from "~/components/ui"
import { catalogByName, isCardio } from "~/domain/catalog"
import { EXERCISE_STATES, exerciseStates, skippedSetCount, type ExerciseState, type FocusExercise } from "~/domain/focus"
import { BAR_WEIGHTS, loadKindFor, platesPerSide, warmupFor, type LoadKind } from "~/domain/loading"
import { REST_STEP_SECONDS } from "~/domain/rest"
import { distanceUnit, type SetInput, type Unit } from "~/domain/schema"
import { formatClock, formatCompact, formatDay, formatPrescription, formatReps, formatSet, formatWeight } from "~/format"
import {
  addWorkoutExercise,
  deleteSet,
  discardWorkout,
  finishWorkout,
  getWorkout,
  logSet,
  removeWorkoutExercise,
  setExerciseNote,
  swapExercise,
  updateSet,
} from "~/functions/api"
import { primeRestAlert, setSoundEnabled, soundEnabled } from "~/restAlert"
import { adjustCurrentRest, clearRest, refreshRestAlert, startRest, useRest } from "~/restTimer"
import type { Adjustment, WorkoutDetail, WorkoutExercise, WorkoutSet } from "~/server/repo"
import { testIds } from "~/domain/test-ids"

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

const focusOf = (exercise: WorkoutExercise): FocusExercise => ({
  planned: exercise.target?.sets ?? 0,
  logged: exercise.sets.length,
  latest: exercise.sets.reduce<number | null>((latest, set) => Math.max(latest ?? 0, set.id), null),
})

function ActiveWorkout({ detail, unit }: WorkoutViewProps) {
  const navigate = useNavigate()
  const now = useNow(true)
  const { act, pending, error } = useAction()
  const workoutId = detail.workout.id
  const rest = useRest(workoutId)
  const restLeft = rest !== null && now !== null ? Math.ceil((rest.endsAt - now) / 1000) : 0
  const loggedAnything = detail.exercises.some((exercise) => exercise.sets.length > 0)
  const prescribed = detail.exercises.reduce((total, exercise) => total + (exercise.target?.sets ?? 0), 0)

  const completed = detail.exercises.reduce(
    (total, exercise) => total + Math.min(exercise.sets.length, exercise.target?.sets ?? 0),
    0,
  )

  const focus = detail.exercises.map(focusOf)
  const states = exerciseStates(focus)
  const skippedSets = skippedSetCount(focus)
  const [adding, setAdding] = useState(false)
  const taken = detail.exercises.map((item) => item.exerciseName)
  const restOver = rest !== null && now !== null && restLeft <= 0 && now - rest.endsAt < REST_OVER_MS
  const [sound, setSound] = useState(true)

  // The rest itself outlives this page, so a look at an exercise's page mid-rest does not stop it.
  useEffect(() => setSound(soundEnabled()), [])

  // Phones that support it also buzz. iPhones do not allow this from a web page.
  useEffect(() => {
    if (restOver && "vibrate" in navigator) navigator.vibrate([200, 100, 200])
  }, [restOver])

  const toggleSound = () => {
    setSoundEnabled(!sound)
    setSound(!sound)
    refreshRestAlert()
  }

  const finish = () =>
    act(async () => {
      const result = await finishWorkout({ data: { workoutId } })

      clearRest()

      if (result.discarded) await navigate({ to: "/" })
    })

  const discard = () => {
    if (!window.confirm("Discard this workout? Its logged sets will be deleted.")) return

    void act(async () => {
      await discardWorkout({ data: { workoutId } })
      clearRest()
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
              {skippedSets > 0 ? ` · ${skippedSets} skipped` : ""}
            </p>
          </div>
          <Button
            variant={loggedAnything ? "primary" : "secondary"}
            disabled={pending}
            data-testid={testIds.workout.finish}
            onClick={finish}
          >
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
            state={states[index] ?? "todo"}
            unit={unit}
            workoutId={workoutId}
            taken={taken}
            onLogged={(seconds) => startRest(workoutId, seconds)}
          />
        ))}
        {detail.exercises.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-line px-4 py-10 text-center text-muted">
            Nothing here yet. Add the first exercise you are going to do.
          </p>
        ) : null}
        <Button
          className="w-full"
          variant={detail.exercises.length === 0 ? "primary" : "secondary"}
          data-testid={testIds.workout.addExercise}
          onClick={() => setAdding(true)}
        >
          Add exercise
        </Button>
      </div>

      {adding ? (
        <Sheet title="Add exercise" onClose={() => setAdding(false)}>
          <AddExerciseForm workoutId={workoutId} taken={taken} onDone={() => setAdding(false)} />
        </Sheet>
      ) : null}

      {loggedAnything ? (
        <Button variant="danger" className="w-full" disabled={pending} data-testid={testIds.workout.discard} onClick={discard}>
          Discard workout
        </Button>
      ) : null}

      {restLeft > 0 && rest !== null ? (
        <div className="bottom-safe fixed inset-x-0 z-30 px-4">
          <div className="mx-auto max-w-md animate-pop overflow-hidden rounded-3xl border border-white/10 bg-surface/95 shadow-2xl shadow-black/70 backdrop-blur-xl">
            <div className="flex items-end justify-between gap-2 px-4 pt-3">
              <div>
                <p className="eyebrow text-xs text-accent">Rest</p>
                <p className="display tabular text-5xl" role="timer" data-testid={testIds.workout.rest} data-value={restLeft}>
                  {formatClock(restLeft)}
                </p>
              </div>
              <button
                type="button"
                aria-pressed={sound}
                className="min-h-11 text-sm font-semibold text-muted"
                onClick={toggleSound}
              >
                Sound: <span className={sound ? "text-accent" : "text-white"}>{sound ? "on" : "off"}</span>
              </button>
            </div>
            {/* Three equal buttons on their own row, so they fit the narrowest phone. */}
            <div className="grid grid-cols-3 gap-1.5 px-4 pt-2 pb-3">
              <Button
                aria-label="30 seconds less"
                data-testid={testIds.workout.restLess}
                onClick={() => adjustCurrentRest(-REST_STEP_SECONDS)}
              >
                −30s
              </Button>
              <Button
                aria-label="30 seconds more"
                data-testid={testIds.workout.restMore}
                onClick={() => adjustCurrentRest(REST_STEP_SECONDS)}
              >
                +30s
              </Button>
              <Button onClick={clearRest}>Skip</Button>
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

      {restOver ? (
        <div className="bottom-safe fixed inset-x-0 z-30 px-4" role="status">
          <button
            type="button"
            className="mx-auto flex w-full max-w-md animate-pop items-center justify-between rounded-3xl bg-accent px-5 py-4 text-left text-accent-ink shadow-2xl shadow-black/70"
            onClick={clearRest}
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
  readonly state: ExerciseState
  readonly unit: Unit
  readonly workoutId: number
  /** Every exercise already in this workout, so a swap does not offer them. */
  readonly taken: ReadonlyArray<string>
  readonly onLogged: (restSeconds: number) => void
}

/** What the set form starts with: the set being changed, or else a guess at the next set. */
interface SetDraft {
  readonly weight: string
  readonly reps: string
  readonly minutes: string
  readonly distance: string
  readonly effort: number | null
  readonly note: string
}

const nextSetDraft = (exercise: WorkoutExercise): SetDraft => {
  const { target, sets, previous } = exercise
  const lastSet = sets.at(-1)
  const lastEffort = lastSet ?? previous[sets.length] ?? previous[0]

  return {
    weight: formatWeight(lastSet?.weight ?? target?.targetWeight ?? previous[0]?.weight ?? 0),
    reps: String(lastSet?.reps ?? previous[sets.length]?.reps ?? target?.repMin ?? 8),
    minutes: formatWeight((lastEffort?.durationSeconds ?? 1200) / 60),
    distance: formatWeight(lastEffort?.distance ?? 0),
    effort: null,
    note: "",
  }
}

const draftOf = (set: WorkoutSet): SetDraft => ({
  weight: formatWeight(set.weight),
  reps: String(set.reps),
  minutes: formatWeight((set.durationSeconds ?? 0) / 60),
  distance: formatWeight(set.distance ?? 0),
  effort: set.rpe,
  note: set.note,
})

function ExerciseCard({ exercise, position, state, unit, workoutId, taken, onLogged }: ExerciseCardProps) {
  const { act, pending, error } = useAction()
  const { target, sets, previous } = exercise
  const prescribed = target?.sets ?? 0
  const done = state === "done"
  const current = state === "current"
  const skipped = state === "skipped"
  const [addingExtra, setAddingExtra] = useState(false)
  const [editing, setEditing] = useState<WorkoutSet | null>(null)
  const [draft, setDraft] = useState(() => nextSetDraft(exercise))
  const [noteOpen, setNoteOpen] = useState(false)
  const [sheet, setSheet] = useState<"swap" | "load" | "note" | null>(null)
  const cardio = isCardio(exercise.exerciseName)
  const loadKind = loadKindFor(exercise.exerciseName)
  const noun = cardio ? "round" : "set"
  const change = (patch: Partial<SetDraft>) => setDraft((before) => ({ ...before, ...patch }))
  const editingNumber = editing === null ? 0 : sets.findIndex((set) => set.id === editing.id) + 1

  const startEditing = (set: WorkoutSet) => {
    setEditing(set)
    setDraft(draftOf(set))
    setNoteOpen(set.note !== "")
  }

  const stopEditing = () => {
    setEditing(null)
    setDraft(nextSetDraft(exercise))
    setNoteOpen(false)
  }

  /** The set the form describes, or null when a number in it cannot be read. */
  const readDraft = (): SetInput | null => {
    const parsedWeight = cardio ? 0 : parseNumber(draft.weight)
    const parsedReps = cardio ? 0 : parseNumber(draft.reps)
    const parsedMinutes = parseNumber(draft.minutes)
    const parsedDistance = parseNumber(draft.distance)

    if (parsedWeight === null || parsedReps === null) return null

    if (cardio && (parsedMinutes === null || parsedMinutes <= 0)) return null

    const timed = cardio ? { durationSeconds: Math.round((parsedMinutes ?? 0) * 60), distance: parsedDistance || null } : {}

    return { weight: parsedWeight, reps: Math.round(parsedReps), rpe: draft.effort, note: draft.note.trim(), ...timed }
  }

  const log = () => {
    const set = readDraft()

    if (set === null) return

    // Audio has to be woken inside the tap itself, before the request goes out.
    primeRestAlert()

    void act(async () => {
      await logSet({ data: { workoutId, exerciseId: exercise.exerciseId, set } })
      setAddingExtra(false)
      setDraft((before) => ({ ...before, effort: null, note: "" }))
      setNoteOpen(false)
      onLogged(target?.restSeconds ?? 120)
    })
  }

  const save = (setId: number) => {
    const set = readDraft()

    if (set === null) return

    void act(async () => {
      await updateSet({ data: { setId, set } })
      stopEditing()
    })
  }

  const formOpen = editing !== null || !(done || skipped) || addingExtra
  const left = prescribed - sets.length

  return (
    <section
      className={`rounded-3xl border bg-surface p-4 transition-colors ${
        current ? "border-accent/40 shadow-[0_0_40px_-18px_rgb(215_255_62/0.5)]" : "border-white/5"
      }`}
      data-testid={testIds.workout.exercise(exercise.exerciseName)}
      data-state={EXERCISE_STATES[state]}
    >
      <div className="flex items-start gap-3">
        <span className="relative shrink-0">
          <ExerciseThumbnail entry={catalogByName(exercise.exerciseName)} className="size-14" />
          <span
            className={`display absolute -bottom-1.5 -right-1.5 flex size-7 items-center justify-center rounded-full border-2 border-surface text-sm ${
              done ? "bg-accent text-accent-ink" : current ? "bg-accent-ink text-accent" : "bg-raised text-muted"
            }`}
          >
            {done ? <CheckIcon className="size-3.5" /> : position}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          {exercise.swappedFrom === null ? null : (
            <p className="eyebrow truncate text-xs text-accent">In for {exercise.swappedFrom}</p>
          )}
          <Link
            to="/exercise/$exerciseId"
            params={{ exerciseId: String(exercise.exerciseId) }}
            className="display block truncate pt-0.5 text-2xl underline-offset-4 active:underline"
            data-testid={testIds.workout.exerciseName}
          >
            {exercise.exerciseName}
          </Link>
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
              <span
                key={index}
                className={`h-1.5 w-4 rounded-full ${index < sets.length ? "bg-accent" : skipped ? "bg-amber-300/60" : "bg-line"}`}
              />
            ))}
          </span>
        ) : null}
      </div>

      {skipped ? (
        <p className="pt-3 text-sm text-amber-300">
          {left === 1 ? `1 ${noun} skipped` : `${left} ${noun}s skipped`}. You moved on, so the workout did too.
        </p>
      ) : null}
      {previous.length > 0 ? (
        <p className="tabular pt-3 text-sm text-faint">
          Last time{" "}
          <span className="text-muted">
            {previous.map((set) => formatSet(set, unit)).join(cardio ? ", " : "  ")}
          </span>
        </p>
      ) : null}
      {target?.notes ? <p className="pt-1 text-sm text-muted">{target.notes}</p> : null}
      {exercise.note === "" ? null : (
        <button
          type="button"
          className="mt-2 block w-full rounded-2xl bg-raised/70 px-3 py-2 text-left text-sm text-muted"
          onClick={() => setSheet("note")}
        >
          <span className="eyebrow block text-xs text-faint">Your note</span>
          <span className="whitespace-pre-line text-white">{exercise.note}</span>
        </button>
      )}

      {sets.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {sets.map((set, index) => (
            <li
              key={set.id}
              className={`animate-pop rounded-2xl pl-3 ${editing?.id === set.id ? "bg-accent/15 ring-1 ring-accent/40" : "bg-raised/70"}`}
              data-testid={testIds.workout.set(index + 1)}
            >
              <span className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-label={`Change ${noun} ${index + 1}`}
                  className="tabular flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
                  disabled={pending}
                  data-testid={testIds.workout.editSet}
                  onClick={() => (editing?.id === set.id ? stopEditing() : startEditing(set))}
                >
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
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${noun} ${index + 1}`}
                  className="flex size-11 items-center justify-center text-faint"
                  disabled={pending}
                  onClick={() =>
                    act(async () => {
                      if (editing?.id === set.id) stopEditing()
                      await deleteSet({ data: { setId: set.id } })
                    })
                  }
                >
                  <CloseIcon className="size-4" />
                </button>
              </span>
              {set.note === "" ? null : <span className="block pb-2 pl-7 pr-3 text-sm text-muted">{set.note}</span>}
            </li>
          ))}
        </ul>
      ) : null}

      <ErrorNote message={error} />

      {formOpen ? (
        <div className="mt-4 space-y-3">
          {editing === null ? null : (
            <p className="eyebrow text-xs text-accent">
              Changing {noun} {editingNumber}
            </p>
          )}
          {cardio ? (
            <div className="grid grid-cols-2 gap-2">
              <Stepper
                testId={testIds.workout.minutes}
                label="Minutes"
                value={draft.minutes}
                step={1}
                decimal
                onChange={(minutes) => change({ minutes })}
              />
              <Stepper
                testId={testIds.workout.distance}
                label={distanceUnit(unit)}
                value={draft.distance}
                step={0.5}
                decimal
                onChange={(distance) => change({ distance })}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Stepper
                testId={testIds.workout.weight}
                label={unit}
                value={draft.weight}
                step={target?.increment || 2.5}
                decimal
                onChange={(weight) => change({ weight })}
              />
              <Stepper testId={testIds.workout.reps} label="Reps" value={draft.reps} step={1} onChange={(reps) => change({ reps })} />
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
                  aria-pressed={draft.effort === value}
                  aria-label={`Effort ${value} out of 10`}
                  className={`display tabular min-h-11 flex-1 rounded-xl text-xl transition-colors ${
                    draft.effort === value ? "bg-accent text-accent-ink" : "bg-raised text-muted"
                  }`}
                  onClick={() => change({ effort: draft.effort === value ? null : value })}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          {noteOpen ? (
            <Field label="Note on this set · optional">
              <TextInput
                value={draft.note}
                maxLength={200}
                placeholder="Grip slipped, felt easy, knee twinged…"
                data-testid={testIds.workout.setNote}
                onChange={(event) => change({ note: event.target.value })}
              />
            </Field>
          ) : null}
          {editing === null ? (
            <Button
              variant={current || done ? "primary" : "secondary"}
              className="w-full"
              disabled={pending}
              data-testid={testIds.workout.logSet}
              onClick={log}
            >
              Log {noun} {sets.length + 1}
              {prescribed > 0 && sets.length < prescribed ? ` of ${prescribed}` : ""}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button className="flex-1" disabled={pending} data-testid={testIds.workout.cancelEdit} onClick={stopEditing}>
                Cancel
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                disabled={pending}
                data-testid={testIds.workout.saveSet}
                onClick={() => save(editing.id)}
              >
                Save {noun} {editingNumber}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {noteOpen ? null : (
              <Button
                variant="ghost"
                className="grow whitespace-nowrap px-3 text-sm"
                data-testid={testIds.workout.addSetNote}
                onClick={() => setNoteOpen(true)}
              >
                {cardio ? "Round note" : "Set note"}
              </Button>
            )}
            <Button
              variant="ghost"
              className="grow whitespace-nowrap px-3 text-sm"
              data-testid={testIds.workout.editExerciseNote}
              onClick={() => setSheet("note")}
            >
              Exercise note
            </Button>
            {cardio || loadKind === "none" || editing !== null ? null : (
              <Button variant="ghost" className="grow whitespace-nowrap px-3 text-sm" onClick={() => setSheet("load")}>
                {loadKind === "bar" ? "Warm-up and plates" : "Warm-up"}
              </Button>
            )}
            {target && sets.length === 0 ? (
              <Button variant="ghost" className="grow whitespace-nowrap px-3 text-sm" onClick={() => setSheet("swap")}>
                Swap exercise
              </Button>
            ) : null}
            {!target && sets.length === 0 ? (
              <Button
                variant="ghost"
                className="grow whitespace-nowrap px-3 text-sm"
                disabled={pending}
                onClick={() => act(() => removeWorkoutExercise({ data: { workoutId, exerciseId: exercise.exerciseId } }))}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button variant="ghost" className="flex-1 px-2" onClick={() => setAddingExtra(true)}>
            {done ? `Add another ${noun}` : `Log ${noun} ${sets.length + 1} of ${prescribed} after all`}
          </Button>
          <Button
            variant="ghost"
            className="px-3"
            data-testid={testIds.workout.editExerciseNote}
            onClick={() => setSheet("note")}
          >
            {exercise.note === "" ? "Add note" : "Edit note"}
          </Button>
        </div>
      )}

      {sheet === "load" ? (
        <Sheet title={exercise.exerciseName} onClose={() => setSheet(null)}>
          <LoadingGuide kind={loadKind} weight={parseNumber(draft.weight) ?? 0} unit={unit} />
        </Sheet>
      ) : null}
      {sheet === "note" ? (
        <Sheet title={exercise.exerciseName} onClose={() => setSheet(null)}>
          <ExerciseNoteForm workoutId={workoutId} exerciseId={exercise.exerciseId} note={exercise.note} onDone={() => setSheet(null)} />
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

interface ExerciseNoteFormProps {
  readonly workoutId: number
  readonly exerciseId: number
  readonly note: string
  readonly onDone: () => void
}

/** The note on one exercise in this workout, such as the seat setting or which bench was free. */
function ExerciseNoteForm({ workoutId, exerciseId, note, onDone }: ExerciseNoteFormProps) {
  const { act, pending, error } = useAction()
  const [text, setText] = useState(note)

  const save = (value: string) =>
    act(async () => {
      await setExerciseNote({ data: { workoutId, exerciseId, note: value } })
      onDone()
    })

  return (
    <div className="space-y-3 pb-3">
      <Field label="Note for this workout">
        <TextArea
          value={text}
          rows={3}
          maxLength={500}
          placeholder="Seat on 4, the far bench, felt strong…"
          data-testid={testIds.workout.exerciseNote}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <ErrorNote message={error} />
      <Button
        variant="primary"
        className="w-full"
        disabled={pending}
        data-testid={testIds.workout.saveExerciseNote}
        onClick={() => save(text)}
      >
        Save note
      </Button>
      {note === "" ? null : (
        <Button variant="ghost" className="w-full" disabled={pending} onClick={() => save("")}>
          Remove note
        </Button>
      )}
    </div>
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

/** What the warm-up is done with, for the line under it. */
const WARMUP_NOTES: Record<LoadKind, string> = {
  bar: "Warm-up sets are a guide and are not logged.",
  stack: "Lighter settings on the same machine. A guide, and not logged.",
  dumbbells: "Lighter dumbbells before the working weight. A guide, and not logged.",
  none: "",
}

interface LoadingGuideProps {
  readonly kind: LoadKind
  readonly weight: number
  readonly unit: Unit
}

/** Warm-up sets leading to a weight, and for a barbell lift the plates to put on each side of the bar for it. */
function LoadingGuide({ kind, weight, unit }: LoadingGuideProps) {
  const bars = BAR_WEIGHTS[unit]
  const [bar, setBar] = useState(bars[0] ?? 0)
  const onBar = kind === "bar"

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
  const warmups = warmupFor(kind, weight, bar, unit)

  return (
    <div className="space-y-5 pb-3">
      {onBar ? (
        <>
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
        </>
      ) : null}

      <div>
        <p className="eyebrow pb-2 text-muted">
          Warm-up for {formatWeight(weight)} {unit}
        </p>
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
                {onBar ? (
                  <span className="tabular text-sm text-muted">
                    {(platesPerSide(set.weight, bar, unit)?.perSide ?? []).map(formatWeight).join(" + ") || "bar only"}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        <p className="pt-2 text-sm text-faint">{WARMUP_NOTES[kind]}</p>
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
      <header className="pb-5 pt-2" data-testid={testIds.workout.summary}>
        <p className="eyebrow pb-1 text-accent">Workout complete · {formatDay(workout.startedAt)}</p>
        <h1 className="display text-5xl">{workout.name}</h1>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Minutes" value={minutes > 0 ? minutes : "–"} />
        <Stat label="Sets" value={allSets.length} testId={testIds.workout.summarySets} />
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
            {exercise.sets.some((set) => set.note !== "") ? (
              <span className="block space-y-0.5 pt-2 text-sm text-muted">
                {exercise.sets.map((set, index) =>
                  set.note === "" ? null : (
                    <span key={set.id} className="block">
                      Set {index + 1}: {set.note}
                    </span>
                  ),
                )}
              </span>
            ) : null}
            {exercise.note === "" ? null : <span className="block whitespace-pre-line pt-2 text-sm text-muted">{exercise.note}</span>}
          </Link>
        ))}
      </div>

      <Link to="/" className={buttonClass("primary", "mt-6 w-full")} data-testid={testIds.workout.done}>
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
