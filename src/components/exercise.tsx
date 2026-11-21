import { Link } from "@tanstack/react-router"
import { useEffect, useState, type ReactNode } from "react"
import { TrendChart } from "~/components/chart"
import { BarbellIcon, CheckIcon, ChevronIcon, CloseIcon, SearchIcon } from "~/components/icons"
import { BackButton, Button, Card, ErrorNote, SectionTitle, Segmented, Sheet, Stat, TextInput, useAction } from "~/components/ui"
import {
  CATALOG,
  catalogForMuscle,
  isCardio,
  MUSCLES,
  mergeLibrary,
  searchLibrary,
  type CatalogExercise,
  type KnownExercise,
  type LibraryItem,
  type Muscle,
} from "~/domain/catalog"
import { demoFile, demoFor, type ExerciseDemo } from "~/domain/demos"
import { howToFor } from "~/domain/howto"
import { distanceUnit, type Unit } from "~/domain/schema"
import { testIds } from "~/domain/test-ids"
import { heaviestSet } from "~/domain/progression"
import { formatDay, formatDuration, formatSet, formatWeight } from "~/format"
import { addPlanExercise, getExercises } from "~/functions/api"
import type { Plan, ProgressPoint } from "~/server/repo"

/** Loads the user's exercises once, for suggestion lists. Empty until loaded, and stays empty if loading fails. */
export const useKnownExercises = () => {
  const [known, setKnown] = useState<ReadonlyArray<KnownExercise>>([])

  useEffect(() => {
    let active = true

    // Suggestions are a convenience. If they fail to load, the library and typing a name still work.
    getExercises().then(
      (loaded) => {
        if (active) setKnown(loaded)
      },
      () => undefined,
    )

    return () => {
      active = false
    }
  }, [])

  return known
}

/** What an exercise is done with and what it mainly works, as one line. */
export const describeItem = (item: LibraryItem): string =>
  item.entry ? `${item.entry.equipment} · ${item.entry.primary.join(", ")}` : item.known?.muscleGroup || "Your own"

const isMuscle = (text: string): text is Muscle => MUSCLES.some((muscle) => muscle === text)

/** The poster of an exercise's demonstration, or the app's mark until one has been rendered. */
function Thumbnail({ entry }: { readonly entry: CatalogExercise | null }) {
  const demo = entry ? demoFor(entry.slug) : null

  return (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-ink text-line">
      {demo ? (
        <img src={`${demoFile(demo, demo.views[0] ?? "front")}.webp`} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <BarbellIcon className="size-6" />
      )}
    </span>
  )
}

interface ExerciseLineProps {
  readonly item: LibraryItem
  /** What sits at the right-hand end. A chevron by default. */
  readonly trailing?: ReactNode
}

/** The inside of one row in a list of exercises. */
export function ExerciseLine({ item, trailing }: ExerciseLineProps) {
  return (
    <>
      <Thumbnail entry={item.entry} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate font-semibold">{item.name}</span>
        <span className="block truncate text-sm text-muted">
          {describeItem(item)}
          {item.known?.lastPerformedAt ? <span className="text-accent"> · Logged</span> : null}
        </span>
      </span>
      {trailing ?? <ChevronIcon className="size-4 shrink-0 text-faint" />}
    </>
  )
}

interface SearchFieldProps {
  /** From src/domain/test-ids.ts. */
  readonly testId?: string
  readonly value: string
  readonly placeholder: string
  readonly onChange: (value: string) => void
}

export function SearchField({ testId, value, placeholder, onChange }: SearchFieldProps) {
  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-faint" />
      <TextInput
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        aria-label="Search exercises"
        data-testid={testId}
        maxLength={80}
        className="pl-12 pr-12 [&::-webkit-search-cancel-button]:hidden"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value === "" ? null : (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute right-0.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center text-faint"
          onClick={() => onChange("")}
        >
          <CloseIcon className="size-4" />
        </button>
      )}
    </div>
  )
}

const PICKER_LIMIT = 40

interface ExercisePickerProps {
  /** Names already in use here, which are left out. */
  readonly taken: ReadonlyArray<string>
  /** Offer this muscle group's exercises before anything is typed. */
  readonly group?: string
  readonly disabled: boolean
  readonly onPick: (name: string) => void
}

/** Search the library and the user's own exercises and pick one, or use a new name as typed. */
export function ExercisePicker({ taken, group = "", disabled, onPick }: ExercisePickerProps) {
  const [text, setText] = useState("")
  const known = useKnownExercises()
  const query = text.trim()
  const skip = taken.map((name) => name.toLowerCase())
  const items = mergeLibrary(known).filter((item) => !skip.includes(item.name.toLowerCase()))

  const recent = items
    .filter((item) => item.known?.lastPerformedAt)
    .toSorted((a, b) => (b.known?.lastPerformedAt ?? 0) - (a.known?.lastPerformedAt ?? 0))
    .slice(0, 8)

  const inGroup = isMuscle(group)
    ? items.filter((item) => item.entry?.primary.includes(group))
    : items.filter((item) => group !== "" && item.entry === null && item.known?.muscleGroup === group)

  const heading = query !== "" ? null : inGroup.length > 0 ? `Other ${group.toLowerCase()} exercises` : "Recent"
  const shown = query !== "" ? searchLibrary(items, query) : inGroup.length > 0 ? inGroup : recent
  const exact = items.some((item) => item.name.toLowerCase() === query.toLowerCase())

  return (
    <div className="space-y-3">
      <SearchField
        testId={testIds.exercisePicker.search}
        value={text}
        placeholder={`Search ${CATALOG.length} exercises`}
        onChange={setText}
      />

      {heading !== null && shown.length > 0 ? <p className="eyebrow pt-1 text-muted">{heading}</p> : null}

      {shown.length > 0 ? (
        <ul className="divide-y divide-white/5">
          {shown.slice(0, PICKER_LIMIT).map((item) => (
            <li key={item.name}>
              <button
                type="button"
                disabled={disabled}
                data-testid={testIds.exercisePicker.option(item.name)}
                className="flex min-h-16 w-full items-center gap-3 py-2 active:bg-raised disabled:opacity-40"
                onClick={() => onPick(item.name)}
              >
                <ExerciseLine item={item} trailing={<span className="eyebrow shrink-0 text-xs text-accent">Add</span>} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {shown.length > PICKER_LIMIT ? (
        <p className="text-center text-sm text-faint">Keep typing to narrow down {shown.length} matches.</p>
      ) : null}

      {query !== "" && !exact ? (
        <Button className="w-full" disabled={disabled} onClick={() => onPick(query)}>
          <span className="truncate">Use “{query}” as a new exercise</span>
        </Button>
      ) : null}
    </div>
  )
}

/** A looping demonstration of the movement, with a switch between the views that were rendered. */
function Demonstration({ demo, name }: { readonly demo: ExerciseDemo; readonly name: string }) {
  const [view, setView] = useState(demo.views[0] ?? "front")
  const file = demoFile(demo, view)

  return (
    <section className="mb-4 overflow-hidden rounded-3xl border border-white/5 bg-ink">
      <video
        key={file}
        className="max-h-[52dvh] w-full object-contain"
        src={`${file}.mp4`}
        poster={`${file}.webp`}
        aria-label={`${name} demonstration, ${view} view`}
        autoPlay
        loop
        muted
        playsInline
      />
      {demo.views.length > 1 ? (
        <div className="border-t border-white/5 bg-surface p-4">
          <Segmented label="View" options={demo.views} value={view} onChange={setView} />
        </div>
      ) : null}
    </section>
  )
}

/** What the exercise works and how to do it. */
function About({ entry }: { readonly entry: CatalogExercise }) {
  const steps = howToFor(entry.name)

  return (
    <Card className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {entry.primary.map((muscle) => (
          <span key={muscle} className="eyebrow rounded-full bg-accent px-3 py-1 text-xs text-accent-ink">
            {muscle}
          </span>
        ))}
        {entry.secondary.map((muscle) => (
          <span key={muscle} className="eyebrow rounded-full bg-accent/15 px-3 py-1 text-xs text-accent">
            {muscle}
          </span>
        ))}
      </div>
      {steps.length > 0 ? (
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted marker:font-semibold marker:text-accent">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {entry.aliases.length > 0 ? <p className="text-sm text-faint">Also called {entry.aliases.join(", ")}.</p> : null}
    </Card>
  )
}

const DEFAULT_PRESCRIPTION = { sets: 3, repMin: 8, repMax: 12 } as const
const CARDIO_PRESCRIPTION = { sets: 1, repMin: 1, repMax: 1 } as const

interface AddToPlanProps {
  readonly name: string
  readonly plan: Plan
  readonly onClose: () => void
}

/** Puts the exercise at the end of one of the plan's days, with a starting prescription to adjust later. */
function AddToPlan({ name, plan, onClose }: AddToPlanProps) {
  const { act, pending, error } = useAction()
  const [addedTo, setAddedTo] = useState<string | null>(null)
  const cardio = isCardio(name)
  const prescription = cardio ? CARDIO_PRESCRIPTION : DEFAULT_PRESCRIPTION

  const add = (planDayId: number, dayName: string) =>
    act(async () => {
      await addPlanExercise({ data: { planDayId, exercise: { exercise: name, ...prescription } } })
      setAddedTo(dayName)
    })

  return (
    <Sheet title="Add to plan" onClose={onClose}>
      <div className="space-y-3 pb-3">
        {addedTo === null ? (
          <p className="text-muted">Pick a day. {name} goes at the end of it.</p>
        ) : (
          <p role="status" className="rounded-2xl bg-accent/12 px-4 py-3 text-accent">
            {cardio
              ? `Added to ${addedTo} as 1 round. Set a target and more rounds under Plan.`
              : `Added to ${addedTo} at 3 × 8–12. Change the sets, reps and weight under Plan.`}
          </p>
        )}
        <ErrorNote message={error} />
        <ul className="space-y-2">
          {plan.days.map((day) => {
            const there = day.exercises.some((exercise) => exercise.exerciseName.toLowerCase() === name.toLowerCase())

            return (
              <li key={day.id}>
                <Button className="w-full justify-between" disabled={pending || there} onClick={() => add(day.id, day.name)}>
                  <span className="truncate">{day.name}</span>
                  {there ? <CheckIcon className="size-4 shrink-0" /> : null}
                </Button>
              </li>
            )
          })}
        </ul>
        {addedTo === null ? null : (
          <Link to="/plan" className="eyebrow flex min-h-11 items-center justify-center text-accent">
            Open plan
          </Link>
        )}
      </div>
    </Sheet>
  )
}

interface CardioProgressProps {
  /** Oldest first, and not empty. */
  readonly points: ReadonlyArray<ProgressPoint>
  readonly unit: Unit
}

const session = (point: ProgressPoint) => ({ weight: 0, reps: 0, durationSeconds: point.durationSeconds, distance: point.distance })

/** Progress on something logged by time and distance: the last session, the longest, and the trend. */
function CardioProgress({ points, unit }: CardioProgressProps) {
  const latest = points.at(-1)
  const longest = points.reduce((max, point) => Math.max(max, point.durationSeconds), 0)
  const furthest = points.reduce((max, point) => Math.max(max, point.distance), 0)
  // Distance says more than time when it is logged; the chart follows whichever the user records.
  const byDistance = points.every((point) => point.distance > 0)

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Last session" value={latest ? formatSet(session(latest), unit) : ""} />
        {furthest > 0 ? (
          <Stat label="Furthest" value={formatWeight(furthest)} unit={distanceUnit(unit)} />
        ) : (
          <Stat label="Longest" value={formatDuration(longest)} />
        )}
      </div>

      <SectionTitle>{byDistance ? "Distance each session" : "Minutes each session"}</SectionTitle>
      <Card>
        <TrendChart
          label={byDistance ? "Distance each session" : "Minutes each session"}
          unit={byDistance ? distanceUnit(unit) : "min"}
          points={points.map((point) => ({
            id: point.workoutId,
            date: point.date,
            value: byDistance ? point.distance : Math.round(point.durationSeconds / 6) / 10,
          }))}
        />
      </Card>

      <SectionTitle>Sessions</SectionTitle>
      <Card>
        <ul className="divide-y divide-white/5">
          {points.toReversed().map((point) => (
            <li key={point.workoutId} className="flex items-baseline justify-between gap-3 py-2">
              <span className="text-muted">{formatDay(point.date)}</span>
              <span className="tabular font-semibold">
                {formatSet(session(point), unit)}
                {point.sets > 1 ? <span className="pl-2 font-normal text-faint">{point.sets} rounds</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

interface ExerciseDetailProps {
  readonly name: string
  /** The library entry, or null for an exercise the user made up. */
  readonly entry: CatalogExercise | null
  /** Oldest first. */
  readonly points: ReadonlyArray<ProgressPoint>
  readonly plan: Plan | null
  readonly unit: Unit
}

/** Everything about one exercise: how it is done, what it works, and the user's progress on it. */
export function ExerciseDetail({ name, entry, points, plan, unit }: ExerciseDetailProps) {
  const [adding, setAdding] = useState(false)
  const latest = points.at(-1)
  const heaviest = heaviestSet(points)
  const demo = entry ? demoFor(entry.slug) : null
  const cardio = isCardio(name)

  return (
    <>
      <BackButton fallback="/exercises" />
      <p className="eyebrow min-h-4 pb-1 text-muted">{entry ? entry.equipment : "Your own exercise"}</p>
      <h1 className="display pb-5 text-5xl">{name}</h1>

      {demo ? <Demonstration key={demo.slug} demo={demo} name={name} /> : null}
      {entry ? <About entry={entry} /> : null}

      {plan && plan.days.length > 0 ? (
        <Button className="w-full" onClick={() => setAdding(true)}>
          Add to plan
        </Button>
      ) : null}

      <SectionTitle>Your progress</SectionTitle>
      {latest && cardio ? <CardioProgress points={points} unit={unit} /> : null}
      {latest && !cardio ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Last top set" value={`${formatWeight(latest.topWeight)} × ${latest.topReps}`} />
            <Stat label="Heaviest set" value={heaviest ? `${formatWeight(heaviest.topWeight)} × ${heaviest.topReps}` : ""} />
          </div>

          <SectionTitle>Top set weight</SectionTitle>
          <Card>
            <TrendChart
              label="Heaviest set each session"
              unit={unit}
              best
              points={points.map((point) => ({
                id: point.workoutId,
                date: point.date,
                value: point.topWeight,
              }))}
            />
          </Card>

          <SectionTitle>Sessions</SectionTitle>
          <Card>
            <ul className="divide-y divide-white/5">
              {points.toReversed().map((point) => (
                <li key={point.workoutId} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="text-muted">{formatDay(point.date)}</span>
                  <span className="tabular font-semibold">
                    {formatWeight(point.topWeight)} {unit} × {point.topReps}
                    <span className="pl-2 font-normal text-faint">{point.sets} sets</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}
      {latest ? null : <p className="text-muted">Nothing logged for this exercise yet.</p>}

      {adding && plan ? <AddToPlan name={name} plan={plan} onClose={() => setAdding(false)} /> : null}
    </>
  )
}

/** How many library exercises mainly work each muscle, for the muscle grid. */
export const MUSCLE_COUNTS: ReadonlyArray<{ readonly muscle: Muscle; readonly count: number }> = MUSCLES.map((muscle) => ({
  muscle,
  count: catalogForMuscle(muscle).length,
}))
