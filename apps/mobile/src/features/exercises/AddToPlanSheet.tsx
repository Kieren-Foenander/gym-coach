import { useState } from "react"
import { View } from "react-native"
import { isCardio } from "~/domain/catalog"
import { call } from "@/api/session"
import { CheckIcon } from "@/components/icons"
import { Button, ErrorNote, Loading, SheetScreen, Text } from "@/components/ui"
import { useAction, useCall } from "@/data/calls"
import type { AppScreenProps } from "@/navigation"

const DEFAULT_PRESCRIPTION = { sets: 3, repMin: 8, repMax: 12 } as const
const CARDIO_PRESCRIPTION = { sets: 1, repMin: 1, repMax: 1 } as const

/** Puts the exercise at the end of one of the plan's days, with a starting prescription to adjust later. */
export function AddToPlanSheet({ navigation, route }: AppScreenProps<"AddToPlan">) {
  const { name } = route.params
  const { data: plan } = useCall("getPlan", {})
  const { act, pending, error } = useAction()
  const [addedTo, setAddedTo] = useState<string | null>(null)
  const cardio = isCardio(name)
  const prescription = cardio ? CARDIO_PRESCRIPTION : DEFAULT_PRESCRIPTION

  const add = (planDayId: number, dayName: string) =>
    act(async () => {
      await call("addPlanExercise", { planDayId, exercise: { exercise: name, ...prescription } })
      setAddedTo(dayName)
    })

  const openPlan = () => {
    // Back to the tabs, closing this sheet and the exercise page under it on the way.
    navigation.popTo("Tabs", { screen: "Plan" })
  }

  return (
    <SheetScreen title="Add to plan" onClose={navigation.goBack}>
      <View className="gap-3 pb-3">
        {addedTo === null ? (
          <Text className="text-muted">Pick a day. {name} goes at the end of it.</Text>
        ) : (
          <View accessibilityRole="alert" className="rounded-2xl bg-accent/12 px-4 py-3">
            <Text className="text-accent">
              {cardio
                ? `Added to ${addedTo} as 1 round. Set a target and more rounds under Plan.`
                : `Added to ${addedTo} at 3 × 8–12. Change the sets, reps and weight under Plan.`}
            </Text>
          </View>
        )}
        <ErrorNote message={error} />
        {plan ? null : <Loading error={null} />}
        <View className="gap-2">
          {plan?.days.map((day) => {
            const there = day.exercises.some((exercise) => exercise.exerciseName.toLowerCase() === name.toLowerCase())

            return (
              <Button key={day.id} className="justify-between" disabled={pending || there} onPress={() => add(day.id, day.name)}>
                <Text numberOfLines={1} className="flex-1 font-semibold">
                  {day.name}
                </Text>
                {there ? <CheckIcon /> : null}
              </Button>
            )
          })}
        </View>
        {addedTo === null ? null : (
          <Button variant="ghost" labelClassName="text-accent" onPress={openPlan}>
            Open plan
          </Button>
        )}
      </View>
    </SheetScreen>
  )
}
