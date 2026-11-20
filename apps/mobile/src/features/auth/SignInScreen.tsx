import { useState } from "react"
import { View } from "react-native"
import { testIds } from "~/domain/test-ids"
import { describeError } from "@/api/client"
import { signIn, useSession } from "@/api/session"
import { Button, ErrorNote, Field, Text, TextInput } from "@/components/ui"
import type { AuthScreenProps } from "@/navigation"
import { END_TO_END_BUILD } from "@/lib/build"
import { AuthLayout, ServerField } from "./AuthLayout"

// iOS offers to save the password of fields marked as a sign-in, in a sheet over the app that a test can't
// reliably clear, so a build for the end-to-end tests leaves them unmarked. Every other build fills them in.
const AUTOFILL = !END_TO_END_BUILD

export function SignInScreen({ navigation }: AuthScreenProps<"SignIn">) {
  const session = useSession()
  const [serverUrl, setServerUrl] = useState(session.status === "signedOut" ? session.serverUrl : "")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async () => {
    setPending(true)
    setError(null)

    try {
      await signIn({ serverUrl, email, password })
    } catch (cause) {
      setError(describeError(cause))
      setPending(false)
    }
  }

  return (
    <AuthLayout title="Welcome back">
      <Text className="pb-6 text-muted">Sign in to your training log.</Text>
      <View className="gap-4">
        <Field label="Email">
          <TextInput
            testID={testIds.login.email}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={AUTOFILL ? "email" : "off"}
            keyboardType="email-address"
            textContentType={AUTOFILL ? "username" : "none"}
            returnKeyType="next"
          />
        </Field>
        <Field label="Password">
          <TextInput
            testID={testIds.login.password}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={AUTOFILL ? "current-password" : "off"}
            textContentType={AUTOFILL ? "password" : "none"}
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </Field>
        <ServerField value={serverUrl} onChange={setServerUrl} testID={testIds.login.server} />
        <ErrorNote message={error} />
        <Button
          testID={testIds.login.submit}
          variant="primary"
          disabled={pending || email === "" || password === "" || serverUrl === ""}
          onPress={submit}
        >
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </View>
      <View className="flex-row justify-center gap-1 pt-6">
        <Text className="text-muted">New here?</Text>
        <Text accessibilityRole="link" className="font-semibold text-accent" onPress={() => navigation.navigate("SignUp")}>
          Create an account
        </Text>
      </View>
    </AuthLayout>
  )
}
