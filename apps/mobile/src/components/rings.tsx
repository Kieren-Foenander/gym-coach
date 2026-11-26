import type { ReactNode } from "react"
import { View } from "react-native"
import { RING_COLORS, type Ring } from "~/domain/streaks"
import { testIds } from "~/domain/test-ids"
import { cn } from "@/lib/cn"

/** How far in each ring sits from the one outside it, and how thick it is. */
const RING_STEP = 4
const RING_WIDTH = 2.5

interface DayRingsProps {
  /** Outermost first. */
  readonly rings: ReadonlyArray<Ring>
  /** A day with sessions that count toward no goal: one grey ring. */
  readonly other?: boolean
  /** Size and anything else; the rings fill it. */
  readonly className?: string
  readonly children?: ReactNode
}

/**
 * A day ringed once for each goal it counted toward, one inside the other in each goal's colour:
 * a workout in the accent, then a walk in pink, then mini workouts in blue. The web app draws the
 * same (src/components/rings.tsx).
 */
export function DayRings({ rings, other = false, className, children }: DayRingsProps) {
  return (
    <View className={cn("items-center justify-center rounded-full", className)}>
      {rings.map((ring, index) => (
        <View
          key={ring}
          testID={testIds.dayRings.ring(ring)}
          pointerEvents="none"
          className="absolute rounded-full"
          style={{ top: index * RING_STEP, left: index * RING_STEP, right: index * RING_STEP, bottom: index * RING_STEP, borderWidth: RING_WIDTH, borderColor: RING_COLORS[ring] }}
        />
      ))}
      {rings.length === 0 && other ? <View pointerEvents="none" className="absolute inset-0 rounded-full border-2 border-faint/60" /> : null}
      {children}
    </View>
  )
}

/** A small ring in a goal's colour, for a legend. */
export function RingSwatch({ ring }: { readonly ring: Ring }) {
  return <View className="size-3 rounded-full" style={{ borderWidth: RING_WIDTH, borderColor: RING_COLORS[ring] }} />
}
