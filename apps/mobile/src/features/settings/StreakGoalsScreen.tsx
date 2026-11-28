import { useState } from "react"
import { View } from "react-native"
import { call, rememberUser } from "@/api/session"
import { BackLink, Button, Card, Chip, Display, ErrorNote, Eyebrow, PageTitle, Screen, Text } from "@/components/ui"
import { useAction } from "@/data/calls"
import { useUser } from "@/features/user"
import type { AppScreenProps } from "@/navigation"
import { SETTINGS_TITLES } from "~/domain/settings"
import {
  ACTIVITY_HINTS,
  ACTIVITY_LABELS,
  activeGoals,
  describeGoal,
  FREQUENCIES,
  isFrequency,
  MAX_STREAK_GOALS,
  normaliseGoal,
  RING_COLORS,
  ringFor,
  STREAK_ACTIVITIES,
  suggestNextGoal,
  type StreakGoal,
} from "~/domain/streaks"
import { GOAL_SLOTS, testIds } from "~/domain/test-ids"

const SLOT_NAMES = ["Main goal", "Second goal", "Third goal"] as const

export function StreakGoalsScreen({ navigation }: AppScreenProps<"SettingsStreaks">) {
  const user = useUser()

  return (
    <Screen>
      <BackLink label="Settings" onPress={navigation.goBack} />
      <PageTitle>{SETTINGS_TITLES.streaks}</PageTitle>
      <StreakGoalsCard saved={activeGoals(user.streakGoals)} />
    </Screen>
  )
}

/** What the calendar's streaks count and how often: one goal, or up to three with the first leading. */
function StreakGoalsCard({ saved }: { readonly saved: ReadonlyArray<StreakGoal> }) {
  const { act, pending, error } = useAction()
  const [goals, setGoals] = useState(saved)
  const [done, setDone] = useState(false)
  const first = goals[0]

  const edit = (next: ReadonlyArray<StreakGoal>) => {
    setGoals(next)
    setDone(false)
  }

  const change = (index: number, patch: Partial<StreakGoal>) =>
    edit(goals.map((goal, at) => (at === index ? normaliseGoal({ ...goal, ...patch }) : goal)))

  const save = () =>
    void act(async () => {
      await call("updateProfile", { streakGoals: goals })
      rememberUser(await call("getSession", {}))
      setDone(true)
    })

  return (
    <Card className="gap-5">
      <Text className="text-muted">
        Your streak counts what you set here. A walk on its own only counts toward a goal for walks or for anything. Each goal
        rings the days it counts on the calendar in its own colour.
      </Text>
      {goals.map((goal, index) => (
        <View key={index} testID={testIds.settings.streakGoal(GOAL_SLOTS[index] ?? "third")} className="gap-3">
          <View className="flex-row items-center justify-between gap-3">
            <View className="size-6 rounded-full" style={{ borderWidth: 3, borderColor: RING_COLORS[ringFor(goal.activity)] }} />
            <View className="flex-1">
              <Eyebrow className="text-xs text-faint">{SLOT_NAMES[index] ?? "Goal"}</Eyebrow>
              <Display className="text-2xl">{describeGoal(goal)}</Display>
            </View>
            {index > 0 ? (
              <Button testID={testIds.settings.removeStreakGoal} onPress={() => edit(goals.filter((_, at) => at !== index))}>
                Remove
              </Button>
            ) : null}
          </View>
          <View>
            <Text className="pb-1.5 text-sm text-muted">What counts</Text>
            <View accessibilityLabel="What counts" className="flex-row flex-wrap gap-2">
              {STREAK_ACTIVITIES.map((activity) => (
                <Chip
                  key={activity}
                  label={ACTIVITY_LABELS[activity]}
                  selected={goal.activity === activity}
                  onPress={() => change(index, { activity })}
                />
              ))}
            </View>
            <Text className="pt-1.5 text-sm text-faint">{ACTIVITY_HINTS[goal.activity]}</Text>
          </View>
          <View>
            <Text className="pb-1.5 text-sm text-muted">How often</Text>
            <View accessibilityLabel="How often" className="flex-row flex-wrap gap-2">
              {FREQUENCIES.map((frequency) => (
                <Chip
                  key={frequency.label}
                  label={frequency.label}
                  selected={isFrequency(goal, frequency)}
                  onPress={() => change(index, { period: frequency.period, target: frequency.target })}
                />
              ))}
            </View>
          </View>
        </View>
      ))}
      {goals.length < MAX_STREAK_GOALS && first ? (
        <Button testID={testIds.settings.addStreakGoal} onPress={() => edit([...goals, suggestNextGoal(goals)])}>
          {goals.length === 1 ? "Add a second goal" : "Add a third goal"}
        </Button>
      ) : null}
      <ErrorNote message={error} />
      <Button testID={testIds.settings.saveStreakGoals} variant="primary" disabled={pending} onPress={save}>
        {done && !pending ? "Saved" : "Save goals"}
      </Button>
    </Card>
  )
}
