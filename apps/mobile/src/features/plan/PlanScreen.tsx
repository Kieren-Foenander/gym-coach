import { useNavigation } from "@react-navigation/native"
import { useState } from "react"
import { Alert, Pressable, View } from "react-native"
import type { Direction } from "~/domain/schema"
import { formatPrescription } from "~/format"
import { describeError } from "@/api/client"
import { call } from "@/api/session"
import { ArrowDownIcon, ArrowUpIcon, ChevronIcon } from "@/components/icons"
import { Button, Card, Display, Divider, ErrorNote, Eyebrow, Loading, PageTitle, Screen, Text } from "@/components/ui"
import { useAction, useCall } from "@/data/calls"
import { useUser } from "@/features/user"
import { colors } from "@/theme"
import { TemplateList } from "./TemplateList"

export function PlanScreen() {
  const user = useUser()
  const navigation = useNavigation()
  const { data: plan, isPending, error: loadError } = useCall("getPlan", {})
  const { act, pending, error } = useAction()
  const [reordering, setReordering] = useState(false)

  if (isPending || plan === undefined) {
    return (
      <Screen tabs>
        <PageTitle>Plan</PageTitle>
        <Loading error={loadError ? describeError(loadError) : null} />
      </Screen>
    )
  }

  const removeDay = (planDayId: number, name: string) =>
    Alert.alert(`Remove ${name}?`, "It comes off the plan. Logged workouts are kept.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void act(() => call("removePlanDay", { planDayId })) },
    ])

  return (
    <Screen tabs>
      <PageTitle
        action={
          plan ? (
            <Button variant={reordering ? "primary" : "secondary"} onPress={() => setReordering(!reordering)}>
              {reordering ? "Done" : "Reorder"}
            </Button>
          ) : undefined
        }
      >
        Plan
      </PageTitle>
      <ErrorNote message={error} />

      {plan ? (
        <>
          <View className="pb-4">
            <Eyebrow className="pb-1 text-accent">{plan.source === "ai" ? "Written by your coach" : "Your plan"}</Eyebrow>
            <Display accessibilityRole="header">{plan.name}</Display>
            {plan.description ? <Text className="pt-1 text-muted">{plan.description}</Text> : null}
            <Text className="pt-1 text-sm text-faint">
              {reordering ? "Use the arrows to move days and exercises." : "Tap an exercise to change it."}
            </Text>
          </View>

          <View className="gap-3">
            {plan.days.map((day, dayIndex) => (
              <Card key={day.id}>
                <View className="flex-row items-center justify-between gap-3 pb-1">
                  <View className="flex-1">
                    <Eyebrow className="text-xs text-faint">Day {dayIndex + 1}</Eyebrow>
                    <Display numberOfLines={1} className="text-2xl">
                      {day.name}
                    </Display>
                  </View>
                  {reordering ? (
                    <MoveButtons
                      name={day.name}
                      first={dayIndex === 0}
                      last={dayIndex === plan.days.length - 1}
                      disabled={pending}
                      onMove={(direction) => act(() => call("movePlanDay", { planDayId: day.id, direction }))}
                    />
                  ) : (
                    <Button
                      variant="ghost"
                      className="min-h-11 px-2"
                      labelClassName="text-sm text-faint"
                      disabled={pending}
                      onPress={() => removeDay(day.id, day.name)}
                    >
                      Remove
                    </Button>
                  )}
                </View>
                {day.exercises.map((exercise, exerciseIndex) => (
                  <View key={exercise.id}>
                    {exerciseIndex > 0 ? <Divider /> : null}
                    {reordering ? (
                      <View className="min-h-14 flex-row items-center justify-between gap-3 py-1">
                        <Text numberOfLines={1} className="flex-1 font-semibold">
                          {exercise.exerciseName}
                        </Text>
                        <MoveButtons
                          name={exercise.exerciseName}
                          first={exerciseIndex === 0}
                          last={exerciseIndex === day.exercises.length - 1}
                          disabled={pending}
                          onMove={(direction) => act(() => call("movePlanExercise", { planExerciseId: exercise.id, direction }))}
                        />
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Change ${exercise.exerciseName}`}
                        onPress={() => navigation.navigate("EditPlanExercise", { planExerciseId: exercise.id })}
                        className="min-h-14 flex-row items-center justify-between gap-3 py-2"
                      >
                        <View className="flex-1">
                          <Text numberOfLines={1} className="font-semibold">
                            {exercise.exerciseName}
                          </Text>
                          <Text className="text-sm tabular-nums text-muted">{formatPrescription(exercise, user.unit)}</Text>
                        </View>
                        <ChevronIcon color={colors.faint} />
                      </Pressable>
                    )}
                  </View>
                ))}
                <Button variant="ghost" className="mt-1" onPress={() => navigation.navigate("AddPlanExercise", { planDayId: day.id })}>
                  Add exercise
                </Button>
              </Card>
            ))}
          </View>

          <View className="flex-row gap-2 pt-4">
            <Button className="flex-1" onPress={() => navigation.navigate("AddPlanDay")}>
              Add day
            </Button>
            <Button className="flex-1" onPress={() => navigation.navigate("Templates")}>
              Switch plan
            </Button>
          </View>
        </>
      ) : (
        <>
          <Text className="pb-4 text-muted">
            Ask your AI coach to write a plan for you, or start from one of these. Weights are worked out in your first session.
          </Text>
          <TemplateList onDone={() => undefined} />
          <Button className="mt-3" onPress={() => navigation.navigate("AddPlanDay")}>
            Build my own
          </Button>
        </>
      )}
    </Screen>
  )
}

interface MoveButtonsProps {
  readonly name: string
  readonly first: boolean
  readonly last: boolean
  readonly disabled: boolean
  readonly onMove: (direction: Direction) => void
}

/** Up and down arrows for moving one item within its list. */
function MoveButtons({ name, first, last, disabled, onMove }: MoveButtonsProps) {
  return (
    <View className="flex-row gap-1">
      <Button
        accessibilityLabel={`Move ${name} up`}
        className="size-11 min-h-11 rounded-xl px-0"
        disabled={disabled || first}
        onPress={() => onMove("up")}
      >
        <ArrowUpIcon />
      </Button>
      <Button
        accessibilityLabel={`Move ${name} down`}
        className="size-11 min-h-11 rounded-xl px-0"
        disabled={disabled || last}
        onPress={() => onMove("down")}
      >
        <ArrowDownIcon />
      </Button>
    </View>
  )
}
