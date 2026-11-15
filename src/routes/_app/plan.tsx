import { createFileRoute } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
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
import { PLAN_TEMPLATES } from "~/domain/templates"
import { formatPrescription, formatWeight } from "~/format"
import {
  addPlanDay,
  addPlanExercise,
  applyTemplate,
  getPlan,
  removePlanDay,
  removePlanExercise,
  updatePlanExercise,
} from "~/functions/api"
import type { PlanExercise } from "~/server/repo"

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
  const close = () => setEditing(null)

  const removeDay = (planDayId: number, name: string) => {
    if (!window.confirm(`Remove ${name} from the plan? Logged workouts are kept.`)) return

    void act(() => removePlanDay({ data: { planDayId } }))
  }

  return (
    <>
      <PageTitle>Plan</PageTitle>
      <ErrorNote message={error} />

      {plan ? (
        <>
          <div className="pb-2">
            <h2 className="text-xl font-bold">{plan.name}</h2>
            {plan.description ? <p className="text-neutral-400">{plan.description}</p> : null}
            <p className="pt-1 text-sm text-neutral-500">
              {plan.source === "ai" ? "Written by your coach" : "Your plan"} · tap an exercise to change it
            </p>
          </div>

          <div className="space-y-3">
            {plan.days.map((day) => (
              <Card key={day.id}>
                <div className="flex items-center justify-between gap-3 pb-1">
                  <h3 className="truncate text-lg font-bold">{day.name}</h3>
                  <button
                    type="button"
                    className="min-h-11 shrink-0 px-2 text-sm text-neutral-500"
                    disabled={pending}
                    onClick={() => removeDay(day.id, day.name)}
                  >
                    Remove
                  </button>
                </div>
                <ul className="divide-y divide-line">
                  {day.exercises.map((exercise) => (
                    <li key={exercise.id}>
                      <button
                        type="button"
                        className="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left"
                        onClick={() => setEditing({ mode: "edit", exercise })}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{exercise.exerciseName}</span>
                          <span className="tabular block text-sm text-neutral-400">
                            {formatPrescription(exercise, user.unit)}
                          </span>
                        </span>
                        <span className="shrink-0 text-neutral-600" aria-hidden="true">
                          ›
                        </span>
                      </button>
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
          <p className="pb-2 text-neutral-400">
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
          <ExerciseForm planDayId={editing.planDayId} unit={user.unit} onDone={close} />
        </Sheet>
      ) : null}
      {editing?.mode === "day" ? (
        <Sheet title="Add a day" onClose={close}>
          <DayForm onDone={close} />
        </Sheet>
      ) : null}
      {editing?.mode === "templates" ? (
        <Sheet title="Switch plan" onClose={close}>
          <p className="pb-3 text-neutral-400">Your current plan is archived, and your logged workouts are kept.</p>
          <TemplateList onDone={close} />
        </Sheet>
      ) : null}
    </>
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
          className="block w-full rounded-2xl border border-line bg-surface p-4 text-left active:bg-raised disabled:opacity-50"
          onClick={() =>
            act(async () => {
              await applyTemplate({ data: { templateId: template.id } })
              onDone()
            })
          }
        >
          <span className="block text-lg font-bold">{template.plan.name}</span>
          <span className="block text-neutral-400">{template.summary}</span>
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
  readonly unit: "kg" | "lb"
  readonly onDone: () => void
}

function ExerciseForm({ exercise, planDayId, unit, onDone }: ExerciseFormProps) {
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

  const submit = (event: FormEvent) => {
    event.preventDefault()

    const numbers = {
      sets: parseNumber(sets),
      repMin: parseNumber(repMin),
      repMax: parseNumber(repMax),
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
      targetWeight: parseNumber(weight),
      notes,
      autoProgress,
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

  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      {exercise ? null : (
        <Field label="Exercise">
          <TextInput
            required
            maxLength={80}
            placeholder="Bench Press"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      )}
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
          <span className="block text-sm text-neutral-400">Up when you hit every rep, down after two bad sessions</span>
        </span>
        <input
          type="checkbox"
          className="size-6 accent-green-600"
          checked={autoProgress}
          onChange={(event) => setAutoProgress(event.target.checked)}
        />
      </label>
      <Field label="Notes">
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
