import type { ReactNode } from "react"
import { RING_COLORS, type Ring } from "~/domain/streaks"
import { testIds } from "~/domain/test-ids"

/** How far in each ring sits from the one outside it, and how thick it is, in pixels. */
const RING_STEP = 4
const RING_WIDTH = 2.5

interface DayRingsProps {
  /** Outermost first. */
  readonly rings: ReadonlyArray<Ring>
  /** A day with sessions that count toward no goal: one grey ring. */
  readonly other?: boolean
  readonly className?: string
  readonly children?: ReactNode
}

/**
 * A day ringed once for each goal it counted toward, one inside the other in each goal's colour:
 * a workout in the accent, then a walk in pink, then mini workouts in blue.
 */
export function DayRings({ rings, other = false, className = "", children }: DayRingsProps) {
  return (
    <span className={`relative flex items-center justify-center rounded-full ${className}`}>
      {rings.map((ring, index) => (
        <span
          key={ring}
          data-testid={testIds.dayRings.ring(ring)}
          aria-hidden="true"
          className="pointer-events-none absolute rounded-full"
          style={{ inset: index * RING_STEP, borderWidth: RING_WIDTH, borderColor: RING_COLORS[ring], borderStyle: "solid" }}
        />
      ))}
      {rings.length === 0 && other ? (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full border-2 border-faint/60" />
      ) : null}
      {children}
    </span>
  )
}

/** A dot in a ring's colour, for a legend. */
export function RingSwatch({ ring }: { readonly ring: Ring }) {
  return (
    <span
      aria-hidden="true"
      className="size-3 rounded-full"
      style={{ borderWidth: RING_WIDTH, borderColor: RING_COLORS[ring], borderStyle: "solid" }}
    />
  )
}
