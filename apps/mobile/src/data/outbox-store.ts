import { onlineManager } from "@tanstack/react-query"
import * as Crypto from "expo-crypto"
import { useSyncExternalStore } from "react"
import { AppState } from "react-native"
import type { WorkoutDetail } from "~/server/repo"
import { isApiError } from "@/api/client"
import { call, getSession, onSessionChange } from "@/api/session"
import { workoutKey } from "@/data/calls"
import { withChangedSet, withEditedSet, withoutOp, withoutSet, withSentSet, type PendingOp, type SetValues } from "./outbox"
import { queryClient } from "./query-client"
import { storage } from "./storage"

/**
 * The queue behind outbox.ts: it is saved on the phone, sent one item at a time in the
 * order things were logged, and tried again whenever the connection or the app comes back.
 */

interface OutboxState {
  readonly ops: ReadonlyArray<PendingOp>
  /** The item being sent right now. It cannot be withdrawn until the server answers. */
  readonly sending: string | null
  /** Why the last item the server refused was dropped. */
  readonly problem: string | null
}

interface Saved {
  readonly userId: string
  readonly ops: ReadonlyArray<PendingOp>
}

const STORAGE_KEY = "gym.outbox"
const RETRY_MS = 15_000

let state: OutboxState = { ops: [], sending: null, problem: null }
let flushing = false

// The id the server gave each set sent this session, by the key it waited under, so a form opened on a
// waiting set can still save once the set has been sent.
const sentIds = new Map<string, number>()

/** The id the server gave a set that waited under this key, once it has been sent. */
export const sentSetId = (pendingKey: string): number | null => sentIds.get(pendingKey) ?? null

const listeners = new Set<() => void>()

const currentUserId = () => {
  const session = getSession()

  return session.status === "signedIn" ? session.user.id : null
}

const setState = (next: OutboxState) => {
  const opsChanged = next.ops !== state.ops

  state = next

  const userId = currentUserId()

  if (opsChanged && userId !== null) {
    storage.set(STORAGE_KEY, JSON.stringify({ userId, ops: next.ops } satisfies Saved))
  }

  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

const getState = () => state

export const useOutbox = () => useSyncExternalStore(subscribe, getState, getState)

/** What is waiting right now, for code that has just waited on something and cannot rely on what a screen last drew. */
export const pendingOps = (): ReadonlyArray<PendingOp> => state.ops

export const dismissOutboxProblem = () => setState({ ...state, problem: null })

/** Whether a failure means "try again later" rather than "the server will never accept this". */
const worthRetrying = (cause: unknown) => !isApiError(cause) || cause.code !== "invalid" && cause.code !== "not_found"

const send = async (op: PendingOp) => {
  if (op.kind === "logSet") {
    const setId = await call("logSet", {
      workoutId: op.workoutId,
      exerciseId: op.exerciseId,
      set: op.set,
      clientKey: op.key,
    })

    sentIds.set(op.key, setId)

    queryClient.setQueryData<WorkoutDetail>(workoutKey(op.workoutId), (detail) =>
      detail ? withSentSet(detail, op, setId) : detail,
    )

    return
  }

  if (op.kind === "updateSet") {
    await call("updateSet", { setId: op.setId, set: op.set })
    queryClient.setQueryData<WorkoutDetail>(workoutKey(op.workoutId), (detail) => (detail ? withChangedSet(detail, op) : detail))

    return
  }

  await call("deleteSet", { setId: op.setId })
  queryClient.setQueryData<WorkoutDetail>(workoutKey(op.workoutId), (detail) =>
    detail ? withoutSet(detail, op.setId) : detail,
  )
}

/** Sends everything that is waiting, oldest first. Stops at the first item that cannot be sent yet. */
export const flushOutbox = async (): Promise<void> => {
  if (flushing) return

  flushing = true

  let sentAny = false

  try {
    for (let op = state.ops[0]; op !== undefined; op = state.ops[0]) {
      setState({ ...state, sending: op.key })

      try {
        await send(op)
        sentAny = true
        setState({ ...state, ops: withoutOp(state.ops, op.key), sending: null })
      } catch (cause) {
        if (worthRetrying(cause)) break

        // The server will never take this one, so holding on to it would block everything behind it.
        setState({
          ops: withoutOp(state.ops, op.key),
          sending: null,
          problem: cause instanceof Error ? cause.message : "A set could not be saved",
        })
      }
    }
  } finally {
    flushing = false

    if (state.sending !== null) setState({ ...state, sending: null })
  }

  // Totals, personal bests and "last time" all follow from what was just sent.
  if (sentAny) void queryClient.invalidateQueries()
}

export interface NewSet {
  readonly workoutId: number
  readonly exerciseId: number
  readonly set: SetValues
}

/** Logs a set. It shows at once and is sent as soon as there is a connection. */
export const logSet = (entry: NewSet) => {
  setState({ ...state, ops: [...state.ops, { kind: "logSet", key: Crypto.randomUUID(), ...entry }] })
  void flushOutbox()
}

/** Withdraws a set that has not been sent yet. Does nothing while it is on its way: it is then removed like any other set. */
export const withdrawSet = (key: string) => {
  if (state.sending === key) return

  setState({ ...state, ops: withoutOp(state.ops, key) })
}

/** Removes a set the server already has. It disappears at once and the server is told as soon as possible. */
export const removeSet = (workoutId: number, setId: number) => {
  setState({ ...state, ops: [...state.ops, { kind: "deleteSet", key: Crypto.randomUUID(), workoutId, setId }] })
  void flushOutbox()
}

/**
 * Changes a set's values. It shows at once and the server is told as soon as possible.
 * Returns false when the set is being sent at this moment, so it cannot be changed yet.
 */
export const editSet = (
  target: { readonly workoutId: number; readonly setId: number; readonly pendingKey: string | null },
  values: SetValues,
): boolean => {
  const ops = withEditedSet(state.ops, target, values, state.sending, Crypto.randomUUID(), sentIds)

  if (ops === null) return false

  setState({ ...state, ops })
  void flushOutbox()

  return true
}

/** Drops everything waiting for a workout, for when the workout itself is discarded. */
export const forgetWorkout = (workoutId: number) =>
  setState({ ...state, ops: state.ops.filter((op) => op.workoutId !== workoutId) })

const load = () => {
  const userId = currentUserId()
  const raw = storage.get(STORAGE_KEY)

  if (userId === null) {
    state = { ops: [], sending: null, problem: null }

    return
  }

  try {
    const saved: Saved | null = raw === null ? null : JSON.parse(raw)

    // Sets logged under another account are not this account's to send.
    state = { ops: saved !== null && saved.userId === userId ? saved.ops : [], sending: null, problem: null }
  } catch {
    state = { ops: [], sending: null, problem: null }
  }

  for (const listener of listeners) listener()
}

/** Loads the saved queue and keeps trying to send it for as long as the app runs. */
export const startOutbox = () => {
  load()
  void flushOutbox()

  const stops = [
    onSessionChange(() => {
      load()
      void flushOutbox()
    }),
    onlineManager.subscribe((online) => {
      if (online) void flushOutbox()
    }),
  ]

  const appState = AppState.addEventListener("change", (status) => {
    if (status === "active") void flushOutbox()
  })

  const timer = setInterval(() => {
    if (state.ops.length > 0) void flushOutbox()
  }, RETRY_MS)

  return () => {
    for (const stop of stops) stop()

    appState.remove()
    clearInterval(timer)
  }
}
