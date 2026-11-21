import { useNavigation } from "@react-navigation/native"
import { useState } from "react"
import { Pressable, View } from "react-native"
import { CATALOG, catalogForMuscle, MUSCLES, mergeLibrary, searchLibrary } from "~/domain/catalog"
import { testIds } from "~/domain/test-ids"
import { Display, Empty, PageTitle, Screen, SearchField, SectionTitle, Text } from "@/components/ui"
import { useCall } from "@/data/calls"
import { ExerciseRows } from "./ExerciseRows"

const SEARCH_LIMIT = 60

/** How many library exercises mainly work each muscle, for the muscle grid. */
const MUSCLE_COUNTS = MUSCLES.map((muscle) => ({ muscle, count: catalogForMuscle(muscle).length }))

export function ExercisesScreen() {
  const navigation = useNavigation()
  const [query, setQuery] = useState("")
  // The library is built in, so it shows at once. The user's own exercises are laid over it when they arrive.
  const known = useCall("getExercises", {}).data ?? []
  const items = mergeLibrary(known)
  const own = items.filter((item) => item.entry === null)
  const searching = query.trim() !== ""
  const found = searching ? searchLibrary(items, query) : []

  return (
    <Screen tabs>
      <PageTitle eyebrow={`${CATALOG.length + own.length} in the library`}>Exercises</PageTitle>
      <SearchField value={query} placeholder="Name, muscle or equipment" onChange={setQuery} />

      {searching ? (
        <View className="pt-4">
          {found.length === 0 ? (
            <Empty>{`Nothing matches “${query.trim()}”. You can still add it by name from your plan or a workout.`}</Empty>
          ) : (
            <>
              <ExerciseRows items={found.slice(0, SEARCH_LIMIT)} />
              {found.length > SEARCH_LIMIT ? (
                <Text className="pt-3 text-center text-sm text-faint">Keep typing to narrow down {found.length} matches.</Text>
              ) : null}
            </>
          )}
        </View>
      ) : (
        <>
          <SectionTitle>By muscle</SectionTitle>
          <View className="flex-row flex-wrap gap-2">
            {MUSCLE_COUNTS.map(({ muscle, count }) => (
              <Pressable
                key={muscle}
                testID={testIds.exercises.muscle(muscle)}
                accessibilityRole="button"
                accessibilityLabel={`${muscle}, ${count} exercises`}
                onPress={() => navigation.navigate("MuscleGroup", { muscle })}
                className="min-h-16 w-[48.5%] flex-row items-center justify-between gap-2 rounded-2xl border border-white/5 bg-surface px-4 active:bg-raised"
              >
                <Display numberOfLines={1} className="flex-1 text-2xl">
                  {muscle}
                </Display>
                <Text className="text-sm tabular-nums text-faint">{count}</Text>
              </Pressable>
            ))}
          </View>

          {own.length > 0 ? (
            <>
              <SectionTitle>Your own</SectionTitle>
              <ExerciseRows items={own} />
            </>
          ) : null}
        </>
      )}
    </Screen>
  )
}
