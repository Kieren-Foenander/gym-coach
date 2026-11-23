import { catalogByName, type Equipment } from "./catalog"
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

/**
 * How an exercise is loaded, which decides what its warm-up looks like:
 * - bar: plates on a bar, warmed up from the empty bar;
 * - stack: a machine or cable, warmed up with lighter settings and no bar;
 * - dumbbells: dumbbells or kettlebells, warmed up with lighter ones;
 * - none: bodyweight or bands, which need no weighted warm-up.
 */
export type LoadKind = "bar" | "stack" | "dumbbells" | "none"

const LOAD_KINDS: Record<Equipment, LoadKind> = {
  Barbell: "bar",
  "EZ bar": "bar",
  "Trap bar": "bar",
  "Smith machine": "bar",
  Machine: "stack",
  Cable: "stack",
  Plate: "stack",
  Other: "stack",
  Dumbbell: "dumbbells",
  Kettlebell: "dumbbells",
  Bodyweight: "none",
  Band: "none",
}

/** How an exercise is loaded. One the library does not know is treated as a barbell lift, which shows the most. */
export const loadKindFor = (exerciseName: string): LoadKind => {
  const entry = catalogByName(exerciseName)

  return entry ? LOAD_KINDS[entry.equipment] : "bar"
}

/** Lighter sets on the same machine or dumbbells: no empty bar to start from, so the ramp starts lower and does more reps. */
const LIGHT_RAMP = [
  { fraction: 0.4, reps: 10 },
  { fraction: 0.6, reps: 6 },
  { fraction: 0.8, reps: 3 },
] as const

/** The warm-up for an exercise loaded the given way. The bar weight only counts for a bar. */
export const warmupFor = (kind: LoadKind, target: number, bar: number, unit: Unit): ReadonlyArray<WarmupSet> => {
  if (kind === "none") return []

  if (kind === "bar") return warmupSets(target, bar, unit)

  // Stacks and dumbbell racks jump in bigger steps than plates do.
  const step = kind === "stack" ? (unit === "kg" ? 5 : 10) : unit === "kg" ? 2 : 5
  const sets: Array<WarmupSet> = []

  for (const { fraction, reps } of LIGHT_RAMP) {
    const weight = Math.round((target * fraction) / step) * step

    if (weight > (sets.at(-1)?.weight ?? 0) && weight < target) sets.push({ weight, reps })
  }

  return sets
}
