import { useState } from "react"
import { Pressable, View } from "react-native"
import { byDay, countInMonth, monthGrid, shiftMonth, startOfDay, weeklyStreaks } from "~/domain/week"
import { describeTrainingDay, formatLongDay, weeksUnit } from "~/format"
import type { CalendarWorkout } from "~/server/repo"
import { describeError } from "@/api/client"
import { BackIcon, ChevronIcon } from "@/components/icons"
import { BackLink, Card, CARD_CLASS, Display, Eyebrow, Loading, Screen, SectionTitle, Stat, Text } from "@/components/ui"
import { useCall } from "@/data/calls"
import { cn } from "@/lib/cn"
import { useNow } from "@/lib/useNow"
import type { AppScreenProps } from "@/navigation"
import { colors } from "@/theme"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
const monthFormat = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" })
const shortMonth = new Intl.DateTimeFormat(undefined, { month: "short" })
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })

/** Every day trained, a month at a time, with the weekly streak marked on it. */
export function CalendarScreen({ navigation }: AppScreenProps<"Calendar">) {
  const { data, error } = useCall("getCalendar", {})

  return (
    <Screen>
      <BackLink onPress={navigation.goBack} />
      <Eyebrow className="min-h-4 pb-1 text-accent">Weekly streak</Eyebrow>
      <Display accessibilityRole="header" className="pb-5 text-5xl">
        Calendar
      </Display>
      {data ? (
        <Calendar workouts={data} onOpen={(workoutId) => navigation.navigate("Workout", { workoutId })} />
      ) : (
        <Loading error={error ? describeError(error) : null} />
      )}
    </Screen>
  )
}

interface CalendarProps {
  readonly workouts: ReadonlyArray<CalendarWorkout>
  readonly onOpen: (workoutId: number) => void
}

function Calendar({ workouts, onOpen }: CalendarProps) {
  const now = useNow()
  const thisMonth = shiftMonth(now, 0)
  const firstMonth = shiftMonth(workouts[0]?.startedAt ?? now, 0)
  const [month, setMonth] = useState(thisMonth)
  const [selected, setSelected] = useState<number | null>(null)
  const streaks = weeklyStreaks(workouts.map((workout) => workout.startedAt), now)
  const days = byDay(workouts)
  const grid = monthGrid(month)
  const today = startOfDay(now)
  const inMonth = countInMonth(workouts, month)
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
        <Stat label="Current streak" value={streaks.current} unit={weeksUnit(streaks.current)} />
        <Stat label="Longest streak" value={streaks.longest} unit={weeksUnit(streaks.longest)} />
        <Stat label={`Workouts in ${shortMonth.format(month)}`} value={inMonth} />
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
              className={cn("flex-row rounded-full", streaks.currentWeeks.has(week.monday) ? "bg-accent/10" : "")}
            >
              {week.days.map((day, index) => (
                <View key={day ?? `blank-${index}`} className="flex-1 items-center py-0.5">
                  {day === null ? null : (
                    <DayButton
                      day={day}
                      count={days.get(day)?.length ?? 0}
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
            <Text className="text-xs text-muted">Trained</Text>
          </View>
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

interface DayButtonProps {
  readonly day: number
  readonly count: number
  readonly isToday: boolean
  readonly isFuture: boolean
  readonly isSelected: boolean
  readonly onPress: () => void
}

function DayButton({ day, count, isToday, isFuture, isSelected, onPress }: DayButtonProps) {
  const date = new Date(day).getDate()
  const label = describeTrainingDay(day, count)

  if (count === 0) {
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

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={count > 1 ? { selected: isSelected } : {}}
      onPress={onPress}
      className={cn(
        "size-10 items-center justify-center rounded-full bg-accent active:bg-accent-strong",
        isSelected ? "border-2 border-chalk" : "",
      )}
    >
      <Text className="text-sm font-bold tabular-nums text-accent-ink">{date}</Text>
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
