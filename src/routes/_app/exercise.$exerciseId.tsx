import { createFileRoute, Link } from "@tanstack/react-router"
import { Card, SectionTitle } from "~/components/ui"
import { formatDay, formatWeight } from "~/format"
import { getExerciseProgress } from "~/functions/api"
import type { ProgressPoint } from "~/server/repo"

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
      <Link to="/history" className="inline-flex min-h-11 items-center text-neutral-400">
        ‹ History
      </Link>
      <h1 className="pb-4 text-3xl font-bold tracking-tight">{exercise.name}</h1>

      {latest ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <p className="text-sm text-neutral-400">Last top set</p>
              <p className="tabular text-2xl font-bold">
                {formatWeight(latest.topWeight)} × {latest.topReps}
              </p>
            </Card>
            <Card>
              <p className="text-sm text-neutral-400">Best estimated 1RM</p>
              <p className="tabular text-2xl font-bold">
                {formatWeight(best)} {user.unit}
              </p>
            </Card>
          </div>

          <SectionTitle>Estimated one-rep max</SectionTitle>
          <Card>
            <TrendChart points={points} unit={user.unit} />
          </Card>

          <SectionTitle>Sessions</SectionTitle>
          <Card>
            <ul className="divide-y divide-line">
              {points.toReversed().map((point) => (
                <li key={point.workoutId} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="text-neutral-400">{formatDay(point.date)}</span>
                  <span className="tabular font-semibold">
                    {formatWeight(point.topWeight)} {user.unit} × {point.topReps}
                    <span className="pl-2 font-normal text-neutral-500">{point.sets} sets</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : (
        <p className="text-neutral-400">Nothing logged for this exercise yet.</p>
      )}
    </>
  )
}

const WIDTH = 320
const HEIGHT = 140
const PAD = 8

/** A single-series line: estimated one-rep max per session, oldest on the left. */
function TrendChart({ points, unit }: { readonly points: ReadonlyArray<ProgressPoint>; readonly unit: string }) {
  const values = points.map((point) => point.estimatedOneRepMax)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const span = high - low || 1
  const x = (index: number) => (points.length === 1 ? WIDTH / 2 : PAD + (index * (WIDTH - PAD * 2)) / (points.length - 1))
  const y = (value: number) => HEIGHT - PAD - ((value - low) / span) * (HEIGHT - PAD * 2)
  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ")
  const first = points[0]
  const last = points.at(-1)

  return (
    <figure>
      <div className="flex justify-between pb-1 text-xs text-neutral-500">
        <span className="tabular">
          High {formatWeight(high)} {unit}
        </span>
        <span className="tabular">
          Low {formatWeight(low)} {unit}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`Estimated one-rep max over ${points.length} sessions, from ${formatWeight(values[0] ?? 0)} to ${formatWeight(values.at(-1) ?? 0)} ${unit}`}
      >
        <line x1={PAD} x2={WIDTH - PAD} y1={PAD} y2={PAD} stroke="#2e2e2e" strokeDasharray="3 4" />
        <line x1={PAD} x2={WIDTH - PAD} y1={HEIGHT - PAD} y2={HEIGHT - PAD} stroke="#2e2e2e" strokeDasharray="3 4" />
        <path d={path} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {values.map((value, index) => (
          <circle key={points[index]?.workoutId} cx={x(index)} cy={y(value)} r={index === values.length - 1 ? 4.5 : 3} fill="#22c55e" />
        ))}
      </svg>
      <figcaption className="flex justify-between pt-1 text-xs text-neutral-500">
        <span>{first ? formatDay(first.date) : ""}</span>
        <span>{last && points.length > 1 ? formatDay(last.date) : ""}</span>
      </figcaption>
    </figure>
  )
}
