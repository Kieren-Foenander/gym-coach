import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { ChevronIcon } from "~/components/icons"
import { BackButton, Card, cardClass, SectionTitle, Stat, useNow } from "~/components/ui"
import {
  activeGoals,
  countNoun,
  countsToward,
  dayMark,
  describeGoal,
  goalStreak,
  isInRun,
  markLegend,
  streakTiles,
  type DayMark,
  type GoalStreak,
  type StreakGoal,
} from "~/domain/streaks"
import { byDay, countInMonth, monthGrid, shiftMonth, startOfDay } from "~/domain/week"
import { describeTrainingDay, formatLongDay } from "~/format"
import { dayKey, dayState, testIds } from "~/domain/test-ids"
import { getCalendar } from "~/functions/api"
import type { CalendarWorkout } from "~/server/repo"

export const Route = createFileRoute("/_app/calendar")({
  loader: () => getCalendar(),
  component: CalendarPage,
})

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
const monthFormat = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" })
const shortMonth = new Intl.DateTimeFormat(undefined, { month: "short" })
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })

/** Every day trained, a month at a time, with the streaks for the user's goals marked on it. */
function CalendarPage() {
  const workouts = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const goals = activeGoals(user.streakGoals)
  const now = useNow()

  return (
    <>
      <BackButton fallback="/" />
      <p className="eyebrow min-h-4 pb-1 text-accent">{goals.map(describeGoal).join(" · ")}</p>
      <h1 className="display pb-5 text-5xl">Calendar</h1>
      {now === null ? null : <Calendar workouts={workouts} goals={goals} now={now} />}
    </>
  )
}

interface CalendarProps {
  readonly workouts: ReadonlyArray<CalendarWorkout>
  readonly goals: ReadonlyArray<StreakGoal>
  readonly now: number
}

function Calendar({ workouts, goals, now }: CalendarProps) {
  const navigate = useNavigate()
  const thisMonth = shiftMonth(now, 0)
  const firstMonth = shiftMonth(workouts[0]?.startedAt ?? now, 0)
  const [month, setMonth] = useState(thisMonth)
  const [selected, setSelected] = useState<number | null>(null)
  // Over the whole history, so worked out once rather than on every tap.
  const streaks = useMemo(() => goals.map((goal) => goalStreak(goal, workouts, now)), [goals, workouts, now])
  const days = useMemo(() => byDay(workouts), [workouts])
  const grid = monthGrid(month)
  const today = startOfDay(now)
  const lead = streaks[0]!
  const leadActivity = lead.goal.activity

  const inMonth = useMemo(
    () => countInMonth(workouts.filter((workout) => countsToward(leadActivity, workout.kind)), month),
    [workouts, leadActivity, month],
  )

  const legend = markLegend(goals)
  // A weekly goal's run is a band along whole weeks; a daily goal's runs from day to day.
  const weeklyBand = lead.goal.period === "week"
  const picked = selected === null ? [] : (days.get(selected) ?? [])

  const show = (next: number) => {
    setMonth(next)
    setSelected(null)
  }

  const open = (day: number) => {
    const trained = days.get(day) ?? []
    const only = trained.length === 1 ? trained[0] : undefined

    if (only) void navigate({ to: "/workout/$workoutId", params: { workoutId: String(only.id) } })
    else setSelected(day === selected ? null : day)
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2 pb-4">
        {streakTiles(streaks).map((tile) => (
          <Stat
            key={tile.label}
            label={tile.label}
            value={tile.value}
            unit={tile.unit}
            testId={tile.run === "current" ? testIds.calendar.currentStreak(tile.goal) : testIds.calendar.longestStreak(tile.goal)}
          />
        ))}
        <Stat
          label={`${countNoun(leadActivity)} in ${shortMonth.format(month)}`}
          value={inMonth}
          testId={testIds.calendar.workoutsInMonth}
        />
      </div>

      <Card>
        <div className="flex items-center gap-1">
          <h2
            className="display min-w-0 flex-1 truncate text-2xl"
            aria-live="polite"
            data-testid={testIds.calendar.month}
            data-value={dayKey(month).slice(0, 7)}
          >
            {monthFormat.format(month)}
          </h2>
          {month === thisMonth ? null : (
            <button type="button" className="min-h-11 px-3 text-sm font-semibold text-accent" onClick={() => show(thisMonth)}>
              Today
            </button>
          )}
          <MonthButton
            label="Previous month"
            testId={testIds.calendar.previousMonth}
            disabled={month <= firstMonth}
            onClick={() => show(shiftMonth(month, -1))}
            flip
          />
          <MonthButton
            label="Next month"
            testId={testIds.calendar.nextMonth}
            disabled={month >= thisMonth}
            onClick={() => show(shiftMonth(month, 1))}
          />
        </div>

        <div className="grid grid-cols-7 pb-1 pt-3" aria-hidden="true">
          {WEEKDAYS.map((name) => (
            <span key={name} className="eyebrow text-center text-xs text-faint">
              {name}
            </span>
          ))}
        </div>

        <div role="group" aria-label={`Days trained in ${monthFormat.format(month)}`} className="space-y-1">
          {grid.weeks.map((week) => (
            <div
              key={week.monday}
              className={`grid grid-cols-7 rounded-full ${weeklyBand && isInRun(lead, week.monday) ? "bg-accent/10" : ""}`}
            >
              {week.days.map((day, index) =>
                day === null ? (
                  <span key={index} />
                ) : (
                  <span
                    key={day}
                    className={`flex justify-center py-0.5 ${weeklyBand ? "" : dailyBand(lead, day, week.days[index - 1], week.days[index + 1])}`}
                  >
                    <DayButton
                      day={day}
                      sessions={days.get(day) ?? []}
                      mark={dayMark(days.get(day) ?? [], goals)}
                      isToday={day === today}
                      isFuture={day > today}
                      isSelected={day === selected}
                      onClick={() => open(day)}
                    />
                  </span>
                ),
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-full bg-accent" aria-hidden="true" /> {legend.counted}
          </span>
          {legend.other ? (
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded-full border-2 border-accent bg-accent/15" aria-hidden="true" /> {legend.other}
            </span>
          ) : null}
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-full bg-accent/20" aria-hidden="true" /> Current streak
          </span>
        </div>
      </Card>

      {picked.length > 0 && selected !== null ? <DayWorkouts day={selected} workouts={picked} /> : null}

      {workouts.length === 0 ? (
        <p className="pt-4 text-center text-sm text-muted">Finish a workout and its day lights up here.</p>
      ) : null}
    </>
  )
}

interface MonthButtonProps {
  readonly label: string
  readonly testId: string
  readonly disabled: boolean
  readonly onClick: () => void
  readonly flip?: boolean
}

function MonthButton({ label, testId, disabled, onClick, flip = false }: MonthButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="flex size-11 items-center justify-center rounded-full text-white active:bg-raised disabled:text-line"
    >
      <span className={flip ? "rotate-180" : ""}>
        <ChevronIcon />
      </span>
    </button>
  )
}

/** The rounded band behind a day in a daily goal's current run, closed off where the run or the row ends. */
const dailyBand = (lead: GoalStreak, day: number, before: number | null | undefined, after: number | null | undefined) => {
  if (!isInRun(lead, day)) return ""
  const joinsBefore = before != null && isInRun(lead, before)
  const joinsAfter = after != null && isInRun(lead, after)

  return `bg-accent/10 ${joinsBefore ? "" : "rounded-l-full"} ${joinsAfter ? "" : "rounded-r-full"}`
}

interface DayButtonProps {
  readonly day: number
  readonly sessions: ReadonlyArray<CalendarWorkout>
  readonly mark: DayMark
  readonly isToday: boolean
  readonly isFuture: boolean
  readonly isSelected: boolean
  readonly onClick: () => void
}

function DayButton({ day, sessions, mark, isToday, isFuture, isSelected, onClick }: DayButtonProps) {
  const date = new Date(day).getDate()
  const count = sessions.length
  const walks = sessions.filter((session) => session.kind === "walk").length
  const label = describeTrainingDay(day, count - walks, walks)

  if (mark === null) {
    return (
      <span
        data-testid={testIds.calendar.day(day)}
        data-state={dayState(mark)}
        className={`tabular flex size-10 items-center justify-center rounded-full text-sm ${
          isToday ? "border-2 border-accent/70 font-semibold text-white" : isFuture ? "text-line" : "text-muted"
        }`}
      >
        <span aria-hidden="true">{date}</span>
        <span className="sr-only">{label}</span>
      </span>
    )
  }

  // Counted days are filled; days whose sessions count toward no goal, such as a walk, get a ring.
  const look =
    mark === "counted"
      ? "bg-accent font-bold text-accent-ink active:bg-accent-strong"
      : "border-2 border-accent bg-accent/15 font-bold text-accent active:bg-accent/30"

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={count > 1 ? isSelected : undefined}
      data-testid={testIds.calendar.day(day)}
      data-state={dayState(mark)}
      data-value={count}
      onClick={onClick}
      className={`tabular relative flex size-10 items-center justify-center rounded-full text-sm ${look} ${
        isSelected ? "ring-2 ring-white ring-offset-2 ring-offset-surface" : ""
      }`}
    >
      {date}
      {count > 1 ? (
        <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-white text-[0.625rem] text-accent-ink" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </button>
  )
}

interface DayWorkoutsProps {
  readonly day: number
  readonly workouts: ReadonlyArray<CalendarWorkout>
}

/** The workouts of a day with more than one, to pick which to open. */
function DayWorkouts({ day, workouts }: DayWorkoutsProps) {
  return (
    <>
      <SectionTitle>{formatLongDay(day)}</SectionTitle>
      <div className="space-y-2">
        {workouts.map((workout) => (
          <Link
            key={workout.id}
            data-testid={testIds.calendar.dayWorkout(workout.id)}
            to="/workout/$workoutId"
            params={{ workoutId: String(workout.id) }}
            className={`${cardClass} flex items-center gap-3 active:bg-raised`}
          >
            <span className="min-w-0 flex-1">
              <span className="display block truncate text-2xl">{workout.name}</span>
              <span className="tabular block text-sm text-muted">{timeFormat.format(workout.startedAt)}</span>
            </span>
            <span className="text-faint">
              <ChevronIcon />
            </span>
          </Link>
        ))}
      </div>
    </>
  )
}
