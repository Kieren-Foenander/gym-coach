import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import type { CallName } from "~/domain/calls"
import type { CallInput } from "~/server/calls"
import { describeError } from "@/api/client"
import { call } from "@/api/session"

/** Where a call's answer is kept in the cache: its name and exactly what it was asked. */
export const callKey = <K extends CallName>(name: K, input: CallInput<K>) => [name, input] as const

export const workoutKey = (workoutId: number) => callKey("getWorkout", { workoutId })

/**
 * Reads something from the server. The last answer shows straight away, including with
 * no signal, and is refreshed in the background.
 */
export const useCall = <K extends CallName>(name: K, input: CallInput<K>) =>
  useQuery({ queryKey: callKey(name, input), queryFn: () => call(name, input) })

/**
 * Runs something that changes data, then refreshes every screen that is showing.
 * Tracks whether it is running and the last error so a screen can show both.
 */
export const useAction = () => {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const act = async (work: () => Promise<void>) => {
    setPending(true)
    setError(null)

    try {
      await work()
      void queryClient.invalidateQueries()
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setPending(false)
    }
  }

  return { act, pending, error }
}
