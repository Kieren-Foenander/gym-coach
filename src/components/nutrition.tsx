import { Link } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { ChevronIcon, CloseIcon } from "~/components/icons"
import { Button, Card, cardClass, ErrorNote, Field, SectionTitle, TextInput, useAction } from "~/components/ui"
import {
  describeMacros,
  describeTarget,
  EMPTY_FOOD_FORM,
  foodFormFor,
  formatAmount,
  NUTRIENT_INFO,
  readFoodForm,
  readTarget,
  shortDay,
  targetProgress,
  type FoodEntry,
  type FoodForm,
  type Nutrient,
  type NutritionDay,
  type NutritionTargets,
} from "~/domain/nutrition"
import { deleteFood, logFood, updateFood, updateProfile } from "~/functions/api"

/** A bar filling up towards a target. Amber once it is past it. */
function TargetBar({ value, target, label }: { readonly value: number; readonly target: number | null; readonly label: string }) {
  const progress = targetProgress(value, target)

  if (progress === null) return null

  const over = target !== null && value > target

  return (
    <div
      className="mt-2 h-2 overflow-hidden rounded-full bg-raised"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
    >
      <div className={`h-full rounded-full ${over ? "bg-amber-300" : "bg-accent"}`} style={{ width: `${progress * 100}%` }} />
    </div>
  )
}

interface TargetStatProps {
  readonly nutrient: Nutrient
  readonly value: number
  readonly target: number | null
}

/** One nutrient's total for the day, against its target when there is one. */
function TargetStat({ nutrient, value, target }: TargetStatProps) {
  const info = NUTRIENT_INFO[nutrient]

  return (
    <div className="rounded-2xl bg-raised/70 px-3 py-3">
      <p className="display tabular text-3xl">
        {formatAmount(value)}
        <span className="pl-1 text-base text-muted">
          {target === null ? info.unit : `/ ${formatAmount(target)} ${info.unit}`}
        </span>
      </p>
      <p className="pt-1 text-xs text-muted">
        {info.label} · {describeTarget(nutrient, value, target)}
      </p>
      <TargetBar value={value} target={target} label={`${info.label} against target`} />
    </div>
  )
}

/** A day's calories and macros, against the targets, saying how much came from Apple Health. */
export function DayTotals({ day, targets }: { readonly day: NutritionDay; readonly targets: NutritionTargets }) {
  return (
    <>
      <div className="grid gap-2">
        <TargetStat nutrient="calories" value={day.total.calories} target={targets.calories} />
        <TargetStat nutrient="protein" value={day.total.protein} target={targets.protein} />
      </div>
      <dl className="grid grid-cols-2 gap-2 pt-2">
        {(["carbs", "fat"] as const).map((nutrient) => (
          <div key={nutrient} className="rounded-2xl bg-raised/70 px-3 py-2.5">
            <dd className="display tabular text-2xl">
              {formatAmount(day.total[nutrient])}
              <span className="pl-1 text-base text-muted">g</span>
            </dd>
            <dt className="text-xs text-muted">{NUTRIENT_INFO[nutrient].label}</dt>
          </div>
        ))}
      </dl>
      {day.health ? (
        <p className="pt-2 text-sm text-faint">
          Includes {formatAmount(day.health.calories)} kcal and {formatAmount(day.health.protein)} g protein from Apple Health.
        </p>
      ) : null}
    </>
  )
}

interface FoodFormProps {
  readonly day: string
  /** The entry being changed, or null to add a new one. */
  readonly editing: FoodEntry | null
  readonly onDone: () => void
}

/** Adds an entry to the day, or changes one. Calories are needed; the macros are optional. */
export function FoodEditor({ day, editing, onDone }: FoodFormProps) {
  const { act, pending, error } = useAction()
  const [form, setForm] = useState<FoodForm>(editing ? foodFormFor(editing) : EMPTY_FOOD_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const set = (field: keyof FoodForm) => (event: { target: { value: string } }) => setForm({ ...form, [field]: event.target.value })

  const submit = (event: FormEvent) => {
    event.preventDefault()

    const read = readFoodForm(form)

    if (!read.ok) {
      setFormError(read.error)

      return
    }

    setFormError(null)

    void act(async () => {
      if (editing) await updateFood({ data: { foodId: editing.id, food: read.food } })
      else await logFood({ data: { day, food: read.food } })

      setForm(EMPTY_FOOD_FORM)
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <Field label="What you ate">
        <TextInput
          value={form.description}
          maxLength={200}
          placeholder="Chicken, rice and broccoli"
          onChange={set("description")}
        />
      </Field>
      <div className="grid grid-cols-4 gap-2">
        {(["calories", "protein", "carbs", "fat"] as const).map((nutrient) => (
          <Field key={nutrient} label={nutrient === "calories" ? "kcal" : `${NUTRIENT_INFO[nutrient].label} g`}>
            <TextInput
              inputMode={nutrient === "calories" ? "numeric" : "decimal"}
              className="tabular px-3 text-center"
              value={form[nutrient]}
              onChange={set(nutrient)}
            />
          </Field>
        ))}
      </div>
      <ErrorNote message={formError ?? error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" className="flex-1" disabled={pending}>
          {editing ? "Save" : "Add food"}
        </Button>
        {editing ? (
          <Button variant="ghost" disabled={pending} onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  )
}

interface FoodListProps {
  readonly entries: ReadonlyArray<FoodEntry>
  readonly editingId: number | null
  readonly onEdit: (entry: FoodEntry) => void
}

/** The day's entries. Tap one to change it. */
export function FoodList({ entries, editingId, onEdit }: FoodListProps) {
  const { act, pending, error } = useAction()

  if (entries.length === 0) {
    return (
      <p className="rounded-3xl border border-dashed border-line px-4 py-8 text-center text-muted">
        Nothing logged in the app for this day.
      </p>
    )
  }

  return (
    <>
      <ErrorNote message={error} />
      <Card className="py-1">
        <ul className="divide-y divide-white/5">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-1">
              <button
                type="button"
                className={`min-h-14 min-w-0 flex-1 py-2 text-left ${editingId === entry.id ? "text-accent" : ""}`}
                onClick={() => onEdit(entry)}
              >
                <span className="block truncate font-semibold">{entry.description}</span>
                <span className="tabular block text-sm text-muted">
                  {formatAmount(entry.calories)} kcal
                  {describeMacros(entry) === "" ? "" : ` · ${describeMacros(entry)}`}
                  {entry.source === "ai" ? " · Coach" : ""}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${entry.description}`}
                className="flex size-11 shrink-0 items-center justify-center text-faint"
                disabled={pending}
                onClick={() => act(() => deleteFood({ data: { foodId: entry.id } }))}
              >
                <CloseIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

interface WeekBarsProps {
  /** Oldest first. */
  readonly days: ReadonlyArray<NutritionDay>
  readonly selected: string
  readonly target: number | null
  readonly onSelect: (day: string) => void
}

/** Calories each day of the week, as bars, with the target marked. Tap a day to show it. */
export function WeekBars({ days, selected, target, onSelect }: WeekBarsProps) {
  const top = Math.max(target ?? 0, ...days.map((day) => day.total.calories), 1)

  return (
    <Card>
      <div className="relative flex h-32 items-end gap-2">
        {target === null ? null : (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-accent/50"
            style={{ bottom: `${(target / top) * 100}%` }}
            aria-hidden="true"
          />
        )}
        {days.map((day) => (
          <button
            key={day.day}
            type="button"
            aria-label={`${shortDay(day.day)}: ${formatAmount(day.total.calories)} kcal`}
            aria-pressed={day.day === selected}
            className="flex h-full flex-1 items-end"
            onClick={() => onSelect(day.day)}
          >
            <span
              className={`block w-full rounded-t-lg ${day.day === selected ? "bg-accent" : "bg-line"}`}
              style={{ height: `${Math.max(2, (day.total.calories / top) * 100)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="flex gap-2 pt-2">
        {days.map((day) => (
          <span key={day.day} className={`flex-1 text-center text-xs ${day.day === selected ? "text-white" : "text-faint"}`}>
            {shortDay(day.day)}
          </span>
        ))}
      </div>
      {target === null ? null : <p className="pt-2 text-xs text-faint">The dashed line is your calorie target.</p>}
    </Card>
  )
}

/** The daily calorie and protein targets. The coach can set these too. */
export function TargetsForm({ targets }: { readonly targets: NutritionTargets }) {
  const { act, pending, error } = useAction()
  const [calories, setCalories] = useState(targets.calories === null ? "" : String(targets.calories))
  const [protein, setProtein] = useState(targets.protein === null ? "" : String(targets.protein))
  const [formError, setFormError] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()

    const calorieTarget = readTarget("calories", calories)
    const proteinTarget = readTarget("protein", protein)

    if (!calorieTarget.ok) {
      setFormError(calorieTarget.error)

      return
    }

    if (!proteinTarget.ok) {
      setFormError(proteinTarget.error)

      return
    }

    setFormError(null)

    void act(async () => {
      await updateProfile({ data: { calorieTarget: calorieTarget.value, proteinTarget: proteinTarget.value } })
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Calories (kcal)">
          <TextInput inputMode="numeric" className="tabular" value={calories} onChange={(event) => setCalories(event.target.value)} />
        </Field>
        <Field label="Protein (g)">
          <TextInput inputMode="numeric" className="tabular" value={protein} onChange={(event) => setProtein(event.target.value)} />
        </Field>
      </div>
      <ErrorNote message={formError ?? error} />
      <Button type="submit" disabled={pending}>
        Save targets
      </Button>
      <p className="text-sm text-faint">Leave one blank for no target. Your coach can set these for you too.</p>
    </form>
  )
}

interface NutritionCardProps {
  /** Today's totals, or undefined before the device's day is known. */
  readonly day: NutritionDay | undefined
  readonly targets: NutritionTargets
}

/** Today's calories and protein on the home screen, leading to the food log. */
export function NutritionCard({ day, targets }: NutritionCardProps) {
  return (
    <>
      <SectionTitle>Food</SectionTitle>
      <Link to="/nutrition" className={`${cardClass} block active:bg-raised`}>
        <div className="flex items-center justify-between gap-3">
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
            {(["calories", "protein"] as const).map((nutrient) => {
              const value = day?.total[nutrient] ?? 0
              const target = targets[nutrient]

              return (
                <div key={nutrient} className="min-w-0">
                  <p className="display tabular truncate text-3xl">
                    {formatAmount(value)}
                    <span className="pl-1 text-base text-muted">{NUTRIENT_INFO[nutrient].unit}</span>
                  </p>
                  <p className="truncate text-xs text-muted">
                    {NUTRIENT_INFO[nutrient].label}
                    {target === null ? " today" : ` of ${formatAmount(target)}`}
                  </p>
                  <TargetBar value={value} target={target} label={`${NUTRIENT_INFO[nutrient].label} against target`} />
                </div>
              )
            })}
          </div>
          <ChevronIcon className="size-5 shrink-0 text-faint" />
        </div>
      </Link>
    </>
  )
}
