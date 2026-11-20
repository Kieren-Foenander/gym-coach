import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { View } from "react-native"
import { testIds } from "~/domain/test-ids"
import { describeError, normalizeServerUrl } from "@/api/client"
import { fetchSignupStatus, signUp, useSession } from "@/api/session"
import { Button, ErrorNote, Field, Text, TextInput } from "@/components/ui"
import type { AuthScreenProps } from "@/navigation"
import { AuthLayout, ServerField } from "./AuthLayout"

export function SignUpScreen({ navigation }: AuthScreenProps<"SignUp">) {
  const session = useSession()
  const [serverUrl, setServerUrl] = useState(session.status === "signedOut" ? session.serverUrl : "")
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [inviteCode, setInviteCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const server = normalizeServerUrl(serverUrl)

  // Whether this server lets new people in, asked again whenever the address changes.
  const status = useQuery({
    queryKey: ["signupStatus", server],
    queryFn: () => fetchSignupStatus(server),
    enabled: server !== "",
    gcTime: 0,
    retry: false,
  })

  const submit = async () => {
    setPending(true)
    setError(null)

    try {
      await signUp({ serverUrl, displayName, email, password, inviteCode })
    } catch (cause) {
      setError(describeError(cause))
      setPending(false)
    }
  }

  const open = status.data?.open ?? false
  const firstUser = status.data?.firstUser ?? false

  return (
    <AuthLayout title="Create an account">
      <Text className="pb-6 text-muted">
        {status.isPending
          ? "Checking the server…"
          : status.isError
            ? describeError(status.error)
            : !open
              ? "Sign-up is closed on this server."
              : firstUser
                ? "You are the first one here, so no invite is needed."
                : "You need an invite code to join."}
      </Text>
      <View className="gap-4">
        <ServerField value={serverUrl} onChange={setServerUrl} testID={testIds.signup.server} />
        {open ? (
          <>
            <Field label="Name">
              <TextInput value={displayName} onChangeText={setDisplayName} maxLength={80} autoComplete="given-name" textContentType="givenName" />
            </Field>
            <Field label="Email">
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                textContentType="username"
              />
            </Field>
            <Field label="Password (10 characters or more)">
              <TextInput value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
            </Field>
            {firstUser ? null : (
              <Field label="Invite code">
                <TextInput value={inviteCode} onChangeText={setInviteCode} autoCapitalize="none" autoCorrect={false} />
              </Field>
            )}
            <ErrorNote message={error} />
            <Button
              variant="primary"
              disabled={pending || displayName.trim() === "" || email === "" || password.length < 10}
              onPress={submit}
            >
              {pending ? "Creating…" : "Create account"}
            </Button>
          </>
        ) : null}
      </View>
      <View className="flex-row justify-center gap-1 pt-6">
        <Text className="text-muted">Have an account?</Text>
        <Text accessibilityRole="link" className="font-semibold text-accent" onPress={() => navigation.goBack()}>
          Sign in
        </Text>
      </View>
    </AuthLayout>
  )
}
