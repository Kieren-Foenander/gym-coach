import { useNavigation } from "@react-navigation/native"
import type { ReactNode } from "react"
import { Pressable, View } from "react-native"
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg"
import { isCardio } from "~/domain/catalog"
import { localDay } from "~/domain/health"
import { miniRange, miniSessions } from "~/domain/minis"
import { activeGoals, describeGoalStreak, MARK_WORDS, summariseWeek, type StreakGoal, type WeekSession } from "~/domain/streaks"
import { estimateMinutes, formatCompact, formatDay, formatPrescription, formatReps, formatWeight } from "~/format"
import type { Adjustment } from "~/server/repo"
import { describeError } from "@/api/client"
import { call } from "@/api/session"
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronIcon, FlameIcon } from "@/components/icons"
import { Button, Card, CARD_CLASS, Display, Divider, ErrorNote, Eyebrow, Loading, PageTitle, Screen, SectionTitle, Text } from "@/components/ui"
import { useAction, useCall } from "@/data/calls"
import { RecoveryCard } from "@/features/health/RecoveryCard"
import { MiniCard } from "@/features/minis/MiniCard"
import { NutritionCard } from "@/features/nutrition/NutritionCard"
import { DayRings } from "@/components/rings"
import { useUser } from "@/features/user"
import { cn } from "@/lib/cn"
import { useNow } from "@/lib/useNow"
import { colors } from "@/theme"

const SOURCE_LABELS = { rule: "Auto", ai: "Coach", user: "You" } as const
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
const longDay = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" })

export function TodayScreen() {
  const user = useUser()
  const navigation = useNavigation()
  const now = useNow()
  const { data, error: loadError } = useCall("getToday", {})
  const metDays = useCall("getMinis", miniRange(localDay(now))).data?.metDays ?? []
  const { act, pending, error } = useAction()

  if (!data) {
    return (
      <Screen tabs>
        <PageTitle eyebrow={longDay.format(now)}>{`Hi ${user.displayName}`}</PageTitle>
        <Loading error={loadError ? describeError(loadError) : null} />
      </Screen>
    )
  }

  const { today, activity } = data
  const nextDay = today.plan?.days.find((day) => day.id === today.nextDayId)
  const otherDays = today.plan?.days.filter((day) => day.id !== today.nextDayId) ?? []
  const activeWorkout = today.activeWorkout

  const start = (planDayId: number | null) =>
    act(async () => {
      const workoutId = planDayId === null ? await call("startOpenWorkout", {}) : await call("startWorkout", { planDayId })

      navigation.navigate("Workout", { workoutId })
    })

  return (
    <Screen tabs>
      <PageTitle eyebrow={longDay.format(now)}>{`Hi ${user.displayName}`}</PageTitle>
      <ErrorNote message={error} />

      <WeekCard activity={[...activity, ...miniSessions(metDays)]} goals={activeGoals(user.streakGoals)} now={now} unit={user.unit} onPress={() => navigation.navigate("Calendar")} />

      {activeWorkout ? (
        <Hero eyebrow="In progress" title={activeWorkout.name}>
          <Button variant="primary" className="mt-5" onPress={() => navigation.navigate("Workout", { workoutId: activeWorkout.id })}>
            Continue workout
          </Button>
        </Hero>
      ) : null}

      {!activeWorkout && nextDay ? (
        <Hero eyebrow={`Up next · ${today.plan?.name ?? ""}`} title={nextDay.name}>
          <Text className="pt-2 text-sm tabular-nums text-muted">
            {nextDay.exercises.length} exercises · {nextDay.exercises.reduce((total, item) => total + item.sets, 0)} sets · about{" "}
            {estimateMinutes(nextDay.exercises)} min
          </Text>
          <View className="mt-4 border-y border-white/5">
            {nextDay.exercises.map((exercise, index) => (
              <View key={exercise.id}>
                {index > 0 ? <Divider /> : null}
                <View className="flex-row items-center gap-3 py-2.5">
                  <Display className="w-5 text-lg tabular-nums text-faint">{index + 1}</Display>
                  <Text numberOfLines={1} className="flex-1 font-semibold">
                    {exercise.exerciseName}
                  </Text>
                  {isCardio(exercise.exerciseName) ? (
                    <Text className="text-right text-sm tabular-nums text-muted">{formatPrescription(exercise, user.unit)}</Text>
                  ) : (
                    <View className="items-end">
                      <Text className="text-sm tabular-nums text-muted">
                        {exercise.sets} × {formatReps(exercise.repMin, exercise.repMax)}
                      </Text>
                      <Text className="text-sm font-semibold tabular-nums">
                        {exercise.targetWeight === null ? "Find it" : `${formatWeight(exercise.targetWeight)} ${user.unit}`}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
          <Button
            variant="primary"
            className="mt-5"
            disabled={pending || nextDay.exercises.length === 0}
            onPress={() => start(nextDay.id)}
          >
            Start workout
          </Button>
        </Hero>
      ) : null}

      {activeWorkout ? null : (
        <>
          <SectionTitle>Or do something else</SectionTitle>
          <View className="flex-row flex-wrap gap-2">
            {otherDays.map((day) => (
              <Button key={day.id} disabled={pending || day.exercises.length === 0} onPress={() => start(day.id)}>
                {day.name}
              </Button>
            ))}
            <Button variant="outline" disabled={pending} onPress={() => start(null)}>
              Open workout
            </Button>
          </View>
          <Text className="pt-2 text-sm text-faint">An open workout follows no plan. You add exercises as you go.</Text>
        </>
      )}

      <RecoveryCard now={now} />

      <MiniCard now={now} />

      <NutritionCard now={now} />

      {today.plan ? null : (
        <Hero eyebrow="Get started" title="No plan yet">
          <Text className="pb-5 pt-2 text-muted">
            Connect your AI coach and ask it to build one around your goals, or pick a starter plan.
          </Text>
          <View className="flex-row gap-2">
            <Button variant="primary" className="flex-1" onPress={() => navigation.navigate("Tabs", { screen: "Settings" })}>
              Connect coach
            </Button>
            <Button className="flex-1" onPress={() => navigation.navigate("Tabs", { screen: "Plan" })}>
              Starter plans
            </Button>
          </View>
        </Hero>
      )}

      {today.notes.length > 0 ? (
        <>
          <SectionTitle>From your coach</SectionTitle>
          <View className="gap-2">
            {today.notes.map((note) => (
              <View key={note.id} className="rounded-3xl border border-accent/20 bg-accent/5 p-4">
                <Text className="leading-relaxed">{note.body}</Text>
                <View className="flex-row items-center justify-between pt-1">
                  <Text className="text-sm text-muted">{formatDay(note.createdAt)}</Text>
                  <Button
                    variant="ghost"
                    className="min-h-11 px-2"
                    labelClassName="text-sm"
                    disabled={pending}
                    onPress={() => act(() => call("deleteCoachNote", { noteId: note.id }))}
                  >
                    Dismiss
                  </Button>
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {today.adjustments.length > 0 ? (
        <>
          <SectionTitle>Recent changes</SectionTitle>
          <Card className="py-1">
            {today.adjustments.map((adjustment, index) => (
              <View key={adjustment.id}>
                {index > 0 ? <Divider /> : null}
                <View className="flex-row gap-3 py-3">
                  <Direction adjustment={adjustment} />
                  <View className="flex-1">
                    <View className="flex-row items-baseline justify-between gap-3">
                      <Text numberOfLines={1} className="flex-1 font-semibold">
                        {adjustment.exerciseName}
                      </Text>
                      <Text className="text-sm tabular-nums text-muted">
                        {adjustment.oldWeight === null ? "–" : formatWeight(adjustment.oldWeight)}
                        {" → "}
                        <Text className="text-sm font-semibold">
                          {adjustment.newWeight === null ? "–" : formatWeight(adjustment.newWeight)} {user.unit}
                        </Text>
                      </Text>
                    </View>
                    <Text className="text-sm text-muted">
                      <Text className="text-sm font-semibold">{SOURCE_LABELS[adjustment.source]}</Text> · {adjustment.reason}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  )
}

interface HeroProps {
  readonly eyebrow: string
  readonly title: string
  readonly children: ReactNode
}

/** The main card on the screen, with a glow in the corner. */
function Hero({ eyebrow, title, children }: HeroProps) {
  return (
    <View className="mt-3 overflow-hidden rounded-[32px] border border-accent/25 bg-surface p-5">
      <View pointerEvents="none" className="absolute -right-24 -top-28 size-72">
        <Svg width="100%" height="100%" viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id="hero-glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={colors.accent} stopOpacity={0.22} />
              <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="100" height="100" fill="url(#hero-glow)" />
        </Svg>
      </View>
      <Eyebrow numberOfLines={1} className="text-accent">
        {eyebrow}
      </Eyebrow>
      <Display accessibilityRole="header" className="pt-1 text-5xl">
        {title}
      </Display>
      {children}
    </View>
  )
}

interface WeekCardProps {
  /** The workouts of the last few days, and the days the mini workout targets were met. */
  readonly activity: ReadonlyArray<WeekSession>
  readonly goals: ReadonlyArray<StreakGoal>
  readonly now: number
  readonly unit: string
  readonly onPress: () => void
}

/** This week at a glance: which days counted, the totals, and the streak for the first goal. Opens the calendar. */
function WeekCard({ activity, goals, now, unit, onPress }: WeekCardProps) {
  const week = summariseWeek(activity, goals, now)
  const streaking = week.streak.current > 0

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens the training calendar"
      onPress={onPress}
      className={cn(CARD_CLASS, "active:bg-raised")}
    >
      <View className="flex-row items-center justify-between gap-3">
        <Eyebrow>This week</Eyebrow>
        <View className="flex-row items-center gap-1">
          <FlameIcon size={16} color={streaking ? colors.accent : colors.faint} />
          <Text className={cn("text-sm font-semibold", streaking ? "text-accent" : "text-faint")}>
            {describeGoalStreak(week.streak)}
          </Text>
          <ChevronIcon size={14} color={colors.faint} />
        </View>
      </View>
      <View accessibilityLabel="Days trained this week" className="flex-row pt-3">
        {WEEKDAYS.map((name, index) => {
          const mark = week.days[index] ?? null
          const rings = week.rings[index] ?? []
          const isToday = week.todayIndex === index

          return (
            <View
              key={name}
              accessible
              accessibilityLabel={`${name}: ${mark ? MARK_WORDS[mark] : "Nothing logged"}`}
              className="flex-1 items-center gap-1.5"
            >
              <Text className={cn("text-xs font-semibold", isToday ? "text-chalk" : "text-faint")}>{name.charAt(0)}</Text>
              <DayRings
                rings={rings}
                other={mark === "other"}
                className={cn("size-9", mark === null ? (isToday ? "border-2 border-dashed border-white/50" : "border border-line bg-raised/50") : "")}
              >
                {mark === "counted" && rings.length === 1 ? <CheckIcon size={14} color={colors.white} /> : null}
              </DayRings>
            </View>
          )
        })}
      </View>
      <View className="mt-4 flex-row gap-2">
        <View className="flex-1 rounded-2xl bg-raised/70 px-3 py-2.5">
          <Display className="tabular-nums">
            {week.workouts}
            {week.walks > 0 ? <Display className="text-base text-muted"> +{week.walks} {week.walks === 1 ? "walk" : "walks"}</Display> : null}
          </Display>
          <Text className="text-xs text-muted">Workouts</Text>
        </View>
        <View className="flex-1 rounded-2xl bg-raised/70 px-3 py-2.5">
          <Display className="tabular-nums">
            {formatCompact(week.volume)}
            <Display className="text-base text-muted"> {unit}</Display>
          </Display>
          <Text className="text-xs text-muted">Lifted</Text>
        </View>
      </View>
    </Pressable>
  )
}

/** An arrow showing whether a weight went up or down. */
export function Direction({ adjustment }: { readonly adjustment: Adjustment }) {
  const { oldWeight, newWeight } = adjustment
  const went = oldWeight === null || newWeight === null || oldWeight === newWeight ? "same" : newWeight > oldWeight ? "up" : "down"

  if (went === "up") {
    return (
      <View className="size-9 items-center justify-center rounded-full bg-accent/12">
        <ArrowUpIcon color={colors.accent} />
      </View>
    )
  }

  if (went === "down") {
    return (
      <View className="size-9 items-center justify-center rounded-full bg-amber-400/12">
        <ArrowDownIcon color={colors.warning} />
      </View>
    )
  }

  return <View className="size-9 rounded-full bg-raised" />
}
