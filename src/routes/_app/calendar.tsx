import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { ChevronIcon } from "~/components/icons"
import { BackButton, Card, cardClass, SectionTitle, Stat, useNow } from "~/components/ui"
import { byDay, countInMonth, monthGrid, shiftMonth, startOfDay, weeklyStreaks } from "~/domain/week"
import { describeTrainingDay, formatLongDay, weeksUnit } from "~/format"
import { DAY_STATES, dayKey, testIds } from "~/domain/test-ids"
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

/** Every day trained, a month at a time, with the weekly streak marked on it. */
function CalendarPage() {
  const workouts = Route.useLoaderData()
  const now = useNow()

  return (
    <>
      <BackButton fallback="/" />
      <p className="eyebrow min-h-4 pb-1 text-accent">Weekly streak</p>
      <h1 className="display pb-5 text-5xl">Calendar</h1>
      {now === null ? null : <Calendar workouts={workouts} now={now} />}
    </>
  )
}

interface CalendarProps {
  readonly workouts: ReadonlyArray<CalendarWorkout>
  readonly now: number
}

function Calendar({ workouts, now }: CalendarProps) {
  const navigate = useNavigate()
  const thisMonth = shiftMonth(now, 0)
  const firstMonth = shiftMonth(workouts[0]?.startedAt ?? now, 0)
  const [month, setMonth] = useState(thisMonth)
  const [selected, setSelected] = useState<number | null>(null)
  // Over the whole history, so worked out once rather than on every tap.
  const streaks = useMemo(() => weeklyStreaks(workouts.map((workout) => workout.startedAt), now), [workouts, now])
  const days = useMemo(() => byDay(workouts), [workouts])
  const grid = monthGrid(month)
  const today = startOfDay(now)
  const inMonth = useMemo(() => countInMonth(workouts, month), [workouts, month])
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
        <Stat
          label="Current streak"
          value={streaks.current}
          unit={weeksUnit(streaks.current)}
          testId={testIds.calendar.currentStreak}
        />
        <Stat
          label="Longest streak"
          value={streaks.longest}
          unit={weeksUnit(streaks.longest)}
          testId={testIds.calendar.longestStreak}
        />
        <Stat label={`Workouts in ${shortMonth.format(month)}`} value={inMonth} testId={testIds.calendar.workoutsInMonth} />
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
              className={`grid grid-cols-7 rounded-full ${streaks.currentWeeks.has(week.monday) ? "bg-accent/10" : ""}`}
            >
              {week.days.map((day, index) =>
                day === null ? (
                  <span key={index} />
                ) : (
                  <span key={day} className="flex justify-center py-0.5">
                    <DayButton
                      day={day}
                      count={days.get(day)?.length ?? 0}
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
            <span className="size-3 rounded-full bg-accent" aria-hidden="true" /> Trained
          </span>
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

interface DayButtonProps {
  readonly day: number
  readonly count: number
  readonly isToday: boolean
  readonly isFuture: boolean
  readonly isSelected: boolean
  readonly onClick: () => void
}

function DayButton({ day, count, isToday, isFuture, isSelected, onClick }: DayButtonProps) {
  const date = new Date(day).getDate()
  const label = describeTrainingDay(day, count)

  if (count === 0) {
    return (
      <span
        data-testid={testIds.calendar.day(day)}
        data-state={DAY_STATES.rest}
        className={`tabular flex size-10 items-center justify-center rounded-full text-sm ${
          isToday ? "border-2 border-accent/70 font-semibold text-white" : isFuture ? "text-line" : "text-muted"
        }`}
      >
        <span aria-hidden="true">{date}</span>
        <span className="sr-only">{label}</span>
      </span>
    )
  }

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={count > 1 ? isSelected : undefined}
      data-testid={testIds.calendar.day(day)}
      data-state={DAY_STATES.trained}
      data-value={count}
      onClick={onClick}
      className={`tabular relative flex size-10 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-ink active:bg-accent-strong ${
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
