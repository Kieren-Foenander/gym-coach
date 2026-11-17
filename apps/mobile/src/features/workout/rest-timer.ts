import { useSyncExternalStore } from "react"
import { endRestActivity, showRestActivity } from "./rest-activity"
import { cancelRestAlert, scheduleRestAlert } from "./rest-alert"

/**
 * The rest between sets. It is kept outside any one screen, so looking up an exercise
 * mid-rest and coming back finds the countdown still running.
 */

export interface Rest {
  readonly startedAt: number
  readonly endsAt: number
  /** The whole length in seconds, for the progress bar. */
  readonly total: number
  /** What the rest follows, such as the exercise's name. */
  readonly title: string
}

let rest: Rest | null = null

const listeners = new Set<() => void>()

const setRest = (next: Rest | null) => {
  rest = next

  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

const getRest = () => rest

export const useRest = () => useSyncExternalStore(subscribe, getRest, getRest)

const announce = (next: Rest) => {
  void scheduleRestAlert((next.endsAt - Date.now()) / 1000)
  showRestActivity({ title: next.title, startedAt: next.startedAt, endsAt: next.endsAt })
}

/** Ends the rest, whether it was skipped, dismissed or the workout is over. */
export const clearRest = () => {
  cancelRestAlert()
  endRestActivity()
  setRest(null)
}

export const startRest = (seconds: number, title: string) => {
  if (seconds <= 0) {
    clearRest()

    return
  }

  const startedAt = Date.now()
  const next = { startedAt, endsAt: startedAt + seconds * 1000, total: seconds, title }

  setRest(next)
  announce(next)
}

export const extendRest = (seconds: number) => {
  if (rest === null) return

  const next = { ...rest, endsAt: rest.endsAt + seconds * 1000, total: rest.total + seconds }

  setRest(next)
  announce(next)
}

/** Schedules the alert again, for after its sound has been switched on or off. */
export const refreshRestAlert = () => {
  if (rest !== null && rest.endsAt > Date.now()) void scheduleRestAlert((rest.endsAt - Date.now()) / 1000)
}
