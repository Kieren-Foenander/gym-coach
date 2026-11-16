import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { TrendChart } from "~/components/chart"
import { Card, Segmented, SectionTitle, Stat } from "~/components/ui"
import { demoFile, demoFor, type ExerciseDemo } from "~/domain/demos"
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
  const demo = demoFor(exercise.name)

  return (
    <>
      <Link to="/history" className="eyebrow inline-flex min-h-11 items-center text-accent">
        ‹ History
      </Link>
      <h1 className="display pb-5 text-5xl">{exercise.name}</h1>

      {demo ? <Demonstration key={demo.slug} demo={demo} name={exercise.name} /> : null}

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

/** A looping demonstration of the movement, with the muscles it works. */
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
      <div className="space-y-3 border-t border-white/5 bg-surface p-4">
        {demo.views.length > 1 ? <Segmented label="View" options={demo.views} value={view} onChange={setView} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          {demo.primary.map((muscle) => (
            <span key={muscle} className="eyebrow rounded-full bg-accent px-3 py-1 text-xs text-accent-ink">
              {muscle}
            </span>
          ))}
          {demo.secondary.map((muscle) => (
            <span key={muscle} className="eyebrow rounded-full bg-accent/15 px-3 py-1 text-xs text-accent">
              {muscle}
            </span>
          ))}
        </div>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted marker:font-semibold marker:text-accent">
          {demo.cues.map((cue) => (
            <li key={cue}>{cue}</li>
          ))}
        </ol>
      </div>
    </section>
  )
}
