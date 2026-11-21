import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { BodyLog } from "~/components/body"
import { ChevronIcon } from "~/components/icons"
import { Card, PageTitle, Segmented, Stat } from "~/components/ui"
import { formatCompact, formatVolume } from "~/format"
import { testIds } from "~/domain/test-ids"
import { getHistory } from "~/functions/api"

export const Route = createFileRoute("/_app/history")({
  loader: () => getHistory(),
  component: HistoryPage,
})

const monthFormat = new Intl.DateTimeFormat(undefined, { month: "short" })
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long" })

function HistoryPage() {
  const { workouts, totals, exercises, measurements } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const [view, setView] = useState<"workouts" | "exercises" | "body">("workouts")
  const performed = exercises.filter((exercise) => exercise.lastPerformedAt !== null)

  return (
    <>
      <PageTitle>History</PageTitle>

      {workouts.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 pb-4">
          {/* Totals over every workout; the list below holds only the latest ones. */}
          <Stat label="Workouts" value={totals.workouts} testId={testIds.history.totalWorkouts} />
          <Stat label="Sets" value={formatCompact(totals.sets)} />
          <Stat label="Lifted" value={formatCompact(totals.volume)} unit={user.unit} />
        </div>
      ) : null}

      <Segmented label="Show" options={["workouts", "exercises", "body"] as const} value={view} onChange={setView} />

      {view === "body" ? <BodyLog measurements={measurements} unit={user.unit} /> : null}

      {view === "workouts" ? (
        <div className="space-y-2 pt-4">
          {workouts.length === 0 ? <Empty>Finished workouts show up here.</Empty> : null}
          {workouts.map((workout) => (
            <Link
              key={workout.id}
              to="/workout/$workoutId"
              params={{ workoutId: String(workout.id) }}
              className="flex items-center gap-4 rounded-3xl border border-white/5 bg-surface p-3 active:bg-raised"
            >
              <span className="flex w-14 shrink-0 flex-col items-center rounded-2xl bg-raised py-2">
                <span className="eyebrow text-xs text-accent">{monthFormat.format(workout.startedAt)}</span>
                <span className="display tabular text-3xl">{new Date(workout.startedAt).getDate()}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="display block truncate text-2xl">{workout.name}</span>
                <span className="tabular block text-sm text-muted">
                  {weekdayFormat.format(workout.startedAt)} · {workout.setCount} sets ·{" "}
                  {formatVolume(workout.volume, user.unit)}
                </span>
              </span>
              <ChevronIcon className="size-4 shrink-0 text-faint" />
            </Link>
          ))}
        </div>
      ) : null}

      {view === "exercises" ? (
        <div className="pt-4">
          {performed.length === 0 ? (
            <Empty>Exercises you log show up here.</Empty>
          ) : (
            <Card>
              <ul className="divide-y divide-white/5">
                {performed.map((exercise) => (
                  <li key={exercise.id}>
                    <Link
                      to="/exercise/$exerciseId"
                      params={{ exerciseId: String(exercise.id) }}
                      className="flex min-h-14 items-center justify-between gap-3"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{exercise.name}</span>
                        <span className="block text-sm text-muted">{exercise.muscleGroup}</span>
                      </span>
                      <ChevronIcon className="size-4 shrink-0 text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      ) : null}
    </>
  )
}

function Empty({ children }: { readonly children: string }) {
  return <p className="rounded-3xl border border-dashed border-line px-4 py-10 text-center text-muted">{children}</p>
}
