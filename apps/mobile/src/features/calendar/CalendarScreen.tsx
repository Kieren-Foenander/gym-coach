import { useMemo, useState } from "react"
import { Pressable, View } from "react-native"
import { localDay } from "~/domain/health"
import { miniRange, miniSessions } from "~/domain/minis"
import {
  activeGoals,
  countNoun,
  countsToward,
  dayMark,
  dayRings,
  describeGoal,
  goalStreak,
  isInRun,
  markLegend,
  ringFor,
  ringLegend,
  streakTiles,
  type GoalStreak,
  type Ring,
  type StreakGoal,
  type StreakSession,
} from "~/domain/streaks"
import { testIds } from "~/domain/test-ids"
import { byDay, countInMonth, monthGrid, shiftMonth, startOfDay } from "~/domain/week"
import { describeTrainingDay, formatLongDay } from "~/format"
import type { CalendarWorkout } from "~/server/repo"
import { describeError } from "@/api/client"
import { BackIcon, ChevronIcon } from "@/components/icons"
import { DayRings, RingSwatch } from "@/components/rings"
import { BackLink, Card, CARD_CLASS, Display, Eyebrow, Loading, Screen, SectionTitle, Stat, Text } from "@/components/ui"
import { useCall } from "@/data/calls"
import { useUser } from "@/features/user"
import { cn } from "@/lib/cn"
import { useNow } from "@/lib/useNow"
import type { AppScreenProps } from "@/navigation"
import { colors } from "@/theme"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
const monthFormat = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" })
const shortMonth = new Intl.DateTimeFormat(undefined, { month: "short" })
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })

/** The band behind the leading goal's current run, in its ring's colour. */
const BANDS = { training: "bg-accent/10", walking: "bg-walk/10", minis: "bg-mini/10" } as const satisfies Record<Ring, string>

/** Every day trained, a month at a time, with the streaks for the user's goals marked on it. */
export function CalendarScreen({ navigation }: AppScreenProps<"Calendar">) {
  const now = useNow()
  const { data, error } = useCall("getCalendar", {})
  // Days the mini workout targets were met ring too. Until they load, the workouts show on their own.
  const metDays = useCall("getMinis", miniRange(localDay(now))).data?.metDays ?? []
  const goals = activeGoals(useUser().streakGoals)

  return (
    <Screen>
      <BackLink onPress={navigation.goBack} />
      <Eyebrow className="min-h-4 pb-1 text-accent">{goals.map(describeGoal).join(" · ")}</Eyebrow>
      <Display accessibilityRole="header" className="pb-5 text-5xl">
        Calendar
      </Display>
      {data ? (
        <Calendar
          workouts={data}
          metDays={metDays}
          goals={goals}
          now={now}
          onOpen={(workoutId) => navigation.navigate("Workout", { workoutId })}
        />
      ) : (
        <Loading error={error ? describeError(error) : null} />
      )}
    </Screen>
  )
}

interface CalendarProps {
  readonly workouts: ReadonlyArray<CalendarWorkout>
  readonly metDays: ReadonlyArray<string>
  readonly goals: ReadonlyArray<StreakGoal>
  readonly now: number
  readonly onOpen: (workoutId: number) => void
}

function Calendar({ workouts, metDays, goals, now, onOpen }: CalendarProps) {
  // Workouts open from the calendar; days the mini workout targets were met only count and ring.
  const sessions = useMemo((): ReadonlyArray<StreakSession> => [...workouts, ...miniSessions(metDays)], [workouts, metDays])
  const thisMonth = shiftMonth(now, 0)
  const firstMonth = shiftMonth(Math.min(now, ...sessions.map((session) => session.startedAt)), 0)
  const [month, setMonth] = useState(thisMonth)
  const [selected, setSelected] = useState<number | null>(null)
  const streaks = useMemo(() => goals.map((goal) => goalStreak(goal, sessions, now)), [goals, sessions, now])
  const days = useMemo(() => byDay(workouts), [workouts])
  const sessionDays = useMemo(() => byDay(sessions), [sessions])
  const grid = monthGrid(month)
  const today = startOfDay(now)
  const lead = streaks[0]!
  const band = BANDS[ringFor(lead.goal.activity)]
  const inMonth = countInMonth(sessions.filter((session) => countsToward(lead.goal.activity, session.kind)), month)
  const other = markLegend(goals).other
  const tiles = streakTiles(streaks)
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

    if (only) onOpen(only.id)
    else setSelected(day === selected ? null : day)
  }

  return (
    <>
      <View className="flex-row flex-wrap gap-2 pb-4">
        {tiles.map((tile) => (
          <View key={tile.label} className={tiles.length + 1 > 3 ? "w-[48.5%]" : "flex-1"}>
            <Stat label={tile.label} value={tile.value} unit={tile.unit} />
          </View>
        ))}
        <View className={tiles.length + 1 > 3 ? "w-[48.5%]" : "flex-1"}>
          <Stat label={`${countNoun(lead.goal.activity)} in ${shortMonth.format(month)}`} value={inMonth} />
        </View>
      </View>

      <Card>
        <View className="flex-row items-center gap-1">
          <Display testID={testIds.calendar.month} accessibilityLiveRegion="polite" numberOfLines={1} className="flex-1 text-2xl">
            {monthFormat.format(month)}
          </Display>
          {month === thisMonth ? null : (
            <Pressable accessibilityRole="button" onPress={() => show(thisMonth)} className="min-h-11 justify-center px-3">
              <Text className="text-sm font-semibold text-accent">Today</Text>
            </Pressable>
          )}
          <MonthButton label="Previous month" disabled={month <= firstMonth} onPress={() => show(shiftMonth(month, -1))} back />
          <MonthButton label="Next month" disabled={month >= thisMonth} onPress={() => show(shiftMonth(month, 1))} />
        </View>

        <View className="flex-row pb-1 pt-3" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {WEEKDAYS.map((name) => (
            <Eyebrow key={name} className="flex-1 text-center text-xs text-faint">
              {name}
            </Eyebrow>
          ))}
        </View>

        <View className="gap-1">
          {grid.weeks.map((week) => (
            <View key={week.monday} className={cn("flex-row rounded-full", weeklyBand && isInRun(lead, week.monday) ? band : "")}>
              {week.days.map((day, index) => (
                <View
                  key={day ?? `blank-${index}`}
                  className={cn(
                    "flex-1 items-center py-0.5",
                    day !== null && !weeklyBand ? dailyBand(lead, band, day, week.days[index - 1], week.days[index + 1]) : "",
                  )}
                >
                  {day === null ? null : (
                    <DayButton
                      day={day}
                      workouts={days.get(day) ?? []}
                      sessions={sessionDays.get(day) ?? []}
                      goals={goals}
                      isToday={day === today}
                      isFuture={day > today}
                      isSelected={day === selected}
                      onPress={() => open(day)}
                    />
                  )}
                </View>
              ))}
            </View>
          ))}
        </View>

        <View className="flex-row flex-wrap gap-x-4 gap-y-1 pt-4">
          {ringLegend(goals).map((entry) => (
            <View key={entry.ring} className="flex-row items-center gap-1.5">
              <RingSwatch ring={entry.ring} />
              <Text className="text-xs text-muted">{entry.label}</Text>
            </View>
          ))}
          {other ? (
            <View className="flex-row items-center gap-1.5">
              <View className="size-3 rounded-full border-2 border-faint/60" />
              <Text className="text-xs text-muted">{other}</Text>
            </View>
          ) : null}
          <View className="flex-row items-center gap-1.5">
            <View className={cn("h-3 w-5 rounded-full", band)} />
            <Text className="text-xs text-muted">Current streak</Text>
          </View>
        </View>
      </Card>

      {picked.length > 0 && selected !== null ? <DayWorkouts day={selected} workouts={picked} onOpen={onOpen} /> : null}

      {sessions.length === 0 ? (
        <Text className="pt-4 text-center text-sm text-muted">Finish a workout and its day lights up here.</Text>
      ) : null}
    </>
  )
}

interface MonthButtonProps {
  readonly label: string
  readonly disabled: boolean
  readonly onPress: () => void
  readonly back?: boolean
}

function MonthButton({ label, disabled, onPress, back = false }: MonthButtonProps) {
  const color = disabled ? colors.line : colors.white

  return (
    <Pressable
      testID={back ? testIds.calendar.previousMonth : testIds.calendar.nextMonth}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className="size-11 items-center justify-center rounded-full active:bg-raised"
    >
      {back ? <BackIcon size={20} color={color} /> : <ChevronIcon size={20} color={color} />}
    </Pressable>
  )
}

/** The rounded band behind a day in a daily goal's current run, closed off where the run or the row ends. */
const dailyBand = (lead: GoalStreak, band: string, day: number, before: number | null | undefined, after: number | null | undefined) => {
  if (!isInRun(lead, day)) return ""
  const joinsBefore = before != null && isInRun(lead, before)
  const joinsAfter = after != null && isInRun(lead, after)

  return cn(band, !joinsBefore && "rounded-l-full", !joinsAfter && "rounded-r-full")
}

interface DayButtonProps {
  readonly day: number
  /** The workouts that day, which tapping it opens. */
  readonly workouts: ReadonlyArray<CalendarWorkout>
  /** Everything that day a goal might count: the workouts, and the mini workout targets when met. */
  readonly sessions: ReadonlyArray<StreakSession>
  readonly goals: ReadonlyArray<StreakGoal>
  readonly isToday: boolean
  readonly isFuture: boolean
  readonly isSelected: boolean
  readonly onPress: () => void
}

function DayButton({ day, workouts, sessions, goals, isToday, isFuture, isSelected, onPress }: DayButtonProps) {
  const date = new Date(day).getDate()
  const count = workouts.length
  const walks = workouts.filter((workout) => workout.kind === "walk").length
  const minis = sessions.some((session) => session.kind === "minis")
  const label = describeTrainingDay(day, count - walks, walks, minis)
  const mark = dayMark(sessions, goals)
  const rings = dayRings(sessions, goals)

  const face = (
    <DayRings
      rings={rings}
      other={mark === "other"}
      className={cn("size-10", isToday && mark === null ? "border-2 border-dashed border-white/50" : "", isSelected ? "border-2 border-chalk" : "")}
    >
      <Text
        className={cn(
          "text-sm tabular-nums",
          mark !== null ? "font-bold text-chalk" : isToday ? "font-semibold text-chalk" : isFuture ? "text-line" : "text-muted",
        )}
      >
        {date}
      </Text>
      {count > 1 ? (
        <View className="absolute -right-0.5 -top-0.5 size-4 items-center justify-center rounded-full bg-chalk">
          <Text className="text-[10px] font-bold text-accent-ink">{count}</Text>
        </View>
      ) : null}
    </DayRings>
  )

  if (count === 0) {
    return (
      <View testID={testIds.calendar.day(day)} accessible accessibilityLabel={label}>
        {face}
      </View>
    )
  }

  return (
    <Pressable
      testID={testIds.calendar.day(day)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={count > 1 ? { selected: isSelected } : {}}
      onPress={onPress}
      className="rounded-full active:bg-raised"
    >
      {face}
    </Pressable>
  )
}

interface DayWorkoutsProps {
  readonly day: number
  readonly workouts: ReadonlyArray<CalendarWorkout>
  readonly onOpen: (workoutId: number) => void
}

/** The workouts of a day with more than one, to pick which to open. */
function DayWorkouts({ day, workouts, onOpen }: DayWorkoutsProps) {
  return (
    <>
      <SectionTitle>{formatLongDay(day)}</SectionTitle>
      <View className="gap-2">
        {workouts.map((workout) => (
          <Pressable
            key={workout.id}
            testID={testIds.calendar.dayWorkout(workout.id)}
            accessibilityRole="button"
            onPress={() => onOpen(workout.id)}
            className={cn(CARD_CLASS, "flex-row items-center gap-3 active:bg-raised")}
          >
            <View className="flex-1">
              <Display numberOfLines={1} className="text-2xl">
                {workout.name}
              </Display>
              <Text className="text-sm tabular-nums text-muted">{timeFormat.format(workout.startedAt)}</Text>
            </View>
            <ChevronIcon color={colors.faint} />
          </Pressable>
        ))}
      </View>
    </>
  )
}
