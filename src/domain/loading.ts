import type { Unit } from "./schema"

/** Plate sizes found in most gyms, heaviest first. */
const PLATES: Record<Unit, ReadonlyArray<number>> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
}

export const BAR_WEIGHTS: Record<Unit, ReadonlyArray<number>> = {
  kg: [20, 15, 10],
  lb: [45, 35, 15],
}

export interface PlateLoad {
  /** Plates for one side of the bar, heaviest first. */
  readonly perSide: ReadonlyArray<number>
  /** Weight that standard plates cannot make up, across both sides. */
  readonly leftover: number
}

/** Which plates go on each side of the bar to reach a total weight. Null when the total is lighter than the bar. */
export const platesPerSide = (total: number, bar: number, unit: Unit): PlateLoad | null => {
  if (total < bar) return null

  const perSide: Array<number> = []
  let remaining = (total - bar) / 2

  for (const plate of PLATES[unit]) {
    // The small tolerance absorbs floating point error from halving.
    while (remaining >= plate - 1e-9) {
      perSide.push(plate)
      remaining -= plate
    }
  }

  return { perSide, leftover: Math.round(Math.max(0, remaining) * 2 * 100) / 100 }
}

export interface WarmupSet {
  readonly weight: number
  readonly reps: number
}

const RAMP = [
  { fraction: 0.5, reps: 5 },
  { fraction: 0.7, reps: 3 },
  { fraction: 0.85, reps: 2 },
] as const

/**
 * Lighter sets to do before the working weight: the empty bar, then about
 * 50%, 70% and 85% of the target. Steps too close to the bar or the target
 * are left out, so a light lift gets a short warm-up.
 */
export const warmupSets = (target: number, bar: number, unit: Unit): ReadonlyArray<WarmupSet> => {
  const step = unit === "kg" ? 2.5 : 5
  const sets: Array<WarmupSet> = bar > 0 && target > bar ? [{ weight: bar, reps: 10 }] : []

  for (const { fraction, reps } of RAMP) {
    const weight = Math.round((target * fraction) / step) * step
    const heaviest = sets.at(-1)?.weight ?? 0

    if (weight > Math.max(bar, heaviest) && weight < target) sets.push({ weight, reps })
  }

  return sets
}
