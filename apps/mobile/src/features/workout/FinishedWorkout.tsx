import { StackActions, useNavigation } from "@react-navigation/native"
import { Pressable, View } from "react-native"
import { isCardio } from "~/domain/catalog"
import type { Unit } from "~/domain/units"
import { formatCompact, formatDay, formatSet } from "~/format"
import type { WorkoutDetail } from "~/server/repo"
import { TrophyIcon } from "@/components/icons"
import { BackLink, Button, Card, Display, Divider, Eyebrow, Screen, SectionTitle, Stat, Text } from "@/components/ui"
import { Direction } from "@/features/today/TodayScreen"
import { colors } from "@/theme"

interface FinishedWorkoutProps {
  readonly detail: WorkoutDetail
  readonly unit: Unit
}

/** A workout that is over: the totals, any personal bests, what changes next time, and every set. */
export function FinishedWorkout({ detail, unit }: FinishedWorkoutProps) {
  const navigation = useNavigation()
  const { workout, exercises, adjustments, records } = detail
  const minutes = workout.finishedAt === null ? 0 : Math.round((workout.finishedAt - workout.startedAt) / 60000)
  const allSets = exercises.flatMap((exercise) => exercise.sets)
  const volume = allSets.reduce((total, set) => total + set.weight * set.reps, 0)

  return (
    <Screen>
      <BackLink onPress={navigation.goBack} />
      <View className="pb-5 pt-2">
        <Eyebrow className="pb-1 text-accent">Workout complete · {formatDay(workout.startedAt)}</Eyebrow>
        <Display accessibilityRole="header" className="text-5xl">
          {workout.name}
        </Display>
      </View>

      <View className="flex-row gap-2">
        <Stat label="Minutes" value={minutes > 0 ? minutes : "–"} />
        <Stat label="Sets" value={allSets.length} />
        <Stat label="Lifted" value={formatCompact(volume)} unit={unit} />
      </View>

      {records.length > 0 ? (
        <View className="mt-3 flex-row items-center gap-2 rounded-2xl bg-accent px-4 py-3">
          <TrophyIcon size={20} color={colors.accentInk} />
          <Text className="font-semibold text-accent-ink">
            {records.length === 1 ? "1 personal best" : `${records.length} personal bests`}
          </Text>
        </View>
      ) : null}

      {adjustments.length > 0 ? (
        <>
          <SectionTitle>Changes for next time</SectionTitle>
          <Card className="py-1">
            {adjustments.map((adjustment, index) => (
              <View key={adjustment.id}>
                {index > 0 ? <Divider /> : null}
                <View className="flex-row gap-3 py-3">
                  <Direction adjustment={adjustment} />
                  <View className="flex-1">
                    <Text className="font-semibold">{adjustment.exerciseName}</Text>
                    <Text className="text-sm text-muted">{adjustment.reason}</Text>
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>What you did</SectionTitle>
      <View className="gap-2">
        {exercises.map((exercise) => (
          <Pressable
            key={exercise.exerciseId}
            accessibilityRole="button"
            onPress={() => navigation.navigate("OwnExercise", { exerciseId: exercise.exerciseId })}
            className="rounded-3xl border border-white/5 bg-surface p-4 active:bg-raised"
          >
            <View className="flex-row items-center justify-between gap-3">
              <Display numberOfLines={1} className="flex-1 text-2xl">
                {exercise.exerciseName}
              </Display>
              {records.includes(exercise.exerciseId) ? (
                <View className="flex-row items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1">
                  <TrophyIcon size={14} color={colors.accent} />
                  <Eyebrow className="text-xs text-accent">Best</Eyebrow>
                </View>
              ) : null}
            </View>
            <View className="flex-row flex-wrap items-center gap-1.5 pt-2">
              {exercise.sets.map((set) => (
                <View key={set.id} className="rounded-lg bg-raised px-2 py-1">
                  <Text className="text-sm font-semibold tabular-nums">{formatSet(set, unit)}</Text>
                </View>
              ))}
              {isCardio(exercise.exerciseName) ? null : <Text className="pl-1 text-sm text-faint">{unit}</Text>}
            </View>
          </Pressable>
        ))}
      </View>

      <Button variant="primary" className="mt-6" onPress={() => navigation.dispatch(StackActions.popTo("Tabs", { screen: "Today" }))}>
        Done
      </Button>
    </Screen>
  )
}
