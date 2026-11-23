import { useSyncExternalStore } from "react"
import { adjustRest, REST_MINIMISED_KEY, type RestSpan } from "~/domain/rest"
import { cancelRestAlert, scheduleRestAlert } from "~/restAlert"

/**
 * The rest between sets in the web app. It is kept outside the workout page, so opening an
 * exercise's page mid-rest and coming back finds the countdown still running.
 */

export interface Rest extends RestSpan {
  /** The workout the rest belongs to, so another workout's page does not show it. */
  readonly workoutId: number
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
const noRest = () => null

/** The rest running in a workout, or null. */
export const useRest = (workoutId: number) => {
  const current = useSyncExternalStore(subscribe, getRest, noRest)

  return current?.workoutId === workoutId ? current : null
}

/** Ends the rest, whether it was skipped, dismissed or the workout is over. */
export const clearRest = () => {
  cancelRestAlert()
  setRest(null)
}

export const startRest = (workoutId: number, seconds: number) => {
  if (seconds <= 0) {
    clearRest()

    return
  }

  scheduleRestAlert(seconds)
  setRest({ workoutId, endsAt: Date.now() + seconds * 1000, total: seconds })
}

/** Moves the end of the rest by some seconds, either way. Cutting it to nothing ends it. */
export const adjustCurrentRest = (seconds: number) => {
  if (rest === null) return

  const next = adjustRest(rest, seconds, Date.now())

  if (next === null) {
    clearRest()

    return
  }

  scheduleRestAlert((next.endsAt - Date.now()) / 1000)
  setRest(next)
}

/** Schedules the alert again, for after its sound has been switched on or off. */
export const refreshRestAlert = () => {
  if (rest !== null && rest.endsAt > Date.now()) scheduleRestAlert((rest.endsAt - Date.now()) / 1000)
  else cancelRestAlert()
}

/** Whether the timer was last minimised, so the next rest starts the same way. */
export const restMinimised = (): boolean => {
  try {
    return window.localStorage.getItem(REST_MINIMISED_KEY) === "yes"
  } catch {
    return false
  }
}

export const setRestMinimised = (minimised: boolean) => {
  try {
    window.localStorage.setItem(REST_MINIMISED_KEY, minimised ? "yes" : "no")
  } catch {
    // Private browsing can refuse storage. The choice then lasts for this visit only.
  }
}
