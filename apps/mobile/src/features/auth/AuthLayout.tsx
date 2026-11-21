import type { ReactNode } from "react"
import { ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { BarbellIcon } from "@/components/icons"
import { Display, Field, Text, TextInput } from "@/components/ui"
import { colors } from "@/theme"

interface AuthLayoutProps {
  readonly title: string
  readonly children: ReactNode
}

/** The frame shared by the sign-in and sign-up screens: the app's mark, a title, then the form. */
export function AuthLayout({ title, children }: AuthLayoutProps) {
  const insets = useSafeAreaInsets()

  return (
    <ScrollView
      className="flex-1 bg-ink"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        paddingHorizontal: 16,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
      }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <View className="flex-row items-center gap-3 pb-8">
        <View className="size-14 items-center justify-center rounded-2xl bg-accent">
          <BarbellIcon size={36} color={colors.accentInk} />
        </View>
        <Display className="text-6xl">Gym</Display>
      </View>
      <Display accessibilityRole="header" className="pb-1 text-4xl">
        {title}
      </Display>
      {children}
    </ScrollView>
  )
}

interface ServerFieldProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly testID: string
}

/** The address of the server the account is on. It is the same address the web app is opened at. */
export function ServerField({ value, onChange, testID }: ServerFieldProps) {
  return (
    <Field label="Server address">
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        placeholder="https://gym.example.workers.dev"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        textContentType="URL"
      />
      <Text className="pt-1.5 text-sm text-faint">The address you open the web app at.</Text>
    </Field>
  )
}
