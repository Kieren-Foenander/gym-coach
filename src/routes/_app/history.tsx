import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { Card, PageTitle } from "~/components/ui"
import { formatDay, formatVolume } from "~/format"
import { getHistory } from "~/functions/api"

export const Route = createFileRoute("/_app/history")({
  loader: () => getHistory(),
  component: HistoryPage,
})

function HistoryPage() {
  const { workouts, exercises } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const [view, setView] = useState<"workouts" | "exercises">("workouts")
  const performed = exercises.filter((exercise) => exercise.lastPerformedAt !== null)

  return (
    <>
      <PageTitle>History</PageTitle>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-surface p-1" role="tablist">
        {(["workouts", "exercises"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={view === option}
            className={`min-h-11 rounded-lg font-semibold capitalize ${view === option ? "bg-raised text-neutral-50" : "text-neutral-400"}`}
            onClick={() => setView(option)}
          >
            {option}
          </button>
        ))}
      </div>

      {view === "workouts" ? (
        <div className="space-y-2">
          {workouts.length === 0 ? <p className="text-neutral-400">Finished workouts show up here.</p> : null}
          {workouts.map((workout) => (
            <Link
              key={workout.id}
              to="/workout/$workoutId"
              params={{ workoutId: String(workout.id) }}
              className="block"
            >
              <Card>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-lg font-bold">{workout.name}</span>
                  <span className="shrink-0 text-sm text-neutral-400">{formatDay(workout.startedAt)}</span>
                </div>
                <p className="tabular text-sm text-neutral-400">
                  {workout.setCount} sets · {formatVolume(workout.volume, user.unit)} lifted
                </p>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          {performed.length === 0 ? <p className="text-neutral-400">Exercises you log show up here.</p> : null}
          <ul className="divide-y divide-line">
            {performed.map((exercise) => (
              <li key={exercise.id}>
                <Link
                  to="/exercise/$exerciseId"
                  params={{ exerciseId: String(exercise.id) }}
                  className="flex min-h-14 items-center justify-between gap-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{exercise.name}</span>
                    <span className="block text-sm text-neutral-400">{exercise.muscleGroup}</span>
                  </span>
                  <span className="shrink-0 text-neutral-600" aria-hidden="true">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
