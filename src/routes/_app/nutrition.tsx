import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Schema } from "effect"
import { useState } from "react"
import { BackButton, Card, SectionTitle, useNow } from "~/components/ui"
import { DayTotals, FoodEditor, FoodList, TargetsForm, WeekBars } from "~/components/nutrition"
import { localDay } from "~/domain/health"
import { shiftDay } from "~/domain/days"
import { describeDay, nutritionDays, nutritionRange, WEEK_DAYS, type FoodEntry } from "~/domain/nutrition"
import { Day } from "~/domain/schema"
import { getNutrition } from "~/functions/api"

/** The day shown. Left out for the device's today, which only the browser knows. */
const Search = Schema.Struct({ day: Schema.optional(Day) })

export const Route = createFileRoute("/_app/nutrition")({
  validateSearch: Schema.toStandardSchemaV1(Search),
  loaderDeps: ({ search }) => ({ day: search.day }),
  loader: ({ deps }) => getNutrition({ data: nutritionRange(deps.day, Date.now()) }),
  component: NutritionPage,
})

/** The food log a day at a time: totals against the targets, what was eaten, and the week around it. */
function NutritionPage() {
  const now = useNow()

  return (
    <>
      <BackButton fallback="/" />
      {now === null ? (
        <h1 className="display pb-5 pt-5 text-5xl">Food</h1>
      ) : (
        <FoodDay today={localDay(now)} />
      )}
    </>
  )
}

function FoodDay({ today }: { readonly today: string }) {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  // A day still to come (from an old link, say) shows today instead, so nothing is logged ahead.
  const day = search.day !== undefined && search.day <= today ? search.day : today
  const [editing, setEditing] = useState<FoodEntry | null>(null)
  const weekFrom = shiftDay(day, 1 - WEEK_DAYS)
  // Worked out again here so a day outside what was loaded still shows, empty, while the next one loads.
  const week = nutritionDays(weekFrom, day, data.entries, [])
  const loadedDays = new Map(data.days.map((item) => [item.day, item]))
  const days = week.map((item) => loadedDays.get(item.day) ?? item)
  const shown = days.at(-1)!
  const entries = data.entries.filter((entry) => entry.day === day)

  const show = (next: string) => {
    setEditing(null)
    void navigate({ to: "/nutrition", search: next === today ? {} : { day: next } })
  }

  return (
    <>
      <p className="eyebrow min-h-4 pb-1 text-accent">{describeDay(day, today)}</p>
      <div className="flex items-end justify-between gap-3 pb-5">
        <h1 className="display text-5xl">Food</h1>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="The day before"
            className="flex size-11 items-center justify-center rounded-full bg-raised text-xl text-muted"
            onClick={() => show(shiftDay(day, -1))}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="The day after"
            disabled={day >= today}
            className="flex size-11 items-center justify-center rounded-full bg-raised text-xl text-muted disabled:opacity-30"
            onClick={() => show(shiftDay(day, 1))}
          >
            ›
          </button>
        </div>
      </div>

      <DayTotals day={shown} targets={data.targets} />

      <SectionTitle>{editing ? "Change entry" : "Log food"}</SectionTitle>
      <Card>
        <FoodEditor key={`${day}-${editing?.id ?? "new"}`} day={day} editing={editing} onDone={() => setEditing(null)} />
      </Card>
      <p className="pt-2 text-sm text-faint">Or tell your coach what you ate, and it estimates and logs it for you.</p>

      <SectionTitle>Eaten</SectionTitle>
      <FoodList entries={entries} editingId={editing?.id ?? null} onEdit={setEditing} onStopEditing={() => setEditing(null)} />

      <SectionTitle>Week</SectionTitle>
      <WeekBars days={days} selected={day} target={data.targets.calories} onSelect={show} />

      <SectionTitle>Daily targets</SectionTitle>
      <Card>
        <TargetsForm key={`${data.targets.calories}-${data.targets.protein}`} targets={data.targets} />
      </Card>
    </>
  )
}
