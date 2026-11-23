import { useNavigation } from "@react-navigation/native"
import * as Haptics from "expo-haptics"
import { useState } from "react"
import { Pressable, View } from "react-native"
import { catalogByName, isCardio } from "~/domain/catalog"
import type { ExerciseState } from "~/domain/focus"
import { loadKindFor } from "~/domain/loading"
import { testIds } from "~/domain/test-ids"
import { distanceUnit, type Unit } from "~/domain/units"
import { formatPrescription, formatReps, formatSet, formatWeight } from "~/format"
import { call } from "@/api/session"
import { CheckIcon, CloseIcon } from "@/components/icons"
import { Button, Display, EffortPicker, ErrorNote, Eyebrow, Field, parseNumber, Stepper, Text, TextInput } from "@/components/ui"
import { useAction } from "@/data/calls"
import type { SetValues, ShownExercise, ShownSet } from "@/data/outbox"
import { editSet, logSet, removeSet, sentSetId, useOutbox, withdrawSet } from "@/data/outbox-store"
import { ExerciseThumbnail } from "@/features/exercises/ExerciseLine"
import { cn } from "@/lib/cn"
import { colors } from "@/theme"
import { startRest } from "./rest-timer"

interface ExerciseCardProps {
  readonly exercise: ShownExercise
  readonly position: number
  readonly state: ExerciseState
  readonly unit: Unit
  readonly workoutId: number
}

/** What the set form holds: the set being changed, or else a guess at the next set. */
interface SetDraft {
  readonly weight: string
  readonly reps: string
  readonly minutes: string
  readonly distance: string
  readonly effort: number | null
  readonly note: string
}

const nextSetDraft = (exercise: ShownExercise): SetDraft => {
  const { target, sets, previous } = exercise
  const lastSet = sets.at(-1)
  const lastEffort = lastSet ?? previous[sets.length] ?? previous[0]

  return {
    weight: formatWeight(lastSet?.weight ?? target?.targetWeight ?? previous[0]?.weight ?? 0),
    reps: String(lastSet?.reps ?? previous[sets.length]?.reps ?? target?.repMin ?? 8),
    minutes: formatWeight((lastEffort?.durationSeconds ?? 1200) / 60),
    distance: formatWeight(lastEffort?.distance ?? 0),
    effort: null,
    note: "",
  }
}

const draftOf = (set: ShownSet): SetDraft => ({
  weight: formatWeight(set.weight),
  reps: String(set.reps),
  minutes: formatWeight((set.durationSeconds ?? 0) / 60),
  distance: formatWeight(set.distance ?? 0),
  effort: set.rpe,
  note: set.note,
})

/** Which set is being changed: by its pending key while it waits to be sent, else by its id. */
const sameSet = (a: ShownSet, b: ShownSet) => (a.pendingKey ?? a.id) === (b.pendingKey ?? b.id)

/** One exercise in a workout in progress: what to do, what has been done, and the controls for logging the next set. */
export function ExerciseCard({ exercise, position, state, unit, workoutId }: ExerciseCardProps) {
  const navigation = useNavigation()
  const outbox = useOutbox()
  const { act, pending, error } = useAction()
  const { target, sets, previous } = exercise
  const prescribed = target?.sets ?? 0
  const done = state === "done"
  const current = state === "current"
  const skipped = state === "skipped"
  const [addingExtra, setAddingExtra] = useState(false)
  const [editing, setEditing] = useState<ShownSet | null>(null)
  const [draft, setDraft] = useState(() => nextSetDraft(exercise))
  const [noteOpen, setNoteOpen] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const cardio = isCardio(exercise.exerciseName)
  const loadKind = loadKindFor(exercise.exerciseName)
  const noun = cardio ? "round" : "set"
  const change = (patch: Partial<SetDraft>) => setDraft((before) => ({ ...before, ...patch }))
  // A set that was waiting when its form opened keeps its place once it has been sent and has an id.
  const editingSentId = editing?.pendingKey == null ? null : sentSetId(editing.pendingKey)
  const isEditing = (set: ShownSet) => editing !== null && (sameSet(set, editing) || (editingSentId !== null && set.id === editingSentId))
  const editingNumber = sets.findIndex(isEditing) + 1
  const sending = (set: ShownSet) => set.pendingKey !== null && outbox.sending === set.pendingKey

  const startEditing = (set: ShownSet) => {
    setEditing(set)
    setDraft(draftOf(set))
    setNoteOpen(set.note !== "")
    setEditError(null)
  }

  const stopEditing = () => {
    setEditing(null)
    setDraft(nextSetDraft(exercise))
    setNoteOpen(false)
    setEditError(null)
  }

  /** Closes the form after a correction. The next set starts from the corrected numbers, not the ones shown before it. */
  const finishEditing = (values: SetValues) => {
    const corrected = sets.map((item) =>
      isEditing(item)
        ? {
            ...item,
            weight: values.weight,
            reps: values.reps,
            rpe: values.rpe ?? null,
            durationSeconds: values.durationSeconds ?? null,
            distance: values.distance ?? null,
            note: values.note ?? "",
          }
        : item,
    )

    setEditing(null)
    setDraft(nextSetDraft({ ...exercise, sets: corrected }))
    setNoteOpen(false)
    setEditError(null)
  }

  /** The set the form describes, or null when a number in it cannot be read. */
  const readDraft = (): SetValues | null => {
    const parsedWeight = cardio ? 0 : parseNumber(draft.weight)
    const parsedReps = cardio ? 0 : parseNumber(draft.reps)
    const parsedMinutes = parseNumber(draft.minutes)
    const parsedDistance = parseNumber(draft.distance)

    if (parsedWeight === null || parsedReps === null) return null

    if (cardio && (parsedMinutes === null || parsedMinutes <= 0)) return null

    const timed = cardio ? { durationSeconds: Math.round((parsedMinutes ?? 0) * 60), distance: parsedDistance || null } : {}

    return { weight: parsedWeight, reps: Math.round(parsedReps), rpe: draft.effort, note: draft.note.trim(), ...timed }
  }

  const log = () => {
    const set = readDraft()

    if (set === null) return

    // The set is saved on the phone first and sent in the background, so this works with no signal.
    logSet({ workoutId, exerciseId: exercise.exerciseId, set })
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setAddingExtra(false)
    setDraft((before) => ({ ...before, effort: null, note: "" }))
    setNoteOpen(false)
    startRest(target?.restSeconds ?? 120, exercise.exerciseName)
  }

  const save = (set: ShownSet) => {
    const values = readDraft()

    if (values === null) return

    // Changes go through the same queue as new sets, so a set can be corrected with no signal too.
    if (!editSet({ workoutId, setId: set.id, pendingKey: set.pendingKey }, values)) {
      setEditError("That set is being saved right now. Try again in a moment.")

      return
    }

    void Haptics.selectionAsync()
    finishEditing(values)
  }

  const remove = (set: ShownSet) => {
    if (isEditing(set)) stopEditing()

    if (set.pendingKey === null) removeSet(workoutId, set.id)
    else withdrawSet(set.pendingKey)
  }

  const formOpen = editing !== null || !(done || skipped) || addingExtra
  const left = prescribed - sets.length
  const openNote = () => navigation.navigate("ExerciseNote", { workoutId, exerciseId: exercise.exerciseId })

  return (
    <View
      testID={testIds.workout.exercise(exercise.exerciseName)}
      className={cn("rounded-3xl border bg-surface p-4", current ? "border-accent/40" : "border-white/5")}
    >
      <View className="flex-row items-start gap-3">
        <View>
          <ExerciseThumbnail entry={catalogByName(exercise.exerciseName)} size={56} />
          <View
            className={cn(
              "absolute -bottom-1.5 -right-1.5 size-7 items-center justify-center rounded-full border-2 border-surface",
              done ? "bg-accent" : current ? "bg-accent-ink" : "bg-raised",
            )}
          >
            {done ? (
              <CheckIcon size={14} color={colors.accentInk} />
            ) : (
              <Display className={cn("text-sm", current ? "text-accent" : "text-muted")}>{position}</Display>
            )}
          </View>
        </View>
        <View className="flex-1">
          {exercise.swappedFrom === null ? null : (
            <Eyebrow numberOfLines={1} className="text-xs text-accent">
              In for {exercise.swappedFrom}
            </Eyebrow>
          )}
          <Pressable
            accessibilityRole="link"
            accessibilityHint="Opens the exercise"
            testID={testIds.workout.exerciseName}
            onPress={() => navigation.navigate("OwnExercise", { exerciseId: exercise.exerciseId })}
          >
            {({ pressed }) => (
              <Display accessibilityRole="header" numberOfLines={1} className={cn("pt-0.5 text-2xl", pressed && "text-accent")}>
                {exercise.exerciseName}
              </Display>
            )}
          </Pressable>
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
              <View
                key={index}
                className={cn("h-1.5 w-4 rounded-full", index < sets.length ? "bg-accent" : skipped ? "bg-amber-300/60" : "bg-line")}
              />
            ))}
          </View>
        ) : null}
      </View>

      {skipped ? (
        <Text className="pt-3 text-sm text-amber-300">
          {left === 1 ? `1 ${noun} skipped` : `${left} ${noun}s skipped`}. You moved on, so the workout did too.
        </Text>
      ) : null}
      {previous.length > 0 ? (
        <Text className="pt-3 text-sm tabular-nums text-faint">
          Last time <Text className="text-sm text-muted">{previous.map((set) => formatSet(set, unit)).join(cardio ? ", " : "  ")}</Text>
        </Text>
      ) : null}
      {target?.notes ? <Text className="pt-1 text-sm text-muted">{target.notes}</Text> : null}
      {exercise.note === "" ? null : (
        <Pressable accessibilityRole="button" accessibilityHint="Changes the note" onPress={openNote} className="mt-2 rounded-2xl bg-raised/70 px-3 py-2">
          <Eyebrow className="text-xs text-faint">Your note</Eyebrow>
          <Text className="text-sm">{exercise.note}</Text>
        </Pressable>
      )}

      {sets.length > 0 ? (
        <View className="mt-3 gap-1.5">
          {sets.map((set, index) => {
            const editingThis = isEditing(set)

            return (
              <View
                key={set.pendingKey ?? set.id}
                testID={testIds.workout.set(index + 1)}
                className={cn("rounded-2xl pl-3", editingThis ? "border border-accent/40 bg-accent/15" : "bg-raised/70")}
              >
                <View className="flex-row items-center justify-between gap-2">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Change ${noun} ${index + 1}`}
                    testID={testIds.workout.editSet}
                    disabled={sending(set)}
                    onPress={() => (editingThis ? stopEditing() : startEditing(set))}
                    className="min-h-11 flex-1 flex-row items-center gap-3"
                  >
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
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${noun} ${index + 1}`}
                    // A set cannot be taken back in the moment it is being sent.
                    disabled={sending(set)}
                    onPress={() => remove(set)}
                    className="size-11 items-center justify-center"
                  >
                    <CloseIcon color={colors.faint} />
                  </Pressable>
                </View>
                {set.note === "" ? null : <Text className="pb-2 pl-7 pr-3 text-sm text-muted">{set.note}</Text>}
              </View>
            )
          })}
        </View>
      ) : null}

      <ErrorNote message={editError ?? error} />

      {formOpen ? (
        <View className="mt-4 gap-3">
          {editing === null ? null : (
            <Eyebrow className="text-xs text-accent">
              Changing {noun} {editingNumber}
            </Eyebrow>
          )}
          {cardio ? (
            <View className="flex-row gap-2">
              <Stepper label="Minutes" value={draft.minutes} step={1} decimal onChange={(minutes) => change({ minutes })} />
              <Stepper label={distanceUnit(unit)} value={draft.distance} step={0.5} decimal onChange={(distance) => change({ distance })} />
            </View>
          ) : (
            <View className="flex-row gap-2">
              <Stepper label={unit} value={draft.weight} step={target?.increment || 2.5} decimal onChange={(weight) => change({ weight })} />
              <Stepper label="Reps" value={draft.reps} step={1} onChange={(reps) => change({ reps })} />
            </View>
          )}
          <EffortPicker value={draft.effort} onChange={(effort) => change({ effort })} />
          {noteOpen ? (
            <Field label="Note on this set · optional">
              <TextInput
                testID={testIds.workout.setNote}
                value={draft.note}
                maxLength={200}
                placeholder="Grip slipped, felt easy, knee twinged…"
                returnKeyType="done"
                onChangeText={(note) => change({ note })}
              />
            </Field>
          ) : null}
          {editing === null ? (
            <Button testID={testIds.workout.logSet} variant={current || done ? "primary" : "secondary"} onPress={log}>
              {`Log ${noun} ${sets.length + 1}${prescribed > 0 && sets.length < prescribed ? ` of ${prescribed}` : ""}`}
            </Button>
          ) : (
            <View className="flex-row gap-2">
              <Button testID={testIds.workout.cancelEdit} className="flex-1" onPress={stopEditing}>
                Cancel
              </Button>
              <Button testID={testIds.workout.saveSet} variant="primary" className="flex-1" onPress={() => save(editing)}>
                {`Save ${noun} ${editingNumber}`}
              </Button>
            </View>
          )}
          <View className="flex-row flex-wrap gap-1">
            {noteOpen ? null : (
              <Button
                testID={testIds.workout.addSetNote}
                variant="ghost"
                className="grow px-3"
                labelClassName="text-sm"
                onPress={() => setNoteOpen(true)}
              >
                {cardio ? "Round note" : "Set note"}
              </Button>
            )}
            <Button testID={testIds.workout.editExerciseNote} variant="ghost" className="grow px-3" labelClassName="text-sm" onPress={openNote}>
              Exercise note
            </Button>
            {cardio || loadKind === "none" || editing !== null ? null : (
              <Button
                variant="ghost"
                className="grow px-3"
                labelClassName="text-sm"
                onPress={() =>
                  navigation.navigate("LoadingGuide", { exerciseName: exercise.exerciseName, weight: parseNumber(draft.weight) ?? 0 })
                }
              >
                {loadKind === "bar" ? "Warm-up and plates" : "Warm-up"}
              </Button>
            )}
            {target && sets.length === 0 ? (
              <Button
                variant="ghost"
                className="grow px-3"
                labelClassName="text-sm"
                onPress={() => navigation.navigate("SwapExercise", { workoutId, planExerciseId: target.id })}
              >
                Swap exercise
              </Button>
            ) : null}
            {!target && sets.length === 0 ? (
              <Button
                variant="ghost"
                className="grow px-3"
                labelClassName="text-sm"
                disabled={pending}
                onPress={() => act(() => call("removeWorkoutExercise", { workoutId, exerciseId: exercise.exerciseId }))}
              >
                Remove
              </Button>
            ) : null}
          </View>
        </View>
      ) : (
        <View className="mt-2 flex-row gap-2">
          <Button variant="ghost" className="flex-1 px-2" labelClassName="text-sm" onPress={() => setAddingExtra(true)}>
            {done ? `Add another ${noun}` : `Log ${noun} ${sets.length + 1} of ${prescribed} after all`}
          </Button>
          <Button testID={testIds.workout.editExerciseNote} variant="ghost" className="px-3" labelClassName="text-sm" onPress={openNote}>
            {exercise.note === "" ? "Add note" : "Edit note"}
          </Button>
        </View>
      )}
    </View>
  )
}
