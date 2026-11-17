import { useNavigation } from "@react-navigation/native"
import * as Haptics from "expo-haptics"
import { useState } from "react"
import { Pressable, View } from "react-native"
import { isCardio } from "~/domain/catalog"
import { distanceUnit, type Unit } from "~/domain/units"
import { formatPrescription, formatReps, formatSet, formatWeight } from "~/format"
import { call } from "@/api/session"
import { CheckIcon, CloseIcon } from "@/components/icons"
import { Button, Display, EffortPicker, ErrorNote, Eyebrow, parseNumber, Stepper, Text } from "@/components/ui"
import { useAction } from "@/data/calls"
import type { ShownExercise, ShownSet } from "@/data/outbox"
import { logSet, removeSet, useOutbox, withdrawSet } from "@/data/outbox-store"
import { cn } from "@/lib/cn"
import { colors } from "@/theme"
import { startRest } from "./rest-timer"

export const isDone = (exercise: ShownExercise) =>
  exercise.target !== null && exercise.target.sets > 0 && exercise.sets.length >= exercise.target.sets

interface ExerciseCardProps {
  readonly exercise: ShownExercise
  readonly position: number
  readonly current: boolean
  readonly unit: Unit
  readonly workoutId: number
}

/** One exercise in a workout in progress: what to do, what has been done, and the controls for logging the next set. */
export function ExerciseCard({ exercise, position, current, unit, workoutId }: ExerciseCardProps) {
  const navigation = useNavigation()
  const outbox = useOutbox()
  const { act, pending, error } = useAction()
  const { target, sets, previous } = exercise
  const lastSet = sets.at(-1)
  const prescribed = target?.sets ?? 0
  const done = isDone(exercise)
  const [addingExtra, setAddingExtra] = useState(false)
  const [effort, setEffort] = useState<number | null>(null)
  const [weight, setWeight] = useState(() => formatWeight(lastSet?.weight ?? target?.targetWeight ?? previous[0]?.weight ?? 0))
  const [reps, setReps] = useState(() => String(lastSet?.reps ?? previous[sets.length]?.reps ?? target?.repMin ?? 8))
  const cardio = isCardio(exercise.exerciseName)
  const lastEffort = lastSet ?? previous[sets.length] ?? previous[0]
  const [minutes, setMinutes] = useState(() => formatWeight((lastEffort?.durationSeconds ?? 1200) / 60))
  const [distance, setDistance] = useState(() => formatWeight(lastEffort?.distance ?? 0))
  const noun = cardio ? "round" : "set"

  const log = () => {
    const parsedWeight = cardio ? 0 : parseNumber(weight)
    const parsedReps = cardio ? 0 : parseNumber(reps)
    const parsedMinutes = parseNumber(minutes)
    const parsedDistance = parseNumber(distance)

    if (parsedWeight === null || parsedReps === null) return

    if (cardio && (parsedMinutes === null || parsedMinutes <= 0)) return

    const timed = cardio ? { durationSeconds: Math.round((parsedMinutes ?? 0) * 60), distance: parsedDistance || null } : {}

    // The set is saved on the phone first and sent in the background, so this works with no signal.
    logSet({ workoutId, exerciseId: exercise.exerciseId, set: { weight: parsedWeight, reps: Math.round(parsedReps), rpe: effort, ...timed } })
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setAddingExtra(false)
    setEffort(null)
    startRest(target?.restSeconds ?? 120, exercise.exerciseName)
  }

  const remove = (set: ShownSet) => {
    if (set.pendingKey === null) removeSet(workoutId, set.id)
    else withdrawSet(set.pendingKey)
  }

  return (
    <View className={cn("rounded-3xl border bg-surface p-4", current ? "border-accent/40" : "border-white/5")}>
      <View className="flex-row items-start gap-3">
        <View className={cn("size-9 items-center justify-center rounded-full", done ? "bg-accent" : current ? "bg-accent/15" : "bg-raised")}>
          {done ? (
            <CheckIcon color={colors.accentInk} />
          ) : (
            <Display className={cn("text-lg", current ? "text-accent" : "text-muted")}>{position}</Display>
          )}
        </View>
        <View className="flex-1">
          {exercise.swappedFrom === null ? null : (
            <Eyebrow numberOfLines={1} className="text-xs text-accent">
              In for {exercise.swappedFrom}
            </Eyebrow>
          )}
          <Display accessibilityRole="header" numberOfLines={1} className="pt-0.5 text-2xl">
            {exercise.exerciseName}
          </Display>
          {target && cardio ? <Text className="text-sm tabular-nums text-muted">{formatPrescription(target, unit)}</Text> : null}
          {target && !cardio ? (
            <Text className="text-sm tabular-nums text-muted">
              {target.sets} × {formatReps(target.repMin, target.repMax)} ·{" "}
              <Text className="text-sm font-semibold">
                {target.targetWeight === null ? "find your weight" : `${formatWeight(target.targetWeight)} ${unit}`}
              </Text>
            </Text>
          ) : null}
        </View>
        {prescribed > 0 ? (
          <View className="flex-row gap-1 pt-3.5">
            {Array.from({ length: prescribed }, (_, index) => index).map((index) => (
              <View key={index} className={cn("h-1.5 w-4 rounded-full", index < sets.length ? "bg-accent" : "bg-line")} />
            ))}
          </View>
        ) : null}
      </View>

      {previous.length > 0 ? (
        <Text className="pt-3 text-sm tabular-nums text-faint">
          Last time <Text className="text-sm text-muted">{previous.map((set) => formatSet(set, unit)).join(cardio ? ", " : "  ")}</Text>
        </Text>
      ) : null}
      {target?.notes ? <Text className="pt-1 text-sm text-muted">{target.notes}</Text> : null}

      {sets.length > 0 ? (
        <View className="mt-3 gap-1.5">
          {sets.map((set, index) => (
            <View key={set.pendingKey ?? set.id} className="flex-row items-center justify-between gap-3 rounded-2xl bg-raised/70 pl-3">
              <View className="flex-1 flex-row items-center gap-3">
                <Display className="w-4 text-lg text-faint">{index + 1}</Display>
                {set.durationSeconds === null ? (
                  <Display className="text-2xl tabular-nums">
                    {formatWeight(set.weight)}
                    <Display className="text-base text-muted">{` ${unit} × `}</Display>
                    {set.reps}
                  </Display>
                ) : (
                  <Display className="text-2xl tabular-nums">{formatSet(set, unit)}</Display>
                )}
                {set.rpe === null ? null : <Text className="text-sm text-muted">RPE {formatWeight(set.rpe)}</Text>}
                {set.pendingKey === null ? null : <Text className="text-xs text-faint">Saved on phone</Text>}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${noun} ${index + 1}`}
                // A set cannot be taken back in the moment it is being sent.
                disabled={set.pendingKey !== null && outbox.sending === set.pendingKey}
                onPress={() => remove(set)}
                className="size-11 items-center justify-center"
              >
                <CloseIcon color={colors.faint} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <ErrorNote message={error} />

      {done && !addingExtra ? (
        <Button variant="ghost" className="mt-2" onPress={() => setAddingExtra(true)}>
          {`Add another ${noun}`}
        </Button>
      ) : (
        <View className="mt-4 gap-3">
          {cardio ? (
            <View className="flex-row gap-2">
              <Stepper label="Minutes" value={minutes} step={1} decimal onChange={setMinutes} />
              <Stepper label={distanceUnit(unit)} value={distance} step={0.5} decimal onChange={setDistance} />
            </View>
          ) : (
            <View className="flex-row gap-2">
              <Stepper label={unit} value={weight} step={target?.increment || 2.5} decimal onChange={setWeight} />
              <Stepper label="Reps" value={reps} step={1} onChange={setReps} />
            </View>
          )}
          <EffortPicker value={effort} onChange={setEffort} />
          <Button variant={current || done ? "primary" : "secondary"} onPress={log}>
            {`Log ${noun} ${sets.length + 1}${prescribed > 0 && !done ? ` of ${prescribed}` : ""}`}
          </Button>
          <View className="flex-row gap-2">
            {cardio ? null : (
              <Button
                variant="ghost"
                className="flex-1 px-2"
                labelClassName="text-sm"
                onPress={() =>
                  navigation.navigate("LoadingGuide", { exerciseName: exercise.exerciseName, weight: parseNumber(weight) ?? 0 })
                }
              >
                Warm-up and plates
              </Button>
            )}
            {target && sets.length === 0 ? (
              <Button
                variant="ghost"
                className="flex-1 px-2"
                labelClassName="text-sm"
                onPress={() => navigation.navigate("SwapExercise", { workoutId, planExerciseId: target.id })}
              >
                Swap exercise
              </Button>
            ) : null}
            {!target && sets.length === 0 ? (
              <Button
                variant="ghost"
                className="flex-1 px-2"
                labelClassName="text-sm"
                disabled={pending}
                onPress={() => act(() => call("removeWorkoutExercise", { workoutId, exerciseId: exercise.exerciseId }))}
              >
                Remove
              </Button>
            ) : null}
          </View>
        </View>
      )}
    </View>
  )
}
