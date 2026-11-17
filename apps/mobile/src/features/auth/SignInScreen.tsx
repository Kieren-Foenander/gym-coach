import { useState } from "react"
import { View } from "react-native"
import { describeError } from "@/api/client"
import { signIn, useSession } from "@/api/session"
import { Button, ErrorNote, Field, Text, TextInput } from "@/components/ui"
import type { AuthScreenProps } from "@/navigation"
import { AuthLayout, ServerField } from "./AuthLayout"

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
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            returnKeyType="next"
          />
        </Field>
        <Field label="Password">
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </Field>
        <ServerField value={serverUrl} onChange={setServerUrl} />
        <ErrorNote message={error} />
        <Button variant="primary" disabled={pending || email === "" || password === "" || serverUrl === ""} onPress={submit}>
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
