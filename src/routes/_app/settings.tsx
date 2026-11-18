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
import { coachAddress, coachApp, coachSteps, COACH_APPS, DEFAULT_COACH_APP, type CoachAppId } from "~/domain/coach-apps"
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

      <SectionTitle>Credits</SectionTitle>
      <Card>
        <p className="text-sm text-muted">
          The muscles in the exercise demonstrations come from{" "}
          <a className="font-semibold text-accent" href="https://www.z-anatomy.com/" target="_blank" rel="noreferrer">
            Z-Anatomy
          </a>
          , the libre 3D atlas of anatomy, which builds on BodyParts3D by the Database Center for Life Science. The
          demonstration videos are shared under the same licence,{" "}
          <a
            className="font-semibold text-accent"
            href="https://creativecommons.org/licenses/by-sa/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY-SA 4.0
          </a>
          .
        </p>
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
  const [appId, setAppId] = useState<CoachAppId>(DEFAULT_COACH_APP)
  const app = coachApp(appId)

  useEffect(() => {
    setAddress(coachAddress(window.location.origin))
  }, [])

  const copy = async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
  }

  return (
    <Card>
      <p className="pb-3">
        Connect this log to the AI app you already pay for, so it can read your training, write your plan and adjust
        your weights. It works with any app that can add a custom MCP server.
      </p>
      <div className="flex flex-wrap gap-2 pb-4" role="group" aria-label="Your AI app">
        {COACH_APPS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === appId}
            onClick={() => setAppId(option.id)}
            className={`min-h-11 rounded-full px-4 font-semibold transition-colors ${
              option.id === appId ? "bg-accent text-accent-ink" : "bg-raised text-muted"
            }`}
          >
            {option.name}
          </button>
        ))}
      </div>
      <ol className="list-decimal space-y-2 pb-4 pl-5 text-muted marker:font-semibold marker:text-accent">
        {coachSteps(app).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {app.note ? <p className="pb-4 text-sm text-faint">{app.note}</p> : null}
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-2xl bg-ink px-4 py-3.5 text-sm">{address}</code>
        <Button onClick={copy} disabled={!address}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {app.setupUrl ? (
        <a
          className="mt-3 flex min-h-11 items-center justify-center font-semibold text-accent"
          href={app.setupUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open {app.name}
        </a>
      ) : null}
    </Card>
  )
}
