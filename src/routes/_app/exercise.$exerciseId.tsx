import { createFileRoute, Link } from "@tanstack/react-router"
import { TrendChart } from "~/components/chart"
import { Card, SectionTitle, Stat } from "~/components/ui"
import { formatDay, formatWeight } from "~/format"
import { getExerciseProgress } from "~/functions/api"

export const Route = createFileRoute("/_app/exercise/$exerciseId")({
  loader: ({ params }) => getExerciseProgress({ data: { exerciseId: Number(params.exerciseId) } }),
  component: ExercisePage,
})

function ExercisePage() {
  const { exercise, points } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const latest = points.at(-1)
  const best = points.reduce((max, point) => Math.max(max, point.estimatedOneRepMax), 0)

  return (
    <>
      <Link to="/history" className="eyebrow inline-flex min-h-11 items-center text-accent">
        ‹ History
      </Link>
      <h1 className="display pb-5 text-5xl">{exercise.name}</h1>

      {latest ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Last top set" value={`${formatWeight(latest.topWeight)} × ${latest.topReps}`} />
            <Stat label="Best estimated 1RM" value={formatWeight(best)} unit={user.unit} />
          </div>

          <SectionTitle>Estimated one-rep max</SectionTitle>
          <Card>
            <TrendChart
              label="Estimated one-rep max"
              unit={user.unit}
              points={points.map((point) => ({
                id: point.workoutId,
                date: point.date,
                value: point.estimatedOneRepMax,
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
                    {formatWeight(point.topWeight)} {user.unit} × {point.topReps}
                    <span className="pl-2 font-normal text-faint">{point.sets} sets</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : (
        <p className="text-muted">Nothing logged for this exercise yet.</p>
      )}
    </>
  )
}
