import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { BackButton, Button, buttonClass, Card, PageTitle } from "~/components/ui"
import {
  coachAction,
  coachAddress,
  coachApp,
  coachNote,
  coachSteps,
  COACH_APPS,
  connectorName,
  DEFAULT_COACH_APP,
  isTestStage,
  type CoachAppId,
} from "~/domain/coach-apps"
import { SETTINGS_TITLES } from "~/domain/settings"
import { getDeployment } from "~/functions/api"

export const Route = createFileRoute("/_app/settings/coach")({
  loader: () => getDeployment(),
  component: CoachPage,
})

/** How to add this log to the user's AI app as a connector. */
function CoachPage() {
  const { stage } = Route.useLoaderData()
  const name = connectorName(stage)
  const [address, setAddress] = useState("")
  const [copied, setCopied] = useState(false)
  const [appId, setAppId] = useState<CoachAppId>(DEFAULT_COACH_APP)
  const app = coachApp(appId)
  const action = address ? coachAction(app, address, name) : null
  const note = coachNote(app, name)

  useEffect(() => {
    setAddress(coachAddress(window.location.origin))
  }, [])

  const copy = async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
  }

  return (
    <>
      <BackButton fallback="/settings" />
      <PageTitle>{SETTINGS_TITLES.coach}</PageTitle>

      <Card>
        <p className="pb-3">
          Connect this log to the AI app you already pay for, so it can read your training, write your plan and adjust
          your weights. It works with any app that can add a custom MCP server.
        </p>
        {isTestStage(stage) ? (
          <p className="mb-4 rounded-2xl bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
            This is a test copy ({stage}), so its connector is called {name}. It can sit next to the live Gym one: ask
            your AI to use {name} by name, and remove {name} in the AI app when you are done.
          </p>
        ) : null}
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
          {coachSteps(app, name).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {note ? <p className="pb-4 text-sm text-faint">{note}</p> : null}
        {action ? (
          <a
            className={buttonClass("primary", "mb-3 w-full")}
            href={action.url}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              // Copy while this page still has focus; the link then opens the app in a new tab.
              if (action.copiesAddress) void copy()
            }}
          >
            {action.label}
          </a>
        ) : null}
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-2xl bg-ink px-4 py-3.5 text-sm">{address}</code>
          <Button onClick={copy} disabled={!address}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </Card>
    </>
  )
}
