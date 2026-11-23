/** How far each tap of +30s or -30s moves the end of a rest. */
export const REST_STEP_SECONDS = 30

export interface RestSpan {
  /** When the rest runs out, in milliseconds. */
  readonly endsAt: number
  /** The whole length in seconds, for the progress bar. */
  readonly total: number
}

/**
 * Moves the end of a rest by some seconds, later for a positive number and sooner for a
 * negative one. Null when cutting it leaves no rest, which ends it as if it were skipped.
 */
export const adjustRest = <R extends RestSpan>(rest: R, seconds: number, now: number): R | null => {
  const endsAt = rest.endsAt + seconds * 1000

  if (endsAt <= now) return null

  return { ...rest, endsAt, total: Math.max(1, rest.total + seconds) }
}

/** How much of the rest has gone, from 0 when it starts to 1 when it runs out. The minimised bar fills up by it. */
export const restElapsed = (rest: RestSpan, now: number): number =>
  Math.min(1, Math.max(0, 1 - (rest.endsAt - now) / (rest.total * 1000)))

/** Where both apps remember whether the rest timer was last minimised, so the next rest opens the same way. */
export const REST_MINIMISED_KEY = "gym.restMinimised"
