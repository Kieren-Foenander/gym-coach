import { useState } from "react"
import { Alert, Switch, View } from "react-native"
import { isCardio } from "~/domain/catalog"
import { formatWeight } from "~/format"
import type { PlanExercise } from "~/server/repo"
import { call } from "@/api/session"
import { Button, Display, ErrorNote, Field, Loading, parseNumber, SheetScreen, Text, TextArea, TextInput } from "@/components/ui"
import { useAction, useCall } from "@/data/calls"
import { ExercisePicker } from "@/features/exercises/ExercisePicker"
import { useUser } from "@/features/user"
import type { AppScreenProps } from "@/navigation"
import { colors } from "@/theme"
import { TemplateList } from "./TemplateList"

export function TemplatesSheet({ navigation }: AppScreenProps<"Templates">) {
  return (
    <SheetScreen title="Switch plan" onClose={navigation.goBack}>
      <Text className="pb-3 text-muted">Your current plan is archived, and your logged workouts are kept.</Text>
      <TemplateList onDone={navigation.goBack} />
    </SheetScreen>
  )
}

export function AddPlanDaySheet({ navigation }: AppScreenProps<"AddPlanDay">) {
  const { act, pending, error } = useAction()
  const [name, setName] = useState("")

  const submit = () =>
    act(async () => {
      await call("addPlanDay", { name })
      navigation.goBack()
    })

  return (
    <SheetScreen title="Add a day" onClose={navigation.goBack}>
      <View className="gap-4 pb-2">
        <Field label="Day name">
          <TextInput
            autoFocus
            maxLength={80}
            placeholder="Upper body"
            value={name}
            onChangeText={setName}
            returnKeyType="done"
            onSubmitEditing={submit}
          />
        </Field>
        <ErrorNote message={error} />
        <Button variant="primary" disabled={pending || name.trim() === ""} onPress={submit}>
          Add day
        </Button>
      </View>
    </SheetScreen>
  )
}

export function EditPlanExerciseSheet({ navigation, route }: AppScreenProps<"EditPlanExercise">) {
  const { data: plan } = useCall("getPlan", {})

  const exercise = plan?.days.flatMap((day) => day.exercises).find((item) => item.id === route.params.planExerciseId)

  return (
    <SheetScreen title={exercise?.exerciseName ?? "Exercise"} onClose={navigation.goBack}>
      {exercise ? <ExerciseForm exercise={exercise} onDone={navigation.goBack} /> : <Loading error={null} />}
    </SheetScreen>
  )
}

export function AddPlanExerciseSheet({ navigation, route }: AppScreenProps<"AddPlanExercise">) {
  const { data: plan } = useCall("getPlan", {})
  const day = plan?.days.find((item) => item.id === route.params.planDayId)

  return (
    <SheetScreen title={day ? `Add to ${day.name}` : "Add exercise"} onClose={navigation.goBack}>
      <ExerciseForm
        planDayId={route.params.planDayId}
        taken={day?.exercises.map((item) => item.exerciseName) ?? []}
        onDone={navigation.goBack}
      />
    </SheetScreen>
  )
}

interface ExerciseFormProps {
  readonly exercise?: PlanExercise
  readonly planDayId?: number
  /** Exercises already on the day being added to. */
  readonly taken?: ReadonlyArray<string>
  readonly onDone: () => void
}

function ExerciseForm({ exercise, planDayId, taken = [], onDone }: ExerciseFormProps) {
  const { unit } = useUser()
  const { act, pending, error } = useAction()
  const [formError, setFormError] = useState<string | null>(null)
  const [name, setName] = useState(exercise?.exerciseName ?? "")
  const [sets, setSets] = useState(String(exercise?.sets ?? 3))
  const [repMin, setRepMin] = useState(String(exercise?.repMin ?? 8))
  const [repMax, setRepMax] = useState(String(exercise?.repMax ?? 12))

  const [weight, setWeight] = useState(
    exercise?.targetWeight === null || exercise === undefined ? "" : formatWeight(exercise.targetWeight),
  )

  const [increment, setIncrement] = useState(formatWeight(exercise?.increment ?? (unit === "kg" ? 2.5 : 5)))
  const [rest, setRest] = useState(String(exercise?.restSeconds ?? 120))
  const [notes, setNotes] = useState(exercise?.notes ?? "")
  const [autoProgress, setAutoProgress] = useState(exercise?.autoProgress ?? true)

  // Cardio has rounds and a rest between them. What to aim for goes in the notes.
  const cardio = isCardio(name)

  const submit = () => {
    const numbers = {
      sets: parseNumber(sets),
      repMin: cardio ? 1 : parseNumber(repMin),
      repMax: cardio ? 1 : parseNumber(repMax),
      increment: parseNumber(increment),
      restSeconds: parseNumber(rest),
    }

    if (
      numbers.sets === null ||
      numbers.repMin === null ||
      numbers.repMax === null ||
      numbers.increment === null ||
      numbers.restSeconds === null
    ) {
      setFormError("Fill in every number")

      return
    }

    setFormError(null)

    const changes = {
      sets: numbers.sets,
      repMin: numbers.repMin,
      repMax: numbers.repMax,
      increment: numbers.increment,
      restSeconds: numbers.restSeconds,
      targetWeight: cardio ? null : parseNumber(weight),
      notes,
      autoProgress: cardio ? false : autoProgress,
    }

    void act(async () => {
      if (exercise) await call("updatePlanExercise", { planExerciseId: exercise.id, changes })
      else if (planDayId !== undefined) await call("addPlanExercise", { planDayId, exercise: { exercise: name, ...changes } })

      onDone()
    })
  }

  const remove = (target: PlanExercise) =>
    Alert.alert(`Remove ${target.exerciseName}?`, "It comes off the plan. What you have logged for it is kept.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          void act(async () => {
            await call("removePlanExercise", { planExerciseId: target.id })
            onDone()
          }),
      },
    ])

  // Adding starts with choosing the exercise; the numbers come after.
  if (!exercise && name === "") {
    return (
      <View className="pb-3">
        <ExercisePicker taken={taken} disabled={pending} onPick={setName} />
      </View>
    )
  }

  return (
    <View className="gap-4 pb-2">
      {exercise ? null : (
        <View className="flex-row items-center justify-between gap-3">
          <Display numberOfLines={1} className="flex-1 text-2xl">
            {name}
          </Display>
          <Button variant="ghost" className="px-3" onPress={() => setName("")}>
            Change
          </Button>
        </View>
      )}
      {cardio ? (
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Field label="Rounds">
              <TextInput keyboardType="number-pad" value={sets} onChangeText={setSets} />
            </Field>
          </View>
          <View className="flex-1">
            <Field label="Rest between (sec)">
              <TextInput keyboardType="number-pad" value={rest} onChangeText={setRest} />
            </Field>
          </View>
        </View>
      ) : (
        <>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Field label="Sets">
                <TextInput keyboardType="number-pad" value={sets} onChangeText={setSets} />
              </Field>
            </View>
            <View className="flex-1">
              <Field label="Reps from">
                <TextInput keyboardType="number-pad" value={repMin} onChangeText={setRepMin} />
              </Field>
            </View>
            <View className="flex-1">
              <Field label="Reps to">
                <TextInput keyboardType="number-pad" value={repMax} onChangeText={setRepMax} />
              </Field>
            </View>
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Field label={`Weight (${unit})`}>
                <TextInput keyboardType="decimal-pad" placeholder="Find it" value={weight} onChangeText={setWeight} />
              </Field>
            </View>
            <View className="flex-1">
              <Field label={`Step (${unit})`}>
                <TextInput keyboardType="decimal-pad" value={increment} onChangeText={setIncrement} />
              </Field>
            </View>
            <View className="flex-1">
              <Field label="Rest (sec)">
                <TextInput keyboardType="number-pad" value={rest} onChangeText={setRest} />
              </Field>
            </View>
          </View>
          <View className="min-h-12 flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text>Adjust weight automatically</Text>
              <Text className="text-sm text-muted">Up when you hit every rep, down after two bad sessions</Text>
            </View>
            <Switch
              accessibilityLabel="Adjust weight automatically"
              value={autoProgress}
              onValueChange={setAutoProgress}
              trackColor={{ true: colors.accent, false: colors.line }}
              thumbColor={colors.white}
            />
          </View>
        </>
      )}
      <Field label={cardio ? "Target, such as 20 min easy" : "Notes"}>
        <TextArea maxLength={500} value={notes} onChangeText={setNotes} />
      </Field>
      <ErrorNote message={formError ?? error} />
      <Button variant="primary" disabled={pending} onPress={submit}>
        {exercise ? "Save" : "Add exercise"}
      </Button>
      {exercise ? (
        <Button variant="danger" disabled={pending} onPress={() => remove(exercise)}>
          Remove from plan
        </Button>
      ) : null}
    </View>
  )
}
