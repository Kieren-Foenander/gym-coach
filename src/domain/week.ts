/** Midnight at the start of the day containing the timestamp, in the device's time zone. */
export const startOfDay = (timestamp: number): number => {
  const date = new Date(timestamp)

  date.setHours(0, 0, 0, 0)

  return date.getTime()
}

/** Midnight on the Monday of the week containing the timestamp, in the device's time zone. */
export const startOfWeek = (timestamp: number): number => {
  const date = new Date(timestamp)

  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))

  return date.getTime()
}

/** 0 for Monday through 6 for Sunday. */
export const weekdayIndex = (timestamp: number) => (new Date(timestamp).getDay() + 6) % 7

/** A month as it appears on a calendar: one row per week, Monday first. */
export interface MonthGrid {
  /** Midnight on the first of the month. */
  readonly start: number
  /** Each week's Monday and its seven days, with null for days outside the month. */
  readonly weeks: ReadonlyArray<{ readonly monday: number; readonly days: ReadonlyArray<number | null> }>
}

/** The calendar for the month containing the timestamp, with each day at midnight. */
export const monthGrid = (timestamp: number): MonthGrid => {
  const first = new Date(timestamp)

  first.setHours(0, 0, 0, 0)
  first.setDate(1)

  const month = first.getMonth()
  const weeks: Array<{ monday: number; days: Array<number | null> }> = []
  const day = new Date(first)
  let week: { monday: number; days: Array<number | null> } | null = null

  while (day.getMonth() === month) {
    const index = weekdayIndex(day.getTime())

    if (week === null || index === 0) {
      week = { monday: startOfWeek(day.getTime()), days: Array.from({ length: 7 }, () => null) }
      weeks.push(week)
    }

    week.days[index] = day.getTime()
    day.setDate(day.getDate() + 1)
  }

  return { start: first.getTime(), weeks }
}

/** Midnight on the first of the month `offset` months from the one containing the timestamp. */
export const shiftMonth = (timestamp: number, offset: number): number => {
  const date = new Date(timestamp)

  date.setHours(0, 0, 0, 0)
  date.setDate(1)
  date.setMonth(date.getMonth() + offset)

  return date.getTime()
}

/** Groups items by the day they started on, keyed by that day's midnight. */
export const byDay = <T extends { readonly startedAt: number }>(items: ReadonlyArray<T>): ReadonlyMap<number, ReadonlyArray<T>> => {
  const days = new Map<number, Array<T>>()

  for (const item of items) {
    const key = startOfDay(item.startedAt)
    const day = days.get(key)

    if (day) day.push(item)
    else days.set(key, [item])
  }

  return days
}

/** How many of the items started in the month beginning at `monthStart`. */
export const countInMonth = (items: ReadonlyArray<{ readonly startedAt: number }>, monthStart: number): number =>
  items.filter((item) => shiftMonth(item.startedAt, 0) === monthStart).length
