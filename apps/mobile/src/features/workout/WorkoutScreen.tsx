import { useKeepAwake } from "expo-keep-awake"
import { useState } from "react"
import { Alert, View } from "react-native"
import type { Unit } from "~/domain/units"
import { formatClock } from "~/format"
import type { WorkoutDetail } from "~/server/repo"
import { describeError } from "@/api/client"
import { call } from "@/api/session"
import { BackLink, Button, Display, Empty, ErrorNote, Loading, Screen, Text } from "@/components/ui"
import { useAction, useCall } from "@/data/calls"
import { waitingFor, withPending } from "@/data/outbox"
import { dismissOutboxProblem, flushOutbox, forgetWorkout, pendingOps, useOutbox } from "@/data/outbox-store"
import { useUser } from "@/features/user"
import { useNow } from "@/lib/useNow"
import type { AppScreenProps } from "@/navigation"
import { ExerciseCard, isDone } from "./ExerciseCard"
import { FinishedWorkout } from "./FinishedWorkout"
import { REST_BAR_SPACE, RestBar, useRestShowing } from "./RestBar"
import { clearRest } from "./rest-timer"

export function WorkoutScreen({ navigation, route }: AppScreenProps<"Workout">) {
  const user = useUser()
  const { data: detail, error } = useCall("getWorkout", { workoutId: route.params.workoutId })

  if (!detail) {
    return (
      <Screen>
        <BackLink onPress={navigation.goBack} />
        <Loading error={error ? describeError(error) : null} />
      </Screen>
    )
  }

  return detail.workout.finishedAt === null ? (
    <ActiveWorkout detail={detail} unit={user.unit} onLeave={navigation.goBack} onAdd={() => navigation.navigate("AddWorkoutExercise", { workoutId: detail.workout.id })} />
  ) : (
    <FinishedWorkout detail={detail} unit={user.unit} />
  )
}

interface ActiveWorkoutProps {
  readonly detail: WorkoutDetail
  readonly unit: Unit
  readonly onLeave: () => void
  readonly onAdd: () => void
}

function ActiveWorkout({ detail, unit, onLeave, onAdd }: ActiveWorkoutProps) {
  // The screen stays on between sets, so the phone is ready when the rest ends.
  useKeepAwake()

  const now = useNow(true)
  const outbox = useOutbox()
  const restShowing = useRestShowing()
  const { act, pending, error } = useAction()
  const [finishError, setFinishError] = useState<string | null>(null)
  const shown = withPending(detail, outbox.ops)
  const workoutId = detail.workout.id
  const waiting = waitingFor(outbox.ops, workoutId)
  const loggedAnything = shown.exercises.some((exercise) => exercise.sets.length > 0)
  const prescribed = shown.exercises.reduce((total, exercise) => total + (exercise.target?.sets ?? 0), 0)

  const completed = shown.exercises.reduce(
    (total, exercise) => total + Math.min(exercise.sets.length, exercise.target?.sets ?? 0),
    0,
  )

  // The first planned exercise still to do, or failing that the one added most recently.
  const currentId = (shown.exercises.find((exercise) => exercise.target !== null && !isDone(exercise)) ?? shown.exercises.at(-1))
    ?.exerciseId

  const finish = () =>
    act(async () => {
      setFinishError(null)
      // Everything logged has to reach the server first: the weight changes are worked out there from every set.
      await flushOutbox()

      if (waitingFor(pendingOps(), workoutId) > 0) {
        setFinishError("Your sets are saved on this phone. Finishing needs a connection, so try again when you have signal.")

        return
      }

      const result = await call("finishWorkout", { workoutId })

      clearRest()

      if (result.discarded) onLeave()
    })

  const discard = () =>
    Alert.alert("Discard this workout?", "Its logged sets will be deleted.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () =>
          void act(async () => {
            await call("discardWorkout", { workoutId })
            forgetWorkout(workoutId)
            clearRest()
            onLeave()
          }),
      },
    ])

  const header = (
    <View className="px-4 pb-3">
      <BackLink label="Today" onPress={onLeave} />
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1">
          <Display accessibilityRole="header" numberOfLines={1}>
            {detail.workout.name}
          </Display>
          <Text className="text-sm tabular-nums text-muted">
            {formatClock((now - detail.workout.startedAt) / 1000)}
            {prescribed > 0 ? ` · ${completed} of ${prescribed} sets` : ""}
            {waiting > 0 ? ` · ${waiting} to send` : ""}
          </Text>
        </View>
        <Button variant={loggedAnything ? "primary" : "secondary"} disabled={pending} onPress={finish}>
          {loggedAnything ? "Finish" : "Cancel"}
        </Button>
      </View>
      {prescribed > 0 ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Sets completed"
          accessibilityValue={{ min: 0, max: prescribed, now: completed }}
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised"
        >
          <View className="h-full rounded-full bg-accent" style={{ width: `${(completed / prescribed) * 100}%` }} />
        </View>
      ) : null}
    </View>
  )

  return (
    <Screen header={header} footer={<RestBar />} bottomSpace={restShowing ? REST_BAR_SPACE : 0}>
      <View className="gap-3">
        <ErrorNote message={finishError ?? error} />
        {outbox.problem === null ? null : (
          <View className="gap-2">
            <ErrorNote message={`A set could not be saved: ${outbox.problem}`} />
            <Button variant="ghost" onPress={dismissOutboxProblem}>
              Dismiss
            </Button>
          </View>
        )}
        {shown.exercises.map((exercise, index) => (
          <ExerciseCard
            key={exercise.exerciseId}
            exercise={exercise}
            position={index + 1}
            current={exercise.exerciseId === currentId}
            unit={unit}
            workoutId={workoutId}
          />
        ))}
        {shown.exercises.length === 0 ? <Empty>Nothing here yet. Add the first exercise you are going to do.</Empty> : null}
        <Button variant={shown.exercises.length === 0 ? "primary" : "secondary"} onPress={onAdd}>
          Add exercise
        </Button>
        {loggedAnything ? (
          <Button variant="danger" disabled={pending} onPress={discard}>
            Discard workout
          </Button>
        ) : null}
      </View>
    </Screen>
  )
}
