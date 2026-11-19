import { createFileRoute } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { ExercisePicker } from "~/components/exercise"
import { ArrowDownIcon, ArrowUpIcon, ChevronIcon } from "~/components/icons"
import {
  Button,
  Card,
  ErrorNote,
  Field,
  PageTitle,
  parseNumber,
  Sheet,
  TextArea,
  TextInput,
  useAction,
} from "~/components/ui"
import { isCardio } from "~/domain/catalog"
import { PLAN_TEMPLATES } from "~/domain/templates"
import { formatPrescription, formatWeight } from "~/format"
import {
  addPlanDay,
  addPlanExercise,
  applyTemplate,
  getPlan,
  movePlanDay,
  movePlanExercise,
  removePlanDay,
  removePlanExercise,
  updatePlanExercise,
} from "~/functions/api"
import type { Direction } from "~/domain/schema"
import type { PlanExercise } from "~/server/repo"
import { testIds } from "~/domain/test-ids"

export const Route = createFileRoute("/_app/plan")({
  loader: () => getPlan(),
  component: PlanPage,
})

type Editing =
  | { readonly mode: "edit"; readonly exercise: PlanExercise }
  | { readonly mode: "add"; readonly planDayId: number; readonly dayName: string }
  | { readonly mode: "day" }
  | { readonly mode: "templates" }
  | null

function PlanPage() {
  const plan = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const [editing, setEditing] = useState<Editing>(null)
  const { act, pending, error } = useAction()
  const [reordering, setReordering] = useState(false)
  const close = () => setEditing(null)

  const removeDay = (planDayId: number, name: string) => {
    if (!window.confirm(`Remove ${name} from the plan? Logged workouts are kept.`)) return

    void act(() => removePlanDay({ data: { planDayId } }))
  }

  return (
    <>
      <PageTitle
        action={
          plan ? (
            <Button variant={reordering ? "primary" : "secondary"} onClick={() => setReordering(!reordering)}>
              {reordering ? "Done" : "Reorder"}
            </Button>
          ) : undefined
        }
      >
        Plan
      </PageTitle>
      <ErrorNote message={error} />

      {plan ? (
        <>
          <div className="pb-4">
            <p className="eyebrow pb-1 text-accent">{plan.source === "ai" ? "Written by your coach" : "Your plan"}</p>
            <h2 className="display text-3xl">{plan.name}</h2>
            {plan.description ? <p className="pt-1 text-muted">{plan.description}</p> : null}
            <p className="pt-1 text-sm text-faint">
              {reordering ? "Use the arrows to move days and exercises." : "Tap an exercise to change it."}
            </p>
          </div>

          <div className="space-y-3">
            {plan.days.map((day, dayIndex) => (
              <Card key={day.id}>
                <div className="flex items-center justify-between gap-3 pb-1">
                  <h3 className="min-w-0">
                    <span className="eyebrow block text-xs text-faint">Day {dayIndex + 1}</span>
                    <span className="display block truncate text-2xl">{day.name}</span>
                  </h3>
                  {reordering ? (
                    <MoveButtons
                      name={day.name}
                      first={dayIndex === 0}
                      last={dayIndex === plan.days.length - 1}
                      disabled={pending}
                      onMove={(direction) => act(() => movePlanDay({ data: { planDayId: day.id, direction } }))}
                    />
                  ) : (
                    <button
                      type="button"
                      className="min-h-11 shrink-0 px-2 text-sm font-semibold text-faint"
                      disabled={pending}
                      onClick={() => removeDay(day.id, day.name)}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-white/5">
                  {day.exercises.map((exercise, exerciseIndex) => (
                    <li key={exercise.id}>
                      {reordering ? (
                        <div className="flex min-h-14 items-center justify-between gap-3 py-1">
                          <span className="min-w-0 truncate font-semibold">{exercise.exerciseName}</span>
                          <MoveButtons
                            name={exercise.exerciseName}
                            first={exerciseIndex === 0}
                            last={exerciseIndex === day.exercises.length - 1}
                            disabled={pending}
                            onMove={(direction) =>
                              act(() => movePlanExercise({ data: { planExerciseId: exercise.id, direction } }))
                            }
                          />
                        </div>
                      ) : (
                      <button
                        type="button"
                        className="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left"
                        onClick={() => setEditing({ mode: "edit", exercise })}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{exercise.exerciseName}</span>
                          <span className="tabular block text-sm text-muted">
                            {formatPrescription(exercise, user.unit)}
                          </span>
                        </span>
                        <ChevronIcon className="size-4 shrink-0 text-faint" />
                      </button>
                      )}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="ghost"
                  className="mt-1 w-full"
                  onClick={() => setEditing({ mode: "add", planDayId: day.id, dayName: day.name })}
                >
                  Add exercise
                </Button>
              </Card>
            ))}
          </div>

          <div className="flex gap-2 pt-4">
            <Button className="flex-1" onClick={() => setEditing({ mode: "day" })}>
              Add day
            </Button>
            <Button className="flex-1" onClick={() => setEditing({ mode: "templates" })}>
              Switch plan
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="pb-4 text-muted">
            Ask your AI coach to write a plan for you, or start from one of these. Weights are worked out in your first
            session.
          </p>
          <TemplateList onDone={close} />
          <Button className="mt-3 w-full" onClick={() => setEditing({ mode: "day" })}>
            Build my own
          </Button>
        </>
      )}

      {editing?.mode === "edit" ? (
        <Sheet title={editing.exercise.exerciseName} onClose={close}>
          <ExerciseForm exercise={editing.exercise} unit={user.unit} onDone={close} />
        </Sheet>
      ) : null}
      {editing?.mode === "add" ? (
        <Sheet title={`Add to ${editing.dayName}`} onClose={close}>
          <ExerciseForm
            planDayId={editing.planDayId}
            taken={plan?.days.find((day) => day.id === editing.planDayId)?.exercises.map((item) => item.exerciseName)}
            unit={user.unit}
            onDone={close}
          />
        </Sheet>
      ) : null}
      {editing?.mode === "day" ? (
        <Sheet title="Add a day" onClose={close}>
          <DayForm onDone={close} />
        </Sheet>
      ) : null}
      {editing?.mode === "templates" ? (
        <Sheet title="Switch plan" onClose={close}>
          <p className="pb-3 text-muted">Your current plan is archived, and your logged workouts are kept.</p>
          <TemplateList onDone={close} />
        </Sheet>
      ) : null}
    </>
  )
}

interface MoveButtonsProps {
  readonly name: string
  readonly first: boolean
  readonly last: boolean
  readonly disabled: boolean
  readonly onMove: (direction: Direction) => void
}

const MOVE_BUTTON = "flex size-11 items-center justify-center rounded-xl bg-raised text-white disabled:opacity-25"

/** Up and down arrows for moving one item within its list. */
function MoveButtons({ name, first, last, disabled, onMove }: MoveButtonsProps) {
  return (
    <span className="flex shrink-0 gap-1">
      <button
        type="button"
        aria-label={`Move ${name} up`}
        className={MOVE_BUTTON}
        disabled={disabled || first}
        onClick={() => onMove("up")}
      >
        <ArrowUpIcon />
      </button>
      <button
        type="button"
        aria-label={`Move ${name} down`}
        className={MOVE_BUTTON}
        disabled={disabled || last}
        onClick={() => onMove("down")}
      >
        <ArrowDownIcon />
      </button>
    </span>
  )
}

function TemplateList({ onDone }: { readonly onDone: () => void }) {
  const { act, pending, error } = useAction()

  return (
    <div className="space-y-2 pb-2">
      <ErrorNote message={error} />
      {PLAN_TEMPLATES.map((template) => (
        <button
          key={template.id}
          type="button"
          disabled={pending}
          data-testid={testIds.plan.template(template.id)}
          className="flex w-full items-center justify-between gap-3 rounded-3xl border border-white/5 bg-raised/60 p-4 text-left transition active:scale-[0.98] active:border-accent/40 disabled:opacity-50"
          onClick={() =>
            act(async () => {
              await applyTemplate({ data: { templateId: template.id } })
              onDone()
            })
          }
        >
          <span className="min-w-0">
            <span className="eyebrow block text-xs text-accent">{template.plan.days.length} days</span>
            <span className="display block text-2xl">{template.plan.name}</span>
            <span className="block text-sm text-muted">{template.summary}</span>
          </span>
          <ChevronIcon className="shrink-0 text-faint" />
        </button>
      ))}
    </div>
  )
}

function DayForm({ onDone }: { readonly onDone: () => void }) {
  const { act, pending, error } = useAction()
  const [name, setName] = useState("")

  const submit = (event: FormEvent) => {
    event.preventDefault()

    void act(async () => {
      await addPlanDay({ data: { name } })
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <Field label="Day name">
        <TextInput
          required
          maxLength={80}
          placeholder="Upper body"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <ErrorNote message={error} />
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        Add day
      </Button>
    </form>
  )
}

interface ExerciseFormProps {
  readonly exercise?: PlanExercise
  readonly planDayId?: number
  /** Exercises already on the day being added to. */
  readonly taken?: ReadonlyArray<string>
  readonly unit: "kg" | "lb"
  readonly onDone: () => void
}

function ExerciseForm({ exercise, planDayId, taken = [], unit, onDone }: ExerciseFormProps) {
  const { act, pending, error } = useAction()
  const [formError, setFormError] = useState<string | null>(null)
  const [name, setName] = useState(exercise?.exerciseName ?? "")
  const [sets, setSets] = useState(String(exercise?.sets ?? 3))
  const [repMin, setRepMin] = useState(String(exercise?.repMin ?? 8))
  const [repMax, setRepMax] = useState(String(exercise?.repMax ?? 12))

  const [weight, setWeight] = useState(
    exercise?.targetWeight === null || exercise === undefined ? "" : formatWeight(exercise.targetWeight),
  )

  const [increment, setIncrement] = useState(formatWeight(exercise?.increment ?? (unit === "kg" ? 2.5 : 5)))
  const [rest, setRest] = useState(String(exercise?.restSeconds ?? 120))
  const [notes, setNotes] = useState(exercise?.notes ?? "")
  const [autoProgress, setAutoProgress] = useState(exercise?.autoProgress ?? true)

  // Cardio has rounds and a rest between them. What to aim for goes in the notes.
  const cardio = isCardio(name)

  const submit = (event: FormEvent) => {
    event.preventDefault()

    const numbers = {
      sets: parseNumber(sets),
      repMin: cardio ? 1 : parseNumber(repMin),
      repMax: cardio ? 1 : parseNumber(repMax),
      increment: parseNumber(increment),
      restSeconds: parseNumber(rest),
    }

    if (
      numbers.sets === null ||
      numbers.repMin === null ||
      numbers.repMax === null ||
      numbers.increment === null ||
      numbers.restSeconds === null
    ) {
      setFormError("Fill in every number")

      return
    }

    setFormError(null)

    const changes = {
      sets: numbers.sets,
      repMin: numbers.repMin,
      repMax: numbers.repMax,
      increment: numbers.increment,
      restSeconds: numbers.restSeconds,
      targetWeight: cardio ? null : parseNumber(weight),
      notes,
      autoProgress: cardio ? false : autoProgress,
    }

    void act(async () => {
      if (exercise) await updatePlanExercise({ data: { planExerciseId: exercise.id, changes } })
      else if (planDayId !== undefined) {
        await addPlanExercise({ data: { planDayId, exercise: { exercise: name, ...changes } } })
      }

      onDone()
    })
  }

  const remove = () => {
    if (!exercise || !window.confirm(`Remove ${exercise.exerciseName} from the plan?`)) return

    void act(async () => {
      await removePlanExercise({ data: { planExerciseId: exercise.id } })
      onDone()
    })
  }

  // Adding starts with choosing the exercise; the numbers come after.
  if (!exercise && name === "") {
    return (
      <div className="pb-3">
        <ExercisePicker taken={taken} disabled={pending} onPick={setName} />
      </div>
    )
  }

  const strengthFields = (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Sets">
          <TextInput inputMode="numeric" value={sets} onChange={(event) => setSets(event.target.value)} />
        </Field>
        <Field label="Reps from">
          <TextInput inputMode="numeric" value={repMin} onChange={(event) => setRepMin(event.target.value)} />
        </Field>
        <Field label="Reps to">
          <TextInput inputMode="numeric" value={repMax} onChange={(event) => setRepMax(event.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label={`Weight (${unit})`}>
          <TextInput
            inputMode="decimal"
            placeholder="Find it"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
          />
        </Field>
        <Field label={`Step (${unit})`}>
          <TextInput inputMode="decimal" value={increment} onChange={(event) => setIncrement(event.target.value)} />
        </Field>
        <Field label="Rest (sec)">
          <TextInput inputMode="numeric" value={rest} onChange={(event) => setRest(event.target.value)} />
        </Field>
      </div>
      <label className="flex min-h-12 items-center justify-between gap-3">
        <span>
          <span className="block">Adjust weight automatically</span>
          <span className="block text-sm text-muted">Up when you hit every rep, down after two bad sessions</span>
        </span>
        <input
          type="checkbox"
          className="size-6 accent-accent"
          checked={autoProgress}
          onChange={(event) => setAutoProgress(event.target.checked)}
        />
      </label>
    </>
  )

  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      {exercise ? null : (
        <div className="flex items-center justify-between gap-3">
          <h3 className="display min-w-0 truncate text-2xl">{name}</h3>
          <Button variant="ghost" className="shrink-0 px-3" onClick={() => setName("")}>
            Change
          </Button>
        </div>
      )}
      {cardio ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rounds">
            <TextInput inputMode="numeric" value={sets} onChange={(event) => setSets(event.target.value)} />
          </Field>
          <Field label="Rest between (sec)">
            <TextInput inputMode="numeric" value={rest} onChange={(event) => setRest(event.target.value)} />
          </Field>
        </div>
      ) : (
        strengthFields
      )}
      <Field label={cardio ? "Target, such as 20 min easy" : "Notes"}>
        <TextArea rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>
      <ErrorNote message={formError ?? error} />
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {exercise ? "Save" : "Add exercise"}
      </Button>
      {exercise ? (
        <Button variant="danger" className="w-full" disabled={pending} onClick={remove}>
          Remove from plan
        </Button>
      ) : null}
    </form>
  )
}
