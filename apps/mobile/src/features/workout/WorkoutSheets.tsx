import { useState } from "react"
import { View } from "react-native"
import { testIds } from "~/domain/test-ids"
import { call } from "@/api/session"
import { Button, ErrorNote, Field, Loading, SheetScreen, Text, TextArea } from "@/components/ui"
import { useAction, useCall } from "@/data/calls"
import { ExercisePicker } from "@/features/exercises/ExercisePicker"
import type { AppScreenProps } from "@/navigation"

/** Adds an exercise to the workout: search the library, pick one done before, or type a new one. */
export function AddWorkoutExerciseSheet({ navigation, route }: AppScreenProps<"AddWorkoutExercise">) {
  const { workoutId } = route.params
  const { data: detail } = useCall("getWorkout", { workoutId })
  const { act, pending, error } = useAction()

  const add = (exercise: string) =>
    act(async () => {
      await call("addWorkoutExercise", { workoutId, exercise })
      navigation.goBack()
    })

  return (
    <SheetScreen title="Add exercise" onClose={navigation.goBack}>
      <View className="gap-4 pb-3">
        <ErrorNote message={error} />
        <ExercisePicker taken={detail?.exercises.map((item) => item.exerciseName) ?? []} disabled={pending} onPick={add} />
      </View>
    </SheetScreen>
  )
}

/** Picks a stand-in for a planned exercise, for this workout only. */
export function SwapExerciseSheet({ navigation, route }: AppScreenProps<"SwapExercise">) {
  const { workoutId, planExerciseId } = route.params
  const { data: detail } = useCall("getWorkout", { workoutId })
  const { act, pending, error } = useAction()
  const exercise = detail?.exercises.find((item) => item.target?.id === planExerciseId)
  const swappedFrom = exercise?.swappedFrom ?? null

  const swapTo = (name: string) =>
    act(async () => {
      await call("swapExercise", { workoutId, planExerciseId, exercise: name })
      navigation.goBack()
    })

  return (
    <SheetScreen title="Swap exercise" onClose={navigation.goBack}>
      {exercise && detail ? (
        <View className="gap-4 pb-3">
          <Text className="text-muted">
            Replaces {exercise.exerciseName} for this workout only. Your plan stays the same, and the sets, reps and rest carry over.
          </Text>
          <ErrorNote message={error} />

          {swappedFrom === null ? null : (
            <Button disabled={pending} onPress={() => swapTo(swappedFrom)}>
              {`Back to ${swappedFrom}`}
            </Button>
          )}

          <ExercisePicker
            taken={detail.exercises.map((item) => item.exerciseName)}
            group={exercise.target?.muscleGroup ?? ""}
            disabled={pending}
            onPick={swapTo}
          />
        </View>
      ) : (
        <Loading error={null} />
      )}
    </SheetScreen>
  )
}

/** The note on one exercise in this workout, such as the seat setting or which bench was free. */
export function ExerciseNoteSheet({ navigation, route }: AppScreenProps<"ExerciseNote">) {
  const { workoutId, exerciseId } = route.params
  const { data: detail } = useCall("getWorkout", { workoutId })
  const exercise = detail?.exercises.find((item) => item.exerciseId === exerciseId)

  return (
    <SheetScreen title={exercise?.exerciseName ?? "Note"} onClose={navigation.goBack}>
      {exercise ? (
        <NoteForm workoutId={workoutId} exerciseId={exerciseId} note={exercise.note} onDone={navigation.goBack} />
      ) : (
        <Loading error={null} />
      )}
    </SheetScreen>
  )
}

interface NoteFormProps {
  readonly workoutId: number
  readonly exerciseId: number
  readonly note: string
  readonly onDone: () => void
}

function NoteForm({ workoutId, exerciseId, note, onDone }: NoteFormProps) {
  const { act, pending, error } = useAction()
  const [text, setText] = useState(note)

  const save = (value: string) =>
    act(async () => {
      await call("setExerciseNote", { workoutId, exerciseId, note: value })
      onDone()
    })

  return (
    <View className="gap-3 pb-3">
      <Field label="Note for this workout">
        <TextArea
          testID={testIds.workout.exerciseNote}
          autoFocus
          value={text}
          maxLength={500}
          placeholder="Seat on 4, the far bench, felt strong…"
          onChangeText={setText}
        />
      </Field>
      <Text className="text-sm text-faint">Saving a note needs a connection.</Text>
      <ErrorNote message={error} />
      <Button testID={testIds.workout.saveExerciseNote} variant="primary" disabled={pending} onPress={() => save(text)}>
        Save note
      </Button>
      {note === "" ? null : (
        <Button variant="ghost" disabled={pending} onPress={() => save("")}>
          Remove note
        </Button>
      )}
    </View>
  )
}
