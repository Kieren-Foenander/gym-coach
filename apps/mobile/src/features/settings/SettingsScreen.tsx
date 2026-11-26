import { useQuery } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { useState } from "react"
import { Linking, Platform, View } from "react-native"
import { call, fetchDeployment, rememberUser, signOut, useSession } from "@/api/session"
import {
  Button,
  Card,
  Chip,
  Display,
  ErrorNote,
  Eyebrow,
  Field,
  PageTitle,
  Screen,
  SectionTitle,
  Segmented,
  Text,
  TextArea,
  TextInput,
} from "@/components/ui"
import { useAction } from "@/data/calls"
import { useOutbox } from "@/data/outbox-store"
import { AppleHealthCard } from "@/features/health/AppleHealthCard"
import { useUser } from "@/features/user"
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
import {
  ACTIVITY_HINTS,
  ACTIVITY_LABELS,
  activeGoals,
  describeGoal,
  FREQUENCIES,
  isFrequency,
  MAX_STREAK_GOALS,
  normaliseGoal,
  RING_COLORS,
  ringFor,
  STREAK_ACTIVITIES,
  suggestNextGoal,
  type StreakGoal,
} from "~/domain/streaks"
import { GOAL_SLOTS, testIds } from "~/domain/test-ids"

const SLOT_NAMES = ["Main goal", "Second goal", "Third goal"] as const

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
      <ConnectCoach serverUrl={serverUrl} />

      {Platform.OS === "ios" ? (
        <>
          <SectionTitle>Apple Health</SectionTitle>
          <AppleHealthCard />
        </>
      ) : null}

      <SectionTitle>Streak goals</SectionTitle>
      <StreakGoalsCard saved={activeGoals(user.streakGoals)} />

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

/** What the calendar's streaks count and how often: one goal, or two with the first leading. */
function StreakGoalsCard({ saved }: { readonly saved: ReadonlyArray<StreakGoal> }) {
  const { act, pending, error } = useAction()
  const [goals, setGoals] = useState(saved)
  const [done, setDone] = useState(false)
  const first = goals[0]

  const edit = (next: ReadonlyArray<StreakGoal>) => {
    setGoals(next)
    setDone(false)
  }

  const change = (index: number, patch: Partial<StreakGoal>) =>
    edit(goals.map((goal, at) => (at === index ? normaliseGoal({ ...goal, ...patch }) : goal)))

  const save = () =>
    void act(async () => {
      await call("updateProfile", { streakGoals: goals })
      rememberUser(await call("getSession", {}))
      setDone(true)
    })

  return (
    <Card className="gap-5">
      <Text className="text-muted">
        Your streak counts what you set here. A walk on its own only counts toward a goal for walks or for anything. Each goal
        rings the days it counts on the calendar in its own colour.
      </Text>
      {goals.map((goal, index) => (
        <View key={index} testID={testIds.settings.streakGoal(GOAL_SLOTS[index] ?? "third")} className="gap-3">
          <View className="flex-row items-center justify-between gap-3">
            <View className="size-6 rounded-full" style={{ borderWidth: 3, borderColor: RING_COLORS[ringFor(goal.activity)] }} />
            <View className="flex-1">
              <Eyebrow className="text-xs text-faint">{SLOT_NAMES[index] ?? "Goal"}</Eyebrow>
              <Display className="text-2xl">{describeGoal(goal)}</Display>
            </View>
            {index > 0 ? (
              <Button onPress={() => edit(goals.filter((_, at) => at !== index))}>Remove</Button>
            ) : null}
          </View>
          <View>
            <Text className="pb-1.5 text-sm text-muted">What counts</Text>
            <View accessibilityLabel="What counts" className="flex-row flex-wrap gap-2">
              {STREAK_ACTIVITIES.map((activity) => (
                <Chip
                  key={activity}
                  label={ACTIVITY_LABELS[activity]}
                  selected={goal.activity === activity}
                  onPress={() => change(index, { activity })}
                />
              ))}
            </View>
            <Text className="pt-1.5 text-sm text-faint">{ACTIVITY_HINTS[goal.activity]}</Text>
          </View>
          <View>
            <Text className="pb-1.5 text-sm text-muted">How often</Text>
            <View accessibilityLabel="How often" className="flex-row flex-wrap gap-2">
              {FREQUENCIES.map((frequency) => (
                <Chip
                  key={frequency.label}
                  label={frequency.label}
                  selected={isFrequency(goal, frequency)}
                  onPress={() => change(index, { period: frequency.period, target: frequency.target })}
                />
              ))}
            </View>
          </View>
        </View>
      ))}
      {goals.length < MAX_STREAK_GOALS && first ? (
        <Button testID={testIds.settings.addStreakGoal} onPress={() => edit([...goals, suggestNextGoal(goals)])}>
          {goals.length === 1 ? "Add a second goal" : "Add a third goal"}
        </Button>
      ) : null}
      <ErrorNote message={error} />
      <Button variant="primary" disabled={pending} onPress={save}>
        {done && !pending ? "Saved" : "Save goals"}
      </Button>
    </Card>
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
