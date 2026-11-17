import { useNavigation } from "@react-navigation/native"
import { Pressable, View } from "react-native"
import type { LibraryItem } from "~/domain/catalog"
import { Card, Divider } from "@/components/ui"
import { ExerciseLine } from "./ExerciseLine"

/** A card of exercises, each opening its own page. */
export function ExerciseRows({ items }: { readonly items: ReadonlyArray<LibraryItem> }) {
  const navigation = useNavigation()

  const open = (item: LibraryItem) => {
    if (item.entry) navigation.navigate("LibraryExercise", { slug: item.entry.slug })
    else if (item.known) navigation.navigate("OwnExercise", { exerciseId: item.known.id })
  }

  return (
    <Card className="py-1">
      {items.map((item, index) => (
        <View key={item.name}>
          {index > 0 ? <Divider /> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={item.name} onPress={() => open(item)}>
            <ExerciseLine item={item} />
          </Pressable>
        </View>
      ))}
    </Card>
  )
}
