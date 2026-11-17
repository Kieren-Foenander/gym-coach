import * as Clipboard from "expo-clipboard"
import * as WebBrowser from "expo-web-browser"
import { useState } from "react"
import { Platform, View } from "react-native"
import { call, rememberUser, signOut, useSession } from "@/api/session"
import { Button, Card, ErrorNote, Field, PageTitle, Screen, SectionTitle, Segmented, Text, TextArea, TextInput } from "@/components/ui"
import { useAction } from "@/data/calls"
import { useOutbox } from "@/data/outbox-store"
import { AppleHealthCard } from "@/features/health/AppleHealthCard"
import { useUser } from "@/features/user"

const COACH_STEPS = [
  "In Claude, open Settings, then Connectors, and choose Add custom connector.",
  "Name it Gym and paste the address below.",
  "Sign in when asked, and tap Allow.",
  "In a chat, ask: “Look at my gym log and build me a plan.”",
] as const

export function SettingsScreen() {
  const user = useUser()
  const session = useSession()
  const outbox = useOutbox()
  const { act, pending, error } = useAction()
  const [displayName, setDisplayName] = useState(user.displayName)
  const [unit, setUnit] = useState(user.unit)
  const [goal, setGoal] = useState(user.goal)
  const [trainingContext, setTrainingContext] = useState(user.trainingContext)
  const [saved, setSaved] = useState(false)
  const serverUrl = session.status === "loading" ? "" : session.serverUrl

  const save = () => {
    setSaved(false)

    void act(async () => {
      await call("updateProfile", { displayName, unit, goal, trainingContext })
      rememberUser(await call("getSession", {}))
      setSaved(true)
    })
  }

  return (
    <Screen tabs>
      <PageTitle>Settings</PageTitle>

      <SectionTitle>AI coach</SectionTitle>
      <ConnectCoach address={`${serverUrl}/mcp`} />

      {Platform.OS === "ios" ? (
        <>
          <SectionTitle>Apple Health</SectionTitle>
          <AppleHealthCard />
        </>
      ) : null}

      <SectionTitle>About you</SectionTitle>
      <Card className="gap-4">
        <Field label="Name">
          <TextInput maxLength={80} value={displayName} onChangeText={setDisplayName} />
        </Field>
        <View>
          <Text className="pb-1.5 text-sm text-muted">Weights in</Text>
          <Segmented label="Weights in" options={["kg", "lb"] as const} value={unit} onChange={setUnit} />
          <Text className="pt-1.5 text-sm text-faint">Changing this relabels your numbers. It does not convert them.</Text>
        </View>
        <Field label="Goal">
          <TextArea maxLength={2000} placeholder="Get stronger on the big lifts" value={goal} onChangeText={setGoal} />
        </Field>
        <Field label="What your coach should know">
          <TextArea
            className="min-h-28"
            maxLength={4000}
            placeholder="Days you can train, equipment you have, injuries, exercises you like or avoid"
            value={trainingContext}
            onChangeText={setTrainingContext}
          />
        </Field>
        <ErrorNote message={error} />
        <Button variant="primary" disabled={pending || displayName.trim() === ""} onPress={save}>
          {saved && !pending ? "Saved" : "Save"}
        </Button>
      </Card>

      <SectionTitle>Credits</SectionTitle>
      <Card>
        <Text className="text-sm text-muted">
          The muscles in the exercise demonstrations come from{" "}
          <Text
            accessibilityRole="link"
            className="text-sm font-semibold text-accent"
            onPress={() => void WebBrowser.openBrowserAsync("https://www.z-anatomy.com/")}
          >
            Z-Anatomy
          </Text>
          , the libre 3D atlas of anatomy, which builds on BodyParts3D by the Database Center for Life Science. The demonstration
          videos are shared under the same licence,{" "}
          <Text
            accessibilityRole="link"
            className="text-sm font-semibold text-accent"
            onPress={() => void WebBrowser.openBrowserAsync("https://creativecommons.org/licenses/by-sa/4.0/")}
          >
            CC BY-SA 4.0
          </Text>
          .
        </Text>
      </Card>

      <SectionTitle>Account</SectionTitle>
      <Card className="gap-3">
        <View>
          <Text className="text-muted">Signed in as {user.email}</Text>
          <Text className="text-sm text-faint">{serverUrl}</Text>
        </View>
        {outbox.ops.length > 0 ? (
          <Text className="text-sm text-amber-300">
            {outbox.ops.length === 1 ? "1 change is" : `${outbox.ops.length} changes are`} still waiting to be sent. Signing out now
            loses {outbox.ops.length === 1 ? "it" : "them"}.
          </Text>
        ) : null}
        <Button onPress={() => void signOut()}>Sign out</Button>
      </Card>
    </Screen>
  )
}

function ConnectCoach({ address }: { readonly address: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await Clipboard.setStringAsync(address)
    setCopied(true)
  }

  return (
    <Card>
      <Text className="pb-3">
        Connect this log to Claude so it can read your training, write your plan and adjust your weights. It runs on your Claude
        subscription.
      </Text>
      <View className="gap-2 pb-4">
        {COACH_STEPS.map((step, index) => (
          <View key={step} className="flex-row gap-2">
            <Text className="w-5 font-semibold text-accent">{index + 1}.</Text>
            <Text className="flex-1 text-muted">{step}</Text>
          </View>
        ))}
      </View>
      <View className="flex-row items-center gap-2">
        <View className="flex-1 rounded-2xl bg-ink px-4 py-3.5">
          <Text selectable numberOfLines={1} className="text-sm">
            {address}
          </Text>
        </View>
        <Button onPress={copy}>{copied ? "Copied" : "Copy"}</Button>
      </View>
    </Card>
  )
}
