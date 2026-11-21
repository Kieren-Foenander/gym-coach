import { useSyncExternalStore } from "react"
import { HEALTH_DAILY_VERSION } from "~/domain/health"
import { AppState } from "react-native"
import { describeError } from "@/api/client"
import { call, getSession, onSessionChange } from "@/api/session"
import { queryClient } from "@/data/query-client"
import { storage } from "@/data/storage"
import { healthKitAvailable, readHealthChanges, requestHealthAccess } from "./apple-health"
import { healthBatches } from "./batches"
import type { HealthAnchors } from "./types"

/**
 * Keeps the log in step with Apple Health. Once connected, it syncs when the app opens and
 * whenever it comes back to the front, at most every few minutes. What was synced is saved
 * per account, so another account on the same phone starts from scratch.
 *
 * The anchors are saved only once every request has gone through. A sync that stops halfway
 * sends the same records again next time, and the server adds each one once.
 */

export interface HealthImported {
  readonly measurements: number
  readonly workouts: number
  readonly days: number
}

interface Saved {
  readonly connected: boolean
  readonly anchors: HealthAnchors
  readonly syncedAt: number | null
  /** What the last sync that found anything new brought in. */
  readonly lastImport: HealthImported | null
  /** HEALTH_DAILY_VERSION as of the last sync. Missing from what was saved before there was one. */
  readonly dailyVersion?: number
}

export interface HealthSyncState extends Saved {
  readonly syncing: boolean
  readonly error: string | null
}

const KEY_PREFIX = "gym.health."
const MIN_GAP_MS = 5 * 60_000
const NOTHING: Saved = { connected: false, anchors: {}, syncedAt: null, lastImport: null }

let state: HealthSyncState = { ...NOTHING, syncing: false, error: null }
let loadedFor: string | null = null

/**
 * Goes up whenever someone else signs in or syncing is stopped. A sync started before that
 * stops where it is: sending the rest would put one account's Health data in another's log.
 */
let generation = 0

const listeners = new Set<() => void>()

const userId = () => {
  const session = getSession()

  return session.status === "signedIn" ? session.user.id : null
}

const setState = (next: HealthSyncState) => {
  state = next

  const owner = userId()

  if (owner !== null) {
    const saved: Saved = {
      connected: next.connected,
      anchors: next.anchors,
      syncedAt: next.syncedAt,
      lastImport: next.lastImport,
      dailyVersion: next.dailyVersion,
    }

    storage.set(KEY_PREFIX + owner, JSON.stringify(saved))
  }

  for (const listener of listeners) listener()
}

/** Loads what was saved for whoever is signed in. Answers whether that is someone new. */
const load = (): boolean => {
  const owner = userId()

  if (owner === loadedFor) return false
  loadedFor = owner
  generation += 1

  const text = owner === null ? null : storage.get(KEY_PREFIX + owner)
  let saved = NOTHING

  try {
    if (text !== null) saved = { ...NOTHING, ...JSON.parse(text) }
  } catch {
    saved = NOTHING
  }

  state = { ...saved, syncing: false, error: null }

  for (const listener of listeners) listener()

  return true
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

const getState = () => state

export const useHealthSync = () => useSyncExternalStore(subscribe, getState, getState)

/** Reads whatever is new in Health and sends it. Does nothing if not connected or already syncing. */
export const syncHealth = async (): Promise<void> => {
  if (!state.connected || state.syncing || userId() === null) return

  const started = generation
  const current = () => generation === started && state.connected

  setState({ ...state, syncing: true, error: null })

  try {
    const startedAt = Date.now()

    // Asks only about types iOS has not asked about before, so after the first time no sheet shows.
    // Reading a type that was never asked about would crash, which a new version reading something new could do.
    await requestHealthAccess()

    const changes = await readHealthChanges(state.anchors, state.syncedAt, state.dailyVersion !== HEALTH_DAILY_VERSION)
    let imported: HealthImported = { measurements: 0, workouts: 0, days: 0 }

    for (const batch of healthBatches(changes)) {
      if (!current()) return

      const result = await call("importHealth", batch)

      imported = {
        measurements: imported.measurements + result.measurements,
        workouts: imported.workouts + result.logged,
        days: imported.days + result.days,
      }
    }

    const foundSomething = imported.measurements > 0 || imported.workouts > 0

    if (!current()) return

    setState({
      ...state,
      anchors: changes.anchors,
      syncedAt: startedAt,
      dailyVersion: HEALTH_DAILY_VERSION,
      lastImport: foundSomething ? imported : state.lastImport,
      syncing: false,
    })

    if (foundSomething || imported.days > 0) void queryClient.invalidateQueries()
  } catch (cause) {
    if (current()) setState({ ...state, syncing: false, error: describeError(cause) })
  }
}

/** Asks iOS for access, then brings in the last few months. */
export const connectHealth = async (): Promise<void> => {
  setState({ ...state, error: null })

  try {
    await requestHealthAccess()
  } catch (cause) {
    setState({ ...state, error: describeError(cause) })

    return
  }

  setState({ ...state, connected: true })
  await syncHealth()
}

/** Stops syncing. What was brought in stays in the log; connecting again starts afresh. */
export const disconnectHealth = () => {
  generation += 1
  setState({ ...state, ...NOTHING, syncing: false, error: null })
}

const syncIfDue = () => {
  if (state.syncedAt === null || Date.now() - state.syncedAt > MIN_GAP_MS) void syncHealth()
}

/** Loads what was synced for whoever is signed in, and syncs on launch and whenever the app comes back. */
export const startHealthSync = () => {
  if (!healthKitAvailable()) return () => undefined

  load()
  syncIfDue()

  // This also fires when the profile is saved, so only a different account reloads.
  const stopSession = onSessionChange(() => {
    if (load()) syncIfDue()
  })

  const subscription = AppState.addEventListener("change", (status) => {
    if (status === "active") syncIfDue()
  })

  return () => {
    stopSession()
    subscription.remove()
  }
}
