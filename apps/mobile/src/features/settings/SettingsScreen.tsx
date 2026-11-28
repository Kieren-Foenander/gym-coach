import { useNavigation } from "@react-navigation/native"
import { Fragment } from "react"
import { Platform, Pressable, View } from "react-native"
import { signOut, useSession } from "@/api/session"
import { ChevronIcon } from "@/components/icons"
import { Button, Card, Divider, PageTitle, Screen, SectionTitle, Text } from "@/components/ui"
import { useOutbox } from "@/data/outbox-store"
import { useHealthSync } from "@/features/health/health-sync"
import { useUser } from "@/features/user"
import type { AppStackParams } from "@/navigation"
import { colors } from "@/theme"
import { coachSummary, healthSummary, profileSummary, SETTINGS_TITLES, streakSummary, type SettingsPage } from "~/domain/settings"
import { testIds } from "~/domain/test-ids"

/** The page each row of the menu opens. */
const SCREENS = {
  profile: "SettingsProfile",
  streaks: "SettingsStreaks",
  coach: "SettingsCoach",
  health: "SettingsHealth",
} as const satisfies Record<SettingsPage, keyof AppStackParams>

interface Row {
  readonly page: SettingsPage
  readonly detail: string
}

/** A short menu: each row opens a page of its own and says what is set there now. */
export function SettingsScreen() {
  const user = useUser()
  const session = useSession()
  const outbox = useOutbox()
  const health = useHealthSync()
  const serverUrl = session.status === "loading" ? "" : session.serverUrl

  const you: ReadonlyArray<Row> = [
    { page: "profile", detail: profileSummary(user) },
    { page: "streaks", detail: streakSummary(user) },
  ]

  const connections: ReadonlyArray<Row> = [
    { page: "coach", detail: coachSummary() },
    ...(Platform.OS === "ios" ? [{ page: "health", detail: healthSummary(health.connected) } as const] : []),
  ]

  return (
    <Screen tabs>
      <PageTitle>Settings</PageTitle>

      <SectionTitle>You</SectionTitle>
      <Menu rows={you} />

      <SectionTitle>Connections</SectionTitle>
      <Menu rows={connections} />

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
        <Button testID={testIds.settings.signOut} onPress={() => void signOut()}>
          Sign out
        </Button>
      </Card>
    </Screen>
  )
}

function Menu({ rows }: { readonly rows: ReadonlyArray<Row> }) {
  const navigation = useNavigation()

  return (
    <Card className="py-1">
      {rows.map((row, index) => (
        <Fragment key={row.page}>
          {index > 0 ? <Divider /> : null}
          <Pressable
            testID={testIds.settings.page(row.page)}
            accessibilityRole="button"
            onPress={() => navigation.navigate(SCREENS[row.page])}
            className="min-h-16 flex-row items-center justify-between gap-3 py-2"
          >
            <View className="flex-1">
              <Text className="font-semibold">{SETTINGS_TITLES[row.page]}</Text>
              <Text numberOfLines={1} className="text-sm text-muted">
                {row.detail}
              </Text>
            </View>
            <ChevronIcon color={colors.faint} />
          </Pressable>
        </Fragment>
      ))}
    </Card>
  )
}
