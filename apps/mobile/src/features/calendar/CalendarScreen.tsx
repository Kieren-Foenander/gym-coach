import { useState } from "react"
import { Pressable, View } from "react-native"
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
import type { CalendarWorkout } from "~/server/repo"
import { describeError } from "@/api/client"
import { BackIcon, ChevronIcon } from "@/components/icons"
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

/** Every day trained, a month at a time, with the streaks for the user's goals marked on it. */
export function CalendarScreen({ navigation }: AppScreenProps<"Calendar">) {
  const { data, error } = useCall("getCalendar", {})
  const goals = activeGoals(useUser().streakGoals)

  return (
    <Screen>
      <BackLink onPress={navigation.goBack} />
      <Eyebrow className="min-h-4 pb-1 text-accent">{goals.map(describeGoal).join(" · ")}</Eyebrow>
      <Display accessibilityRole="header" className="pb-5 text-5xl">
        Calendar
      </Display>
      {data ? (
        <Calendar workouts={data} goals={goals} onOpen={(workoutId) => navigation.navigate("Workout", { workoutId })} />
      ) : (
        <Loading error={error ? describeError(error) : null} />
      )}
    </Screen>
  )
}

interface CalendarProps {
  readonly workouts: ReadonlyArray<CalendarWorkout>
  readonly goals: ReadonlyArray<StreakGoal>
  readonly onOpen: (workoutId: number) => void
}

function Calendar({ workouts, goals, onOpen }: CalendarProps) {
  const now = useNow()
  const thisMonth = shiftMonth(now, 0)
  const firstMonth = shiftMonth(workouts[0]?.startedAt ?? now, 0)
  const [month, setMonth] = useState(thisMonth)
  const [selected, setSelected] = useState<number | null>(null)
  const streaks = goals.map((goal) => goalStreak(goal, workouts, now))
  const days = byDay(workouts)
  const grid = monthGrid(month)
  const today = startOfDay(now)
  const lead = streaks[0]!
  const inMonth = countInMonth(workouts.filter((workout) => countsToward(lead.goal.activity, workout.kind)), month)
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

    if (only) onOpen(only.id)
    else setSelected(day === selected ? null : day)
  }

  return (
    <>
      <View className="flex-row gap-2 pb-4">
        {streakTiles(streaks).map((tile) => (
          <Stat key={tile.label} label={tile.label} value={tile.value} unit={tile.unit} />
        ))}
        <Stat label={`${countNoun(lead.goal.activity)} in ${shortMonth.format(month)}`} value={inMonth} />
      </View>

      <Card>
        <View className="flex-row items-center gap-1">
          <Display accessibilityLiveRegion="polite" numberOfLines={1} className="flex-1 text-2xl">
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
            <View
              key={week.monday}
              className={cn("flex-row rounded-full", weeklyBand && isInRun(lead, week.monday) ? "bg-accent/10" : "")}
            >
              {week.days.map((day, index) => (
                <View
                  key={day ?? `blank-${index}`}
                  className={cn(
                    "flex-1 items-center py-0.5",
                    day !== null && !weeklyBand ? dailyBand(lead, day, week.days[index - 1], week.days[index + 1]) : "",
                  )}
                >
                  {day === null ? null : (
                    <DayButton
                      day={day}
                      sessions={days.get(day) ?? []}
                      mark={dayMark(days.get(day) ?? [], goals)}
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
          <View className="flex-row items-center gap-1.5">
            <View className="size-3 rounded-full bg-accent" />
            <Text className="text-xs text-muted">{legend.counted}</Text>
          </View>
          {legend.other ? (
            <View className="flex-row items-center gap-1.5">
              <View className="size-3 rounded-full border-2 border-accent bg-accent/15" />
              <Text className="text-xs text-muted">{legend.other}</Text>
            </View>
          ) : null}
          <View className="flex-row items-center gap-1.5">
            <View className="h-3 w-5 rounded-full bg-accent/20" />
            <Text className="text-xs text-muted">Current streak</Text>
          </View>
        </View>
      </Card>

      {picked.length > 0 && selected !== null ? <DayWorkouts day={selected} workouts={picked} onOpen={onOpen} /> : null}

      {workouts.length === 0 ? (
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
const dailyBand = (lead: GoalStreak, day: number, before: number | null | undefined, after: number | null | undefined) => {
  if (!isInRun(lead, day)) return ""
  const joinsBefore = before != null && isInRun(lead, before)
  const joinsAfter = after != null && isInRun(lead, after)

  return cn("bg-accent/10", !joinsBefore && "rounded-l-full", !joinsAfter && "rounded-r-full")
}

interface DayButtonProps {
  readonly day: number
  readonly sessions: ReadonlyArray<CalendarWorkout>
  readonly mark: DayMark
  readonly isToday: boolean
  readonly isFuture: boolean
  readonly isSelected: boolean
  readonly onPress: () => void
}

function DayButton({ day, sessions, mark, isToday, isFuture, isSelected, onPress }: DayButtonProps) {
  const date = new Date(day).getDate()
  const count = sessions.length
  const walks = sessions.filter((session) => session.kind === "walk").length
  const label = describeTrainingDay(day, count - walks, walks)

  if (mark === null) {
    return (
      <View
        accessible
        accessibilityLabel={label}
        className={cn("size-10 items-center justify-center rounded-full", isToday ? "border-2 border-accent/70" : "")}
      >
        <Text className={cn("text-sm tabular-nums", isToday ? "font-semibold text-chalk" : isFuture ? "text-line" : "text-muted")}>
          {date}
        </Text>
      </View>
    )
  }

  // Counted days are filled; days whose sessions count toward no goal, such as a walk, get a ring.
  const counted = mark === "counted"

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={count > 1 ? { selected: isSelected } : {}}
      onPress={onPress}
      className={cn(
        "size-10 items-center justify-center rounded-full",
        counted ? "bg-accent active:bg-accent-strong" : "border-2 border-accent bg-accent/15 active:bg-accent/30",
        isSelected ? "border-2 border-chalk" : "",
      )}
    >
      <Text className={cn("text-sm font-bold tabular-nums", counted ? "text-accent-ink" : "text-accent")}>{date}</Text>
      {count > 1 ? (
        <View className="absolute -right-0.5 -top-0.5 size-4 items-center justify-center rounded-full bg-chalk">
          <Text className="text-[10px] font-bold text-accent-ink">{count}</Text>
        </View>
      ) : null}
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
