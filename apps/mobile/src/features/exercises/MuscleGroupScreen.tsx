import { useState } from "react"
import { View } from "react-native"
import { EQUIPMENT, mergeLibrary, type Equipment } from "~/domain/catalog"
import { BackLink, Chip, ChipRow, Display, Screen } from "@/components/ui"
import { useCall } from "@/data/calls"
import type { AppScreenProps } from "@/navigation"
import { ExerciseRows } from "./ExerciseRows"

/** Every library exercise that mainly works one muscle, narrowed by equipment if wanted. */
export function MuscleGroupScreen({ navigation, route }: AppScreenProps<"MuscleGroup">) {
  const { muscle } = route.params
  const [equipment, setEquipment] = useState<Equipment | null>(null)
  const known = useCall("getExercises", {}).data ?? []
  const inGroup = mergeLibrary(known).filter((item) => item.entry?.primary.includes(muscle))
  const offered = EQUIPMENT.filter((option) => inGroup.some((item) => item.entry?.equipment === option))
  const filtered = equipment ? inGroup.filter((item) => item.entry?.equipment === equipment) : inGroup

  return (
    <Screen>
      <BackLink label="All muscles" onPress={navigation.goBack} />
      <Display accessibilityRole="header" className="pb-2 text-5xl">
        {muscle}
      </Display>
      <ChipRow label="Equipment">
        <Chip label="All" selected={equipment === null} onPress={() => setEquipment(null)} />
        {offered.map((option) => (
          <Chip key={option} label={option} selected={equipment === option} onPress={() => setEquipment(option)} />
        ))}
      </ChipRow>
      <View className="pt-4">
        <ExerciseRows items={filtered} />
      </View>
    </Screen>
  )
}
