import { useNavigation } from "@react-navigation/native"
import { useState } from "react"
import { Pressable, View } from "react-native"
import { formatCompact, formatVolume } from "~/format"
import { describeError } from "@/api/client"
import { ChevronIcon } from "@/components/icons"
import { Card, Display, Divider, Empty, Eyebrow, Loading, PageTitle, Screen, Segmented, Stat, Text } from "@/components/ui"
import { useCall } from "@/data/calls"
import { useUser } from "@/features/user"
import { colors } from "@/theme"
import { BodyLog } from "./BodyLog"

const monthFormat = new Intl.DateTimeFormat(undefined, { month: "short" })
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long" })

export function HistoryScreen() {
  const user = useUser()
  const navigation = useNavigation()
  const { data, error } = useCall("getHistory", {})
  const [view, setView] = useState<"workouts" | "exercises" | "body">("workouts")

  if (!data) {
    return (
      <Screen tabs>
        <PageTitle>History</PageTitle>
        <Loading error={error ? describeError(error) : null} />
      </Screen>
    )
  }

  const { workouts, exercises, measurements } = data
  const performed = exercises.filter((exercise) => exercise.lastPerformedAt !== null)
  const totalVolume = workouts.reduce((total, workout) => total + workout.volume, 0)
  const totalSets = workouts.reduce((total, workout) => total + workout.setCount, 0)

  return (
    <Screen tabs>
      <PageTitle>History</PageTitle>

      {workouts.length > 0 ? (
        <View className="flex-row gap-2 pb-4">
          <Stat label="Workouts" value={workouts.length} />
          <Stat label="Sets" value={formatCompact(totalSets)} />
          <Stat label="Lifted" value={formatCompact(totalVolume)} unit={user.unit} />
        </View>
      ) : null}

      <Segmented label="Show" options={["workouts", "exercises", "body"] as const} value={view} onChange={setView} />

      {view === "body" ? <BodyLog measurements={measurements} unit={user.unit} /> : null}

      {view === "workouts" ? (
        <View className="gap-2 pt-4">
          {workouts.length === 0 ? <Empty>Finished workouts show up here.</Empty> : null}
          {workouts.map((workout) => (
            <Pressable
              key={workout.id}
              accessibilityRole="button"
              onPress={() => navigation.navigate("Workout", { workoutId: workout.id })}
              className="flex-row items-center gap-4 rounded-3xl border border-white/5 bg-surface p-3 active:bg-raised"
            >
              <View className="w-14 items-center rounded-2xl bg-raised py-2">
                <Eyebrow className="text-xs text-accent">{monthFormat.format(workout.startedAt)}</Eyebrow>
                <Display className="tabular-nums">{new Date(workout.startedAt).getDate()}</Display>
              </View>
              <View className="flex-1">
                <Display numberOfLines={1} className="text-2xl">
                  {workout.name}
                </Display>
                <Text numberOfLines={1} className="text-sm tabular-nums text-muted">
                  {weekdayFormat.format(workout.startedAt)} · {workout.setCount} sets · {formatVolume(workout.volume, user.unit)}
                </Text>
              </View>
              <ChevronIcon color={colors.faint} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {view === "exercises" ? (
        <View className="pt-4">
          {performed.length === 0 ? (
            <Empty>Exercises you log show up here.</Empty>
          ) : (
            <Card className="py-1">
              {performed.map((exercise, index) => (
                <View key={exercise.id}>
                  {index > 0 ? <Divider /> : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => navigation.navigate("OwnExercise", { exerciseId: exercise.id })}
                    className="min-h-14 flex-row items-center justify-between gap-3"
                  >
                    <View className="flex-1">
                      <Text numberOfLines={1} className="font-semibold">
                        {exercise.name}
                      </Text>
                      <Text className="text-sm text-muted">{exercise.muscleGroup}</Text>
                    </View>
                    <ChevronIcon color={colors.faint} />
                  </Pressable>
                </View>
              ))}
            </Card>
          )}
        </View>
      ) : null}
    </Screen>
  )
}
