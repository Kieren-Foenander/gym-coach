import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { Schema } from "effect"
import { useState, type FormEvent } from "react"
import { BarbellIcon } from "~/components/icons"
import { Button, ErrorNote, Field, TextInput, useHydrated } from "~/components/ui"
import { getSession, getSignupStatus, signUp } from "~/functions/api"
import { safeRedirect } from "./login"

const Search = Schema.Struct({ redirect: Schema.optional(Schema.String) })

export const Route = createFileRoute("/signup")({
  validateSearch: Schema.toStandardSchemaV1(Search),
  beforeLoad: async ({ search }) => {
    if (await getSession()) throw redirect({ href: safeRedirect(search.redirect) })
  },
  loader: () => getSignupStatus(),
  component: SignupPage,
})

function SignupPage() {
  const status = Route.useLoaderData()
  const search = Route.useSearch()
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [inviteCode, setInviteCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const hydrated = useHydrated()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      await signUp({ data: { displayName, email, password, inviteCode } })
      window.location.assign(safeRedirect(search.redirect))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the account")
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
      <h1 className="display pb-1 text-4xl">Create an account</h1>
      {status.open ? (
        <>
          <p className="pb-6 text-muted">
            {status.firstUser ? "You are the first one here, so no invite is needed." : "You need an invite code to join."}
          </p>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Name">
              <TextInput
                autoComplete="given-name"
                required
                maxLength={80}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </Field>
            <Field label="Email">
              <TextInput
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label="Password (10 characters or more)">
              <TextInput
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            {status.firstUser ? null : (
              <Field label="Invite code">
                <TextInput
                  autoCapitalize="none"
                  autoComplete="off"
                  required
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value)}
                />
              </Field>
            )}
            <ErrorNote message={error} />
            <Button type="submit" variant="primary" className="w-full" disabled={pending || !hydrated}>
              {pending ? "Creating…" : "Create account"}
            </Button>
          </form>
        </>
      ) : (
        <p className="pb-6 text-muted">Sign-up is closed on this server.</p>
      )}
      <p className="pt-6 text-center text-muted">
        Have an account?{" "}
        <Link to="/login" search={{ redirect: search.redirect }} className="font-semibold text-accent">
          Sign in
        </Link>
      </p>
    </main>
  )
}
