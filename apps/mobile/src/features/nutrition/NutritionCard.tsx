import { useNavigation } from "@react-navigation/native"
import { Pressable, View } from "react-native"
import { localDay } from "~/domain/health"
import { formatAmount, nutritionRange, NUTRIENT_INFO } from "~/domain/nutrition"
import { ChevronIcon } from "@/components/icons"
import { CARD_CLASS, Display, SectionTitle, Text } from "@/components/ui"
import { useCall } from "@/data/calls"
import { cn } from "@/lib/cn"
import { colors } from "@/theme"
import { TargetBar } from "./parts"

/** Today's calories and protein on the home screen, leading to the food log. */
export function NutritionCard({ now }: { readonly now: number }) {
  const navigation = useNavigation()
  const today = localDay(now)
  // The same week the food screen asks for, so opening it shows straight away.
  const { data } = useCall("getNutrition", nutritionRange(today, now))
  const day = data?.days.find((item) => item.day === today)

  return (
    <>
      <SectionTitle>Food</SectionTitle>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens the food log"
        onPress={() => navigation.navigate("Nutrition")}
        className={cn(CARD_CLASS, "active:bg-raised")}
      >
        <View className="flex-row items-center gap-3">
          <View className="flex-1 flex-row gap-3">
            {(["calories", "protein"] as const).map((nutrient) => {
              const value = day?.total[nutrient] ?? 0
              const target = data?.targets[nutrient] ?? null

              return (
                <View key={nutrient} className="flex-1">
                  <Display numberOfLines={1} adjustsFontSizeToFit className="text-3xl tabular-nums">
                    {formatAmount(value)}
                    <Display className="text-base text-muted"> {NUTRIENT_INFO[nutrient].unit}</Display>
                  </Display>
                  <Text numberOfLines={1} className="text-xs text-muted">
                    {NUTRIENT_INFO[nutrient].label}
                    {target === null ? " today" : ` of ${formatAmount(target)}`}
                  </Text>
                  <TargetBar value={value} target={target} label={`${NUTRIENT_INFO[nutrient].label} against target`} />
                </View>
              )
            })}
          </View>
          <ChevronIcon size={14} color={colors.faint} />
        </View>
      </Pressable>
    </>
  )
}
