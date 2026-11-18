import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState, type FormEvent } from "react"
import {
  Button,
  Card,
  ErrorNote,
  Field,
  PageTitle,
  SectionTitle,
  Segmented,
  TextArea,
  TextInput,
  useAction,
} from "~/components/ui"
import { signOut, updateProfile } from "~/functions/api"

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
})

function SettingsPage() {
  const { user } = Route.useRouteContext()
  const { act, pending, error } = useAction()
  const [displayName, setDisplayName] = useState(user.displayName)
  const [unit, setUnit] = useState(user.unit)
  const [goal, setGoal] = useState(user.goal)
  const [trainingContext, setTrainingContext] = useState(user.trainingContext)
  const [saved, setSaved] = useState(false)

  const save = (event: FormEvent) => {
    event.preventDefault()
    setSaved(false)

    void act(async () => {
      await updateProfile({ data: { displayName, unit, goal, trainingContext } })
      setSaved(true)
    })
  }

  const leave = async () => {
    await signOut()
    window.location.assign("/login")
  }

  return (
    <>
      <PageTitle>Settings</PageTitle>

      <SectionTitle>AI coach</SectionTitle>
      <ConnectCoach />

      <SectionTitle>About you</SectionTitle>
      <Card>
        <form onSubmit={save} className="space-y-4">
          <Field label="Name">
            <TextInput
              required
              maxLength={80}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          <div>
            <span className="mb-1.5 block text-sm text-muted">Weights in</span>
            <Segmented label="Weights in" options={["kg", "lb"] as const} value={unit} onChange={setUnit} />
            <p className="pt-1.5 text-sm text-faint">Changing this relabels your numbers. It does not convert them.</p>
          </div>
          <Field label="Goal">
            <TextArea
              rows={2}
              maxLength={2000}
              placeholder="Get stronger on the big lifts"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
            />
          </Field>
          <Field label="What your coach should know">
            <TextArea
              rows={4}
              maxLength={4000}
              placeholder="Days you can train, equipment you have, injuries, exercises you like or avoid"
              value={trainingContext}
              onChange={(event) => setTrainingContext(event.target.value)}
            />
          </Field>
          <ErrorNote message={error} />
          <Button type="submit" variant="primary" className="w-full" disabled={pending}>
            {saved && !pending ? "Saved" : "Save"}
          </Button>
        </form>
      </Card>

      <SectionTitle>Account</SectionTitle>
      <Card>
        <p className="pb-3 text-muted">Signed in as {user.email}</p>
        <Button className="w-full" onClick={leave}>
          Sign out
        </Button>
      </Card>
    </>
  )
}

function ConnectCoach() {
  const [address, setAddress] = useState("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setAddress(`${window.location.origin}/mcp`)
  }, [])

  const copy = async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
  }

  return (
    <Card>
      <p className="pb-3">
        Connect this log to Claude so it can read your training, write your plan and adjust your weights. It runs on
        your Claude subscription.
      </p>
      <ol className="list-decimal space-y-2 pb-4 pl-5 text-muted marker:font-semibold marker:text-accent">
        <li>In Claude, open Settings, then Connectors, and choose Add custom connector.</li>
        <li>Name it Gym and paste the address below.</li>
        <li>Sign in here when asked, and tap Allow.</li>
        <li>In a chat, ask: “Look at my gym log and build me a plan.”</li>
      </ol>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-2xl bg-ink px-4 py-3.5 text-sm">{address}</code>
        <Button onClick={copy} disabled={!address}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </Card>
  )
}
