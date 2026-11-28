import { useState } from "react"
import { View } from "react-native"
import { call, rememberUser } from "@/api/session"
import { BackLink, Button, Card, ErrorNote, Field, PageTitle, Screen, Segmented, Text, TextArea, TextInput } from "@/components/ui"
import { useAction } from "@/data/calls"
import { useUser } from "@/features/user"
import type { AppScreenProps } from "@/navigation"
import { SETTINGS_TITLES } from "~/domain/settings"
import { testIds } from "~/domain/test-ids"

/** The name, the unit, and what the AI coach should know. */
export function ProfileScreen({ navigation }: AppScreenProps<"SettingsProfile">) {
  const user = useUser()
  const { act, pending, error } = useAction()
  const [displayName, setDisplayName] = useState(user.displayName)
  const [unit, setUnit] = useState(user.unit)
  const [goal, setGoal] = useState(user.goal)
  const [trainingContext, setTrainingContext] = useState(user.trainingContext)
  const [saved, setSaved] = useState(false)

  const save = () => {
    setSaved(false)

    void act(async () => {
      await call("updateProfile", { displayName, unit, goal, trainingContext })
      rememberUser(await call("getSession", {}))
      setSaved(true)
    })
  }

  return (
    <Screen>
      <BackLink label="Settings" onPress={navigation.goBack} />
      <PageTitle>{SETTINGS_TITLES.profile}</PageTitle>

      <Card className="gap-4">
        <Field label="Name">
          <TextInput testID={testIds.settings.displayName} maxLength={80} value={displayName} onChangeText={setDisplayName} />
        </Field>
        <View>
          <Text className="pb-1.5 text-sm text-muted">Weights in</Text>
          <Segmented label="Weights in" options={["kg", "lb"] as const} value={unit} onChange={setUnit} />
          <Text className="pt-1.5 text-sm text-faint">Changing this relabels your numbers. It does not convert them.</Text>
        </View>
        <Field label="Goal">
          <TextArea
            testID={testIds.settings.goal}
            maxLength={2000}
            placeholder="Get stronger on the big lifts"
            value={goal}
            onChangeText={setGoal}
          />
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
        <Button
          testID={testIds.settings.saveProfile}
          variant="primary"
          disabled={pending || displayName.trim() === ""}
          onPress={save}
        >
          {saved && !pending ? "Saved" : "Save"}
        </Button>
      </Card>
    </Screen>
  )
}
