import { createFileRoute, Link } from "@tanstack/react-router"
import { Card, SectionTitle, Stat } from "~/components/ui"
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
            <TrendChart points={points} unit={user.unit} />
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
      <div className="flex justify-between pb-1 text-xs text-faint">
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
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#d7ff3e" stopOpacity="0.28" />
            <stop offset="1" stopColor="#d7ff3e" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PAD} x2={WIDTH - PAD} y1={PAD} y2={PAD} stroke="#272b33" strokeDasharray="3 4" />
        <line x1={PAD} x2={WIDTH - PAD} y1={HEIGHT - PAD} y2={HEIGHT - PAD} stroke="#272b33" strokeDasharray="3 4" />
        {points.length > 1 ? (
          <path d={`${path} L${x(points.length - 1).toFixed(1)},${HEIGHT} L${x(0).toFixed(1)},${HEIGHT} Z`} fill="url(#trend-fill)" />
        ) : null}
        <path d={path} fill="none" stroke="#d7ff3e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {values.map((value, index) => (
          <circle key={points[index]?.workoutId} cx={x(index)} cy={y(value)} r={index === values.length - 1 ? 4.5 : 3} fill="#d7ff3e" />
        ))}
      </svg>
      <figcaption className="flex justify-between pt-1 text-xs text-faint">
        <span>{first ? formatDay(first.date) : ""}</span>
        <span>{last && points.length > 1 ? formatDay(last.date) : ""}</span>
      </figcaption>
    </figure>
  )
}
