/**
 * Calendar days as YYYY-MM-DD, the way Health's daily numbers and the food log keep them: the
 * day on the user's device. Worked in UTC, so a clock change never moves a day.
 */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Whether text is a day that exists, as YYYY-MM-DD. Dates parse 30 February as 2 March, so it must come back the same. */
export const isDay = (text: string): boolean => {
  if (!DAY_PATTERN.test(text)) return false

  const time = Date.parse(`${text}T00:00:00Z`)

  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === text
}

/** The day `count` days after `day` (or before, when negative). Worked in UTC, so it never trips on a clock change. */
export const shiftDay = (day: string, count: number): string => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)

  return date.toISOString().slice(0, 10)
}

/** How many days from one day to another; negative when `to` comes first. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** Every day from `from` to `to`, both included, oldest first. */
export const daysFrom = (from: string, to: string): ReadonlyArray<string> =>
  Array.from({ length: Math.max(0, daysBetween(from, to) + 1) }, (_, index) => shiftDay(from, index))

/** A span of days, both ends included. */
export interface DayRange {
  readonly from: string
  readonly to: string
}

/**
 * The days that may be "today" somewhere when it is `time` in UTC. A server, which does not know the
 * user's time zone, asks for this span and leaves the device to pick its own day out of it.
 */
export const daysAround = (time: number): DayRange => {
  const utc = new Date(time).toISOString().slice(0, 10)

  return { from: shiftDay(utc, -1), to: shiftDay(utc, 1) }
}
