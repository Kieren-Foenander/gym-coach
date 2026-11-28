import { useQuery } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { useState } from "react"
import { Linking, View } from "react-native"
import { fetchDeployment, useSession } from "@/api/session"
import { BackLink, Button, Card, Chip, PageTitle, Screen, Text } from "@/components/ui"
import type { AppScreenProps } from "@/navigation"
import {
  coachAction,
  coachAddress,
  coachApp,
  coachNote,
  coachSteps,
  COACH_APPS,
  connectorName,
  DEFAULT_COACH_APP,
  isTestStage,
  type CoachAppId,
} from "~/domain/coach-apps"
import { SETTINGS_TITLES } from "~/domain/settings"

/** How to add this log to the user's AI app as a connector. */
export function CoachScreen({ navigation }: AppScreenProps<"SettingsCoach">) {
  const session = useSession()
  const serverUrl = session.status === "loading" ? "" : session.serverUrl

  return (
    <Screen>
      <BackLink label="Settings" onPress={navigation.goBack} />
      <PageTitle>{SETTINGS_TITLES.coach}</PageTitle>
      <ConnectCoach serverUrl={serverUrl} />
    </Screen>
  )
}

function ConnectCoach({ serverUrl }: { readonly serverUrl: string }) {
  const deployment = useQuery({
    queryKey: ["deployment", serverUrl],
    queryFn: () => fetchDeployment(serverUrl),
    enabled: serverUrl !== "",
    staleTime: Infinity,
  })

  // A server too old to answer is the live app, whose name is the plain one. Until it answers, the
  // button waits, so a test copy is never added under the live name.
  const stage = deployment.data?.stage ?? null
  const name = connectorName(stage)
  const address = serverUrl ? coachAddress(serverUrl) : ""
  const named = deployment.isSuccess || deployment.isError
  const [copied, setCopied] = useState(false)
  const [appId, setAppId] = useState<CoachAppId>(DEFAULT_COACH_APP)
  const app = coachApp(appId)
  const action = address && named ? coachAction(app, address, name) : null
  const note = coachNote(app, name)

  const copy = async () => {
    await Clipboard.setStringAsync(address)
    setCopied(true)
  }

  // The system browser, not an in-app one: it has the user's sign-in, and the AI's own app can take the link.
  const runAction = async (next: NonNullable<typeof action>) => {
    if (next.copiesAddress) await copy()
    await Linking.openURL(next.url)
  }

  return (
    <Card>
      <Text className="pb-3">
        Connect this log to the AI app you already pay for, so it can read your training, write your plan and adjust your
        weights. It works with any app that can add a custom MCP server.
      </Text>
      {isTestStage(stage) ? (
        <Text className="mb-4 rounded-2xl bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
          This is a test copy ({stage}), so its connector is called {name}. It can sit next to the live Gym one: ask your AI
          to use {name} by name, and remove {name} in the AI app when you are done.
        </Text>
      ) : null}
      <View accessibilityLabel="Your AI app" className="flex-row flex-wrap gap-2 pb-4">
        {COACH_APPS.map((option) => (
          <Chip key={option.id} label={option.name} selected={option.id === appId} onPress={() => setAppId(option.id)} />
        ))}
      </View>
      <View className="gap-2 pb-4">
        {coachSteps(app, name).map((step, index) => (
          <View key={step} className="flex-row gap-2">
            <Text className="w-5 font-semibold text-accent">{index + 1}.</Text>
            <Text className="flex-1 text-muted">{step}</Text>
          </View>
        ))}
      </View>
      {note ? <Text className="pb-4 text-sm text-faint">{note}</Text> : null}
      {action ? (
        <Button variant="primary" className="mb-3" onPress={() => void runAction(action)}>
          {action.label}
        </Button>
      ) : null}
      <View className="flex-row items-center gap-2">
        <View className="flex-1 rounded-2xl bg-ink px-4 py-3.5">
          <Text selectable numberOfLines={1} className="text-sm">
            {address}
          </Text>
        </View>
        <Button onPress={copy} disabled={!address}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </View>
    </Card>
  )
}
