import { BackLink, PageTitle, Screen } from "@/components/ui"
import { AppleHealthCard } from "@/features/health/AppleHealthCard"
import type { AppScreenProps } from "@/navigation"
import { SETTINGS_TITLES } from "~/domain/settings"

/** Connecting Apple Health, and what it last brought in. The menu lists it on an iPhone only. */
export function HealthScreen({ navigation }: AppScreenProps<"SettingsHealth">) {
  return (
    <Screen>
      <BackLink label="Settings" onPress={navigation.goBack} />
      <PageTitle>{SETTINGS_TITLES.health}</PageTitle>
      <AppleHealthCard />
    </Screen>
  )
}
