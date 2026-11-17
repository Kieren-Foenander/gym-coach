import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister"
import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query"
import * as Network from "expo-network"
import { AppState } from "react-native"
import { isApiError } from "@/api/client"
import { storage } from "./storage"

const DAY_MS = 86_400_000

/** How long a screen's data is kept on the phone for reading with no signal. */
export const CACHE_MAX_AGE_MS = 30 * DAY_MS

/**
 * Everything read from the server goes through this cache. A screen shows what it has
 * straight away, then refreshes it; with no signal it keeps showing what it has.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: CACHE_MAX_AGE_MS,
      // Only a missing connection is worth another try. The server saying no will not change.
      retry: (failures, error) => isApiError(error) && error.code === "network" && failures < 2,
    },
  },
})

/** Writes the cache to the phone, so the last thing each screen showed survives closing the app. */
export const queryPersister = createAsyncStoragePersister({
  key: "gym.queries",
  throttleTime: 1000,
  storage: { getItem: storage.getAsync, setItem: storage.setAsync, removeItem: storage.removeAsync },
})

/** Tells the cache when the phone is online and when the app is in front, so it knows when to refresh. */
export const watchConnectionAndFocus = () => {
  onlineManager.setEventListener((setOnline) => {
    const subscription = Network.addNetworkStateListener((state) => {
      // "Reachable" is unknown for a moment after launch. Assume a connection until told otherwise.
      setOnline(state.isConnected !== false && state.isInternetReachable !== false)
    })

    return () => subscription.remove()
  })

  const subscription = AppState.addEventListener("change", (status) => {
    focusManager.setFocused(status === "active")
  })

  return () => subscription.remove()
}
