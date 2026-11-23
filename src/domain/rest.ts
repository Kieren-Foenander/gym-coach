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
