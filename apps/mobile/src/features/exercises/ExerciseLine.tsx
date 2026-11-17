import { Image } from "expo-image"
import type { ReactNode } from "react"
import { View } from "react-native"
import type { CatalogExercise, LibraryItem } from "~/domain/catalog"
import { BarbellIcon, ChevronIcon } from "@/components/icons"
import { Text } from "@/components/ui"
import { colors } from "@/theme"
import { useDemos } from "./demos"

/** What an exercise is done with and what it mainly works, as one line. */
export const describeItem = (item: LibraryItem): string =>
  item.entry ? `${item.entry.equipment} · ${item.entry.primary.join(", ")}` : item.known?.muscleGroup || "Your own"

/** The poster of an exercise's demonstration, or the app's mark until one has been rendered. */
function Thumbnail({ entry }: { readonly entry: CatalogExercise | null }) {
  const { demoFor, demoFile } = useDemos()
  const demo = entry ? demoFor(entry.slug) : null

  return (
    <View className="size-12 items-center justify-center overflow-hidden rounded-xl bg-ink">
      {demo ? (
        <Image
          source={{ uri: `${demoFile(demo, demo.views[0] ?? "front")}.webp` }}
          style={{ width: 48, height: 48 }}
          contentFit="cover"
          cachePolicy="disk"
        />
      ) : (
        <BarbellIcon size={24} color={colors.line} />
      )}
    </View>
  )
}

interface ExerciseLineProps {
  readonly item: LibraryItem
  /** What sits at the right-hand end. A chevron by default. */
  readonly trailing?: ReactNode
}

/** The inside of one row in a list of exercises. */
export function ExerciseLine({ item, trailing }: ExerciseLineProps) {
  return (
    <View className="min-h-16 flex-row items-center gap-3 py-2">
      <Thumbnail entry={item.entry} />
      <View className="flex-1">
        <Text numberOfLines={1} className="font-semibold">
          {item.name}
        </Text>
        <Text numberOfLines={1} className="text-sm text-muted">
          {describeItem(item)}
          {item.known?.lastPerformedAt ? <Text className="text-sm text-accent"> · Logged</Text> : null}
        </Text>
      </View>
      {trailing ?? <ChevronIcon color={colors.faint} />}
    </View>
  )
}
