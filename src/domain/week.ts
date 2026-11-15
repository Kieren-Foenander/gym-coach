interface Session {
  readonly startedAt: number
  readonly volume: number
}

export interface WeekSummary {
  /** Monday to Sunday: whether a workout was finished that day. */
  readonly days: ReadonlyArray<boolean>
  /** 0 for Monday through 6 for Sunday. */
  readonly todayIndex: number
  readonly workouts: number
  readonly volume: number
  /** Weeks in a row with at least one workout. A week still in progress does not break the run. */
  readonly streakWeeks: number
}

const DAY = 86_400_000

/** Midnight on the Monday of the week containing the timestamp, in the device's time zone. */
export const startOfWeek = (timestamp: number): number => {
  const date = new Date(timestamp)

  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))

  return date.getTime()
}

// Two days back from a Monday lands in the week before, whatever daylight saving does.
const previousWeek = (weekStart: number) => startOfWeek(weekStart - 2 * DAY)

const weekdayIndex = (timestamp: number) => (new Date(timestamp).getDay() + 6) % 7

export const summariseWeek = (sessions: ReadonlyArray<Session>, now: number): WeekSummary => {
  const thisWeek = startOfWeek(now)
  const current = sessions.filter((session) => startOfWeek(session.startedAt) === thisWeek)
  const trained = new Set(current.map((session) => weekdayIndex(session.startedAt)))
  const weeks = new Set(sessions.map((session) => startOfWeek(session.startedAt)))

  let cursor = weeks.has(thisWeek) ? thisWeek : previousWeek(thisWeek)
  let streakWeeks = 0

  while (weeks.has(cursor)) {
    streakWeeks += 1
    cursor = previousWeek(cursor)
  }

  return {
    days: [0, 1, 2, 3, 4, 5, 6].map((index) => trained.has(index)),
    todayIndex: weekdayIndex(now),
    workouts: current.length,
    volume: current.reduce((total, session) => total + session.volume, 0),
    streakWeeks,
  }
}
