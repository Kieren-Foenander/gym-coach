import { useState } from "react"
import { Pressable, View } from "react-native"
import { CATALOG, MUSCLES, mergeLibrary, searchLibrary, type Muscle } from "~/domain/catalog"
import { testIds } from "~/domain/test-ids"
import { Button, Divider, Eyebrow, SearchField, Text } from "@/components/ui"
import { useCall } from "@/data/calls"
import { ExerciseLine } from "./ExerciseLine"

const PICKER_LIMIT = 40

const isMuscle = (text: string): text is Muscle => MUSCLES.some((muscle) => muscle === text)

interface ExercisePickerProps {
  /** Names already in use here, which are left out. */
  readonly taken: ReadonlyArray<string>
  /** Offer this muscle group's exercises before anything is typed. */
  readonly group?: string
  readonly disabled: boolean
  readonly onPick: (name: string) => void
}

/** Search the library and the user's own exercises and pick one, or use a new name as typed. */
export function ExercisePicker({ taken, group = "", disabled, onPick }: ExercisePickerProps) {
  const [text, setText] = useState("")
  // Suggestions are a convenience. Until they load, or if they cannot, the library and typing a name still work.
  const known = useCall("getExercises", {}).data ?? []
  const query = text.trim()
  const skip = taken.map((name) => name.toLowerCase())
  const items = mergeLibrary(known).filter((item) => !skip.includes(item.name.toLowerCase()))

  const recent = items
    .filter((item) => item.known?.lastPerformedAt)
    .toSorted((a, b) => (b.known?.lastPerformedAt ?? 0) - (a.known?.lastPerformedAt ?? 0))
    .slice(0, 8)

  const inGroup = isMuscle(group)
    ? items.filter((item) => item.entry?.primary.includes(group))
    : items.filter((item) => group !== "" && item.entry === null && item.known?.muscleGroup === group)

  const heading = query !== "" ? null : inGroup.length > 0 ? `Other ${group.toLowerCase()} exercises` : "Recent"
  const shown = query !== "" ? searchLibrary(items, query) : inGroup.length > 0 ? inGroup : recent
  const exact = items.some((item) => item.name.toLowerCase() === query.toLowerCase())

  return (
    <View className="gap-3">
      <SearchField testID={testIds.exercisePicker.search} value={text} placeholder={`Search ${CATALOG.length} exercises`} onChange={setText} />

      {heading !== null && shown.length > 0 ? <Eyebrow className="pt-1">{heading}</Eyebrow> : null}

      {shown.length > 0 ? (
        <View>
          {shown.slice(0, PICKER_LIMIT).map((item, index) => (
            <View key={item.name}>
              {index > 0 ? <Divider /> : null}
              <Pressable
                testID={testIds.exercisePicker.option(item.name)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${item.name}`}
                disabled={disabled}
                onPress={() => onPick(item.name)}
                className={disabled ? "opacity-40" : "active:bg-raised"}
              >
                <ExerciseLine item={item} trailing={<Eyebrow className="text-xs text-accent">Add</Eyebrow>} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {shown.length > PICKER_LIMIT ? (
        <Text className="text-center text-sm text-faint">Keep typing to narrow down {shown.length} matches.</Text>
      ) : null}

      {query !== "" && !exact ? (
        <Button disabled={disabled} onPress={() => onPick(query)}>
          {`Use “${query}” as a new exercise`}
        </Button>
      ) : null}
    </View>
  )
}
