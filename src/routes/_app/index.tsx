import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, FlameIcon } from "~/components/icons"
import { Button, buttonClass, Card, ErrorNote, PageTitle, SectionTitle, useAction, useNow } from "~/components/ui"
import { summariseWeek } from "~/domain/week"
import { estimateMinutes, formatCompact, formatDay, formatReps, formatWeight } from "~/format"
import { deleteCoachNote, getToday, startOpenWorkout, startWorkout } from "~/functions/api"
import type { ActivityEntry, Adjustment } from "~/server/repo"

export const Route = createFileRoute("/_app/")({
  loader: () => getToday(),
  component: TodayPage,
})

const SOURCE_LABELS = { rule: "Auto", ai: "Coach", user: "You" } as const
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
const longDay = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" })

function TodayPage() {
  const { today, activity } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const navigate = useNavigate()
  const now = useNow()
  const { act, pending, error } = useAction()
  const nextDay = today.plan?.days.find((day) => day.id === today.nextDayId)
  const otherDays = today.plan?.days.filter((day) => day.id !== today.nextDayId) ?? []

  const start = (planDayId: number | null) =>
    act(async () => {
      const workoutId = planDayId === null ? await startOpenWorkout() : await startWorkout({ data: { planDayId } })

      await navigate({ to: "/workout/$workoutId", params: { workoutId: String(workoutId) } })
    })

  return (
    <>
      <PageTitle eyebrow={now === null ? "" : longDay.format(now)}>Hi {user.displayName}</PageTitle>
      <ErrorNote message={error} />

      <WeekCard activity={activity} now={now} unit={user.unit} />

      {today.activeWorkout ? (
        <Hero eyebrow="In progress" title={today.activeWorkout.name}>
          <Link
            to="/workout/$workoutId"
            params={{ workoutId: String(today.activeWorkout.id) }}
            className={buttonClass("primary", "mt-5 w-full")}
          >
            Continue workout
          </Link>
        </Hero>
      ) : null}

      {!today.activeWorkout && nextDay ? (
        <Hero eyebrow={`Up next · ${today.plan?.name ?? ""}`} title={nextDay.name}>
          <p className="tabular pt-2 text-sm text-muted">
            {nextDay.exercises.length} exercises · {nextDay.exercises.reduce((total, item) => total + item.sets, 0)} sets
            · about {estimateMinutes(nextDay.exercises)} min
          </p>
          <ol className="mt-4 divide-y divide-white/5 border-y border-white/5">
            {nextDay.exercises.map((exercise, index) => (
              <li key={exercise.id} className="flex items-center gap-3 py-2.5">
                <span className="display tabular w-5 shrink-0 text-lg text-faint">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{exercise.exerciseName}</span>
                <span className="tabular shrink-0 text-right text-sm text-muted">
                  {exercise.sets} × {formatReps(exercise.repMin, exercise.repMax)}
                  <span className="block font-semibold text-white">
                    {exercise.targetWeight === null ? "Find it" : `${formatWeight(exercise.targetWeight)} ${user.unit}`}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <Button
            variant="primary"
            className="mt-5 w-full"
            disabled={pending || nextDay.exercises.length === 0}
            onClick={() => start(nextDay.id)}
          >
            Start workout
          </Button>
        </Hero>
      ) : null}

      {today.activeWorkout ? null : (
        <>
          <SectionTitle>Or do something else</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {otherDays.map((day) => (
              <Button key={day.id} disabled={pending || day.exercises.length === 0} onClick={() => start(day.id)}>
                {day.name}
              </Button>
            ))}
            <Button
              className="border border-dashed border-line bg-transparent"
              disabled={pending}
              onClick={() => start(null)}
            >
              Open workout
            </Button>
          </div>
          <p className="pt-2 text-sm text-faint">An open workout follows no plan. You add exercises as you go.</p>
        </>
      )}

      {today.plan ? null : (
        <Hero eyebrow="Get started" title="No plan yet">
          <p className="pb-5 pt-2 text-muted">
            Connect your AI coach and ask it to build one around your goals, or pick a starter plan.
          </p>
          <div className="flex gap-2">
            <Link to="/settings" className={buttonClass("primary", "flex-1")}>
              Connect coach
            </Link>
            <Link to="/plan" className={buttonClass("secondary", "flex-1")}>
              Starter plans
            </Link>
          </div>
        </Hero>
      )}

      {today.notes.length > 0 ? (
        <>
          <SectionTitle>From your coach</SectionTitle>
          <div className="space-y-2">
            {today.notes.map((note) => (
              <section key={note.id} className="rounded-3xl border border-accent/20 bg-accent/[0.06] p-4">
                <p className="whitespace-pre-wrap leading-relaxed">{note.body}</p>
                <div className="flex items-center justify-between pt-1 text-sm text-muted">
                  <span>{formatDay(note.createdAt)}</span>
                  <button
                    type="button"
                    className="min-h-11 px-2 font-semibold"
                    disabled={pending}
                    onClick={() => act(() => deleteCoachNote({ data: { noteId: note.id } }))}
                  >
                    Dismiss
                  </button>
                </div>
              </section>
            ))}
          </div>
        </>
      ) : null}

      {today.adjustments.length > 0 ? (
        <>
          <SectionTitle>Recent changes</SectionTitle>
          <Card>
            <ul className="divide-y divide-white/5">
              {today.adjustments.map((adjustment) => (
                <li key={adjustment.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <Direction adjustment={adjustment} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-semibold">{adjustment.exerciseName}</span>
                      <span className="tabular shrink-0 text-sm text-muted">
                        {adjustment.oldWeight === null ? "–" : formatWeight(adjustment.oldWeight)}
                        {" → "}
                        <span className="font-semibold text-white">
                          {adjustment.newWeight === null ? "–" : formatWeight(adjustment.newWeight)} {user.unit}
                        </span>
                      </span>
                    </div>
                    <p className="text-sm text-muted">
                      <span className="font-semibold text-white">{SOURCE_LABELS[adjustment.source]}</span> ·{" "}
                      {adjustment.reason}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}
    </>
  )
}

interface HeroProps {
  readonly eyebrow: string
  readonly title: string
  readonly children: React.ReactNode
}

/** The main card on the screen, with a glow in the corner. */
function Hero({ eyebrow, title, children }: HeroProps) {
  return (
    <section className="relative mt-3 overflow-hidden rounded-[2rem] border border-accent/25 bg-surface p-5">
      <div
        className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-accent/20 blur-3xl"
        aria-hidden="true"
      />
      <div className="relative">
        <p className="eyebrow truncate text-accent">{eyebrow}</p>
        <h2 className="display pt-1 text-5xl">{title}</h2>
        {children}
      </div>
    </section>
  )
}

interface WeekCardProps {
  readonly activity: ReadonlyArray<ActivityEntry>
  readonly now: number | null
  readonly unit: string
}

/** This week at a glance: which days were trained, the totals, and the weekly streak. */
function WeekCard({ activity, now, unit }: WeekCardProps) {
  const week = now === null ? null : summariseWeek(activity, now)

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow text-muted">This week</p>
        <p className={`flex items-center gap-1 text-sm font-semibold ${week?.streakWeeks ? "text-accent" : "text-faint"}`}>
          <FlameIcon className="size-4" />
          {week?.streakWeeks ? `${week.streakWeeks} week streak` : "No streak yet"}
        </p>
      </div>
      <ol className="grid grid-cols-7 gap-1 pt-3" aria-label="Days trained this week">
        {WEEKDAYS.map((name, index) => {
          const trained = week?.days[index] ?? false
          const isToday = week?.todayIndex === index

          return (
            <li key={name} className="flex flex-col items-center gap-1.5">
              <span className={`text-xs font-semibold ${isToday ? "text-white" : "text-faint"}`}>{name.charAt(0)}</span>
              <span
                className={`flex size-9 items-center justify-center rounded-full ${
                  trained
                    ? "bg-accent text-accent-ink"
                    : isToday
                      ? "border-2 border-accent/70"
                      : "border border-line bg-raised/50"
                }`}
              >
                {trained ? <CheckIcon /> : null}
                <span className="sr-only">{trained ? "Trained" : "Not trained"}</span>
              </span>
            </li>
          )
        })}
      </ol>
      <dl className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-raised/70 px-3 py-2.5">
          <dd className="display tabular text-3xl">{week?.workouts ?? "–"}</dd>
          <dt className="text-xs text-muted">Workouts</dt>
        </div>
        <div className="rounded-2xl bg-raised/70 px-3 py-2.5">
          <dd className="display tabular text-3xl">
            {week ? formatCompact(week.volume) : "–"}
            <span className="pl-1 text-base text-muted">{unit}</span>
          </dd>
          <dt className="text-xs text-muted">Lifted</dt>
        </div>
      </dl>
    </Card>
  )
}

/** An arrow showing whether a weight went up or down. */
function Direction({ adjustment }: { readonly adjustment: Adjustment }) {
  const { oldWeight, newWeight } = adjustment
  const went = oldWeight === null || newWeight === null || oldWeight === newWeight ? "same" : newWeight > oldWeight ? "up" : "down"

  if (went === "up") {
    return (
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent">
        <ArrowUpIcon />
      </span>
    )
  }

  if (went === "down") {
    return (
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-400/12 text-amber-300">
        <ArrowDownIcon />
      </span>
    )
  }

  return <span className="size-9 shrink-0 rounded-full bg-raised" aria-hidden="true" />
}
