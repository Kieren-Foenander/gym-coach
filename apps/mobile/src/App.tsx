import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { useFonts } from "expo-font"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { useEffect } from "react"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { restoreSession, useSession } from "@/api/session"
import { startOutbox } from "@/data/outbox-store"
import { CACHE_MAX_AGE_MS, queryClient, queryPersister, watchConnectionAndFocus } from "@/data/query-client"
import { startRestAlerts } from "@/features/workout/rest-alert"
import { Navigation } from "@/navigation"

void SplashScreen.preventAutoHideAsync()

// Bump this when the shape of what the server answers changes, so screens cached by an older build are dropped.
const CACHE_VERSION = "1"

export default function App() {
  const [fontsLoaded] = useFonts({
    BarlowCondensed_600SemiBold: require("@expo-google-fonts/barlow-condensed/600SemiBold/BarlowCondensed_600SemiBold.ttf"),
    BarlowCondensed_700Bold: require("@expo-google-fonts/barlow-condensed/700Bold/BarlowCondensed_700Bold.ttf"),
  })

  const session = useSession()
  const ready = fontsLoaded && session.status !== "loading"

  useEffect(() => {
    void restoreSession()

    const stops = [watchConnectionAndFocus(), startOutbox(), startRestAlerts()]

    return () => {
      for (const stop of stops) stop()
    }
  }, [])

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync()
  }, [ready])

  if (!ready) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister: queryPersister, maxAge: CACHE_MAX_AGE_MS, buster: CACHE_VERSION }}
        >
          <StatusBar style="light" />
          <Navigation />
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
