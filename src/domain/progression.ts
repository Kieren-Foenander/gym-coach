/**
 * Built-in progression rules ("double progression"). Pure, so the same logic
 * can be ported to a native app later.
 *
 * - No target weight yet: the heaviest set of the first session becomes the target.
 * - Every prescribed set reaches the top of the rep range at the target weight: add one increment.
 * - Half or more of the prescribed sets miss the bottom of the rep range, two sessions running: drop 10%.
 * - Anything else: hold.
 */

export interface ProgressionTarget {
  readonly sets: number
  readonly repMin: number
  readonly repMax: number
  readonly targetWeight: number | null
  readonly increment: number
  readonly missStreak: number
}

export interface LoggedSet {
  readonly weight: number
  readonly reps: number
}

export type ProgressionDecision =
  | { readonly kind: "none" }
  | { readonly kind: "hold"; readonly missStreak: number }
  | {
      readonly kind: "set" | "increase" | "decrease"
      readonly newWeight: number
      readonly missStreak: number
      readonly reason: string
    }

export const DELOAD_FACTOR = 0.9
export const MISSES_BEFORE_DELOAD = 2

/** Formats a weight without trailing zeros: 62.5, 60, 2.25. */
export const formatWeight = (weight: number): string => String(Math.round(weight * 100) / 100)

export const roundToIncrement = (weight: number, increment: number): number => {
  if (increment <= 0) return Math.round(weight * 100) / 100

  return Math.round((Math.round(weight / increment) * increment) * 100) / 100
}

export const evaluateProgression = (
  target: ProgressionTarget,
  logged: ReadonlyArray<LoggedSet>,
  unit = "kg",
): ProgressionDecision => {
  const show = (weight: number) => `${formatWeight(weight)} ${unit}`

  if (logged.length === 0) return { kind: "none" }

  if (target.targetWeight === null) {
    const heaviest = Math.max(...logged.map((set) => set.weight))

    if (heaviest <= 0) return { kind: "hold", missStreak: 0 }

    return {
      kind: "set",
      newWeight: heaviest,
      missStreak: 0,
      reason: `Starting weight set to ${show(heaviest)} from your first session`,
    }
  }

  const weight = target.targetWeight

  if (target.increment <= 0) return { kind: "hold", missStreak: 0 }

  const prescribed = logged.slice(0, target.sets)
  const atWeight = (set: LoggedSet) => set.weight >= weight - 1e-6

  const completedAll =
    prescribed.length >= target.sets &&
    prescribed.every((set) => atWeight(set) && set.reps >= target.repMax)

  if (completedAll) {
    const newWeight = roundToIncrement(weight + target.increment, 0)

    return {
      kind: "increase",
      newWeight,
      missStreak: 0,
      reason: `Hit ${target.sets}×${target.repMax} at ${show(weight)}, so the target goes up to ${show(newWeight)}`,
    }
  }

  const missed = prescribed.filter((set) => !atWeight(set) || set.reps < target.repMin).length
  const struggled = missed >= Math.ceil(target.sets / 2)

  if (!struggled) return { kind: "hold", missStreak: 0 }

  const missStreak = target.missStreak + 1

  if (missStreak < MISSES_BEFORE_DELOAD) return { kind: "hold", missStreak }

  const newWeight = Math.max(roundToIncrement(weight * DELOAD_FACTOR, target.increment), 0)

  if (newWeight >= weight) return { kind: "hold", missStreak: 0 }

  return {
    kind: "decrease",
    newWeight,
    missStreak: 0,
    reason: `Missed ${target.repMin} reps at ${show(weight)} ${MISSES_BEFORE_DELOAD} sessions in a row, so the target drops to ${show(newWeight)}`,
  }
}

/** Epley estimate of a one-rep max. */
export const estimateOneRepMax = (weight: number, reps: number): number =>
  reps <= 1 ? weight : Math.round(weight * (1 + reps / 30) * 10) / 10

interface TopSet {
  readonly topWeight: number
  readonly topReps: number
}

/** The heaviest top set across sessions; more reps wins a tie on weight. */
export const heaviestSet = <T extends TopSet>(sessions: ReadonlyArray<T>): T | undefined =>
  sessions.reduce<T | undefined>(
    (best, session) =>
      !best || session.topWeight > best.topWeight || (session.topWeight === best.topWeight && session.topReps > best.topReps)
        ? session
        : best,
    undefined,
  )
