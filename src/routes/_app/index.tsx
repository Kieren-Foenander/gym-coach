import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Button, Card, ErrorNote, PageTitle, SectionTitle, useAction } from "~/components/ui"
import { formatDay, formatPrescription, formatWeight } from "~/format"
import { deleteCoachNote, getToday, startWorkout } from "~/functions/api"

export const Route = createFileRoute("/_app/")({
  loader: () => getToday(),
  component: TodayPage,
})

const SOURCE_LABELS = { rule: "Auto", ai: "Coach", user: "You" } as const

function TodayPage() {
  const today = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const navigate = useNavigate()
  const { act, pending, error } = useAction()
  const nextDay = today.plan?.days.find((day) => day.id === today.nextDayId)
  const otherDays = today.plan?.days.filter((day) => day.id !== today.nextDayId) ?? []

  const start = (planDayId: number) =>
    act(async () => {
      const workoutId = await startWorkout({ data: { planDayId } })

      await navigate({ to: "/workout/$workoutId", params: { workoutId: String(workoutId) } })
    })

  return (
    <>
      <PageTitle>Hi {user.displayName}</PageTitle>
      <ErrorNote message={error} />

      {today.activeWorkout ? (
        <Card className="border-accent-strong">
          <p className="text-sm text-accent">Workout in progress</p>
          <h2 className="pb-3 text-2xl font-bold">{today.activeWorkout.name}</h2>
          <Link
            to="/workout/$workoutId"
            params={{ workoutId: String(today.activeWorkout.id) }}
            className="flex min-h-12 items-center justify-center rounded-xl bg-accent-strong font-semibold text-white"
          >
            Continue
          </Link>
        </Card>
      ) : null}

      {!today.activeWorkout && nextDay ? (
        <Card>
          <p className="text-sm text-neutral-400">Up next · {today.plan?.name}</p>
          <h2 className="pb-3 text-2xl font-bold">{nextDay.name}</h2>
          <ul className="space-y-2 pb-4">
            {nextDay.exercises.map((exercise) => (
              <li key={exercise.id} className="flex items-baseline justify-between gap-3">
                <span className="truncate">{exercise.exerciseName}</span>
                <span className="tabular shrink-0 text-sm text-neutral-400">
                  {formatPrescription(exercise, user.unit)}
                </span>
              </li>
            ))}
          </ul>
          <Button
            variant="primary"
            className="w-full"
            disabled={pending || nextDay.exercises.length === 0}
            onClick={() => start(nextDay.id)}
          >
            Start workout
          </Button>
        </Card>
      ) : null}

      {!today.activeWorkout && otherDays.length > 0 ? (
        <>
          <SectionTitle>Or do a different day</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {otherDays.map((day) => (
              <Button key={day.id} disabled={pending || day.exercises.length === 0} onClick={() => start(day.id)}>
                {day.name}
              </Button>
            ))}
          </div>
        </>
      ) : null}

      {today.plan ? null : (
        <Card>
          <h2 className="pb-1 text-xl font-bold">No plan yet</h2>
          <p className="pb-4 text-neutral-400">
            Connect your AI coach and ask it to build one around your goals, or pick a starter plan.
          </p>
          <div className="flex gap-2">
            <Link
              to="/settings"
              className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-accent-strong font-semibold text-white"
            >
              Connect coach
            </Link>
            <Link
              to="/plan"
              className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-raised font-semibold"
            >
              Starter plans
            </Link>
          </div>
        </Card>
      )}

      {today.notes.length > 0 ? (
        <>
          <SectionTitle>From your coach</SectionTitle>
          <div className="space-y-2">
            {today.notes.map((note) => (
              <Card key={note.id}>
                <p className="whitespace-pre-wrap">{note.body}</p>
                <div className="flex items-center justify-between pt-2 text-sm text-neutral-500">
                  <span>{formatDay(note.createdAt)}</span>
                  <button
                    type="button"
                    className="min-h-11 px-2"
                    disabled={pending}
                    onClick={() => act(() => deleteCoachNote({ data: { noteId: note.id } }))}
                  >
                    Dismiss
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {today.adjustments.length > 0 ? (
        <>
          <SectionTitle>Recent changes</SectionTitle>
          <Card>
            <ul className="divide-y divide-line">
              {today.adjustments.map((adjustment) => (
                <li key={adjustment.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-semibold">{adjustment.exerciseName}</span>
                    <span className="tabular shrink-0 text-sm">
                      {adjustment.oldWeight === null ? "–" : formatWeight(adjustment.oldWeight)}
                      {" → "}
                      {adjustment.newWeight === null ? "–" : formatWeight(adjustment.newWeight)} {user.unit}
                    </span>
                  </div>
                  <p className="text-sm text-neutral-400">
                    <span className="text-neutral-300">{SOURCE_LABELS[adjustment.source]}</span> · {adjustment.reason}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}
    </>
  )
}
