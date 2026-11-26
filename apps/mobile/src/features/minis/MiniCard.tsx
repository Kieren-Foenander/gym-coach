import { useNavigation } from "@react-navigation/native"
import { Pressable, View } from "react-native"
import { localDay } from "~/domain/health"
import { formatMiniAmount, miniRange } from "~/domain/minis"
import { testIds } from "~/domain/test-ids"
import { ChevronIcon } from "@/components/icons"
import { CARD_CLASS, SectionTitle, Text } from "@/components/ui"
import { useCall } from "@/data/calls"
import { cn } from "@/lib/cn"
import { colors } from "@/theme"
import { ProgressBar } from "./parts"

/** Today's mini workouts on the home screen, leading to their screen. Invites setting them up when there are none. */
export function MiniCard({ now }: { readonly now: number }) {
  const navigation = useNavigation()
  const today = localDay(now)
  // The same days the mini workouts screen asks for, so opening it shows straight away.
  const { data } = useCall("getMinis", miniRange(today))
  const progress = data?.days.find((item) => item.day === today)?.progress ?? []

  return (
    <>
      <SectionTitle>Mini workouts</SectionTitle>
      <Pressable
        testID={testIds.today.miniCard}
        accessibilityRole="button"
        accessibilityHint="Opens mini workouts"
        onPress={() => navigation.navigate("Minis", {})}
        className={cn(CARD_CLASS, "active:bg-raised")}
      >
        <View className="flex-row items-center gap-3">
          {progress.length === 0 ? (
            <Text className="flex-1 text-muted">
              Set daily targets, such as 100 push-ups, and get nudged to do a few at a time through the day.
            </Text>
          ) : (
            <View className="flex-1 gap-2.5">
              {progress.map((item) => (
                <View key={item.exercise} testID={testIds.today.mini(item.exercise)}>
                  <View className="flex-row items-baseline justify-between gap-3 pb-1">
                    <Text numberOfLines={1} className="flex-1 font-semibold">
                      {item.exercise}
                    </Text>
                    <Text className="text-sm tabular-nums text-muted">
                      <Text className="text-sm font-semibold">{formatMiniAmount(item.unit, item.done)}</Text> /{" "}
                      {formatMiniAmount(item.unit, item.target)}
                    </Text>
                  </View>
                  <ProgressBar fraction={item.done / item.target} label={`${item.exercise} today`} />
                </View>
              ))}
            </View>
          )}
          <ChevronIcon size={14} color={colors.faint} />
        </View>
      </Pressable>
    </>
  )
}
