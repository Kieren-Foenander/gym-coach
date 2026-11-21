import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { Schema } from "effect"
import { useState, type FormEvent } from "react"
import { BarbellIcon } from "~/components/icons"
import { Button, ErrorNote, Field, TextInput, useHydrated } from "~/components/ui"
import { getSession, signIn } from "~/functions/api"
import { testIds } from "~/domain/test-ids"

const Search = Schema.Struct({ redirect: Schema.optional(Schema.String) })

/** Only same-site paths are followed after sign-in, so a crafted link cannot send someone elsewhere. */
export const safeRedirect = (target: string | undefined) =>
  target && target.startsWith("/") && !target.startsWith("//") && !target.startsWith("/\\") ? target : "/"

export const Route = createFileRoute("/login")({
  validateSearch: Schema.toStandardSchemaV1(Search),
  beforeLoad: async ({ search }) => {
    if (await getSession()) throw redirect({ href: safeRedirect(search.redirect) })
  },
  component: LoginPage,
})

function LoginPage() {
  const search = Route.useSearch()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const hydrated = useHydrated()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      await signIn({ data: { email, password } })
      // A full navigation, because the destination may be the OAuth consent page, which is not an app route.
      window.location.assign(safeRedirect(search.redirect))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in")
      setPending(false)
    }
  }

  return (
    <main className="pt-safe pb-safe mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <div className="flex items-center gap-3 pb-8">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-ink">
          <BarbellIcon className="size-9" />
        </span>
        <span className="display text-6xl">Gym</span>
      </div>
      <h1 className="display pb-1 text-4xl">Welcome back</h1>
      <p className="pb-6 text-muted">
        {search.redirect ? "Sign in to connect your AI coach." : "Sign in to your training log."}
      </p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <TextInput
            type="email"
            data-testid={testIds.login.email}
            autoComplete="username"
            autoCapitalize="none"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Password">
          <TextInput
            type="password"
            data-testid={testIds.login.password}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <ErrorNote message={error} />
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          data-testid={testIds.login.submit}
          disabled={pending || !hydrated}
        >
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="pt-6 text-center text-muted">
        New here?{" "}
        <Link to="/signup" search={{ redirect: search.redirect }} className="font-semibold text-accent">
          Create an account
        </Link>
      </p>
    </main>
  )
}
