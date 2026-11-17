import { useState } from "react"
import { View } from "react-native"
import { BAR_WEIGHTS, platesPerSide, warmupSets } from "~/domain/loading"
import { formatWeight } from "~/format"
import { Display, Eyebrow, Segmented, SheetScreen, Text } from "@/components/ui"
import { storage } from "@/data/storage"
import { useUser } from "@/features/user"
import type { AppScreenProps } from "@/navigation"

const BAR_KEY = "gym.barWeight"

/** Warm-up sets leading to a weight, and the plates to put on each side of the bar for it. */
export function LoadingGuideSheet({ navigation, route }: AppScreenProps<"LoadingGuide">) {
  const { unit } = useUser()
  const { exerciseName, weight } = route.params
  const bars = BAR_WEIGHTS[unit]

  const [bar, setBar] = useState(() => {
    const saved = Number(storage.get(BAR_KEY))

    return bars.includes(saved) ? saved : (bars[0] ?? 0)
  })

  const chooseBar = (label: string) => {
    setBar(Number(label))
    storage.set(BAR_KEY, label)
  }

  const load = platesPerSide(weight, bar, unit)
  const warmups = warmupSets(weight, bar, unit)

  return (
    <SheetScreen title={exerciseName} onClose={navigation.goBack}>
      <View className="gap-5 pb-3">
        <View>
          <Text className="pb-1.5 text-sm text-muted">Bar weight ({unit})</Text>
          <Segmented label="Bar weight" options={bars.map(String)} value={String(bar)} onChange={chooseBar} />
        </View>

        <View>
          <Eyebrow className="pb-2">
            Each side for {formatWeight(weight)} {unit}
          </Eyebrow>
          {load === null ? (
            <Text className="text-muted">That is lighter than the bar.</Text>
          ) : load.perSide.length === 0 ? (
            <Text className="text-muted">Just the bar.</Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {load.perSide.map((plate, index) => (
                // The same plate size can appear twice, so the position is part of the key.
                <View key={`${index}-${plate}`} className="rounded-xl bg-accent px-3 py-2">
                  <Display className="text-2xl tabular-nums text-accent-ink">{formatWeight(plate)}</Display>
                </View>
              ))}
            </View>
          )}
          {load !== null && load.leftover > 0 ? (
            <Text className="pt-2 text-sm text-amber-300">
              Standard plates leave {formatWeight(load.leftover)} {unit} short.
            </Text>
          ) : null}
        </View>

        <View>
          <Eyebrow className="pb-2">Warm-up</Eyebrow>
          {warmups.length === 0 ? (
            <Text className="text-muted">No warm-up sets needed at this weight.</Text>
          ) : (
            <View className="gap-1.5">
              {warmups.map((set) => (
                <View key={set.weight} className="flex-row items-center justify-between rounded-2xl bg-raised/70 px-4 py-2.5">
                  <Display className="text-2xl tabular-nums">
                    {formatWeight(set.weight)}
                    <Display className="text-base text-muted">{` ${unit} × `}</Display>
                    {set.reps}
                  </Display>
                  <Text className="text-sm tabular-nums text-muted">
                    {(platesPerSide(set.weight, bar, unit)?.perSide ?? []).map(formatWeight).join(" + ") || "bar only"}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <Text className="pt-2 text-sm text-faint">Warm-up sets are a guide and are not logged.</Text>
        </View>
      </View>
    </SheetScreen>
  )
}
