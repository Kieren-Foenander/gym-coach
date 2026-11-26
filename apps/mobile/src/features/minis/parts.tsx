import { View } from "react-native"
import { cn } from "@/lib/cn"

/** A bar filling up towards a target, in the mini workouts' blue. */
export function ProgressBar({ fraction, label }: { readonly fraction: number; readonly label: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100)

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      className="h-2 overflow-hidden rounded-full bg-raised"
    >
      <View className={cn("h-full rounded-full", fraction >= 1 ? "bg-mini" : "bg-mini/70")} style={{ width: `${percent}%` }} />
    </View>
  )
}
