import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState, type FormEvent } from "react"
import {
  Button,
  buttonClass,
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
import { CHOICE_STATES, SAVE_STATES, testIds } from "~/domain/test-ids"
import {
  ACTIVITY_HINTS,
  ACTIVITY_LABELS,
  activeGoals,
  describeGoal,
  FREQUENCIES,
  isFrequency,
  MAX_STREAK_GOALS,
  normaliseGoal,
  STREAK_ACTIVITIES,
  suggestSecondGoal,
  type StreakGoal,
} from "~/domain/streaks"
import { getDeployment, signOut, updateProfile } from "~/functions/api"

export const Route = createFileRoute("/_app/settings")({
  loader: () => getDeployment(),
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

      <SectionTitle>Streak goals</SectionTitle>
      <StreakGoalsCard saved={activeGoals(user.streakGoals)} />

      <SectionTitle>About you</SectionTitle>
      <Card>
        <form onSubmit={save} className="space-y-4">
          <Field label="Name">
            <TextInput
              data-testid={testIds.settings.displayName}
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
              data-testid={testIds.settings.goal}
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
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            data-testid={testIds.settings.saveProfile}
            data-state={saved && !pending ? SAVE_STATES.saved : SAVE_STATES.unsaved}
            disabled={pending}
          >
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
        <Button className="w-full" data-testid={testIds.settings.signOut} onClick={leave}>
          Sign out
        </Button>
      </Card>
    </>
  )
}

interface ChoiceProps {
  /** From src/domain/test-ids.ts. Whether it is picked is in `data-state`. */
  readonly testId: string
  readonly label: string
  readonly selected: boolean
  readonly onClick: () => void
}

function Choice({ testId, label, selected, onClick }: ChoiceProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-testid={testId}
      data-state={selected ? CHOICE_STATES.selected : CHOICE_STATES.unselected}
      onClick={onClick}
      className={`min-h-11 rounded-full px-4 font-semibold transition-colors ${
        selected ? "bg-accent text-accent-ink" : "bg-raised text-muted"
      }`}
    >
      {label}
    </button>
  )
}

/** What the calendar's streaks count and how often: one goal, or two with the first leading. */
function StreakGoalsCard({ saved }: { readonly saved: ReadonlyArray<StreakGoal> }) {
  const { act, pending, error } = useAction()
  const [goals, setGoals] = useState(saved)
  const [done, setDone] = useState(false)
  const first = goals[0]

  const edit = (next: ReadonlyArray<StreakGoal>) => {
    setGoals(next)
    setDone(false)
  }

  const change = (index: number, patch: Partial<StreakGoal>) =>
    edit(goals.map((goal, at) => (at === index ? normaliseGoal({ ...goal, ...patch }) : goal)))

  const save = () =>
    void act(async () => {
      await updateProfile({ data: { streakGoals: goals } })
      setDone(true)
    })

  return (
    <Card>
      <p className="pb-4 text-muted">
        Your streak counts what you set here. A walk on its own only counts toward a goal for walks or for anything.
      </p>
      <div className="space-y-5">
        {goals.map((goal, index) => (
          <fieldset key={index} className="space-y-3" data-testid={testIds.settings.streakGoal(index === 0 ? "main" : "second")}>
            <legend className="flex w-full items-center justify-between gap-3 pb-1">
              <span>
                <span className="eyebrow block text-xs text-faint">{index === 0 ? "Main goal" : "Second goal"}</span>
                <span className="display block text-2xl">{describeGoal(goal)}</span>
              </span>
              {index > 0 ? (
                <button
                  type="button"
                  className="min-h-11 px-2 text-sm font-semibold text-muted"
                  data-testid={testIds.settings.removeStreakGoal}
                  onClick={() => edit(goals.filter((_, at) => at !== index))}
                >
                  Remove
                </button>
              ) : null}
            </legend>
            <div>
              <span className="mb-1.5 block text-sm text-muted">What counts</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="What counts">
                {STREAK_ACTIVITIES.map((activity) => (
                  <Choice
                    key={activity}
                    testId={testIds.settings.streakActivity(activity)}
                    label={ACTIVITY_LABELS[activity]}
                    selected={goal.activity === activity}
                    onClick={() => change(index, { activity })}
                  />
                ))}
              </div>
              <p className="pt-1.5 text-sm text-faint">{ACTIVITY_HINTS[goal.activity]}</p>
            </div>
            <div>
              <span className="mb-1.5 block text-sm text-muted">How often</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="How often">
                {FREQUENCIES.map((frequency) => (
                  <Choice
                    key={frequency.label}
                    testId={testIds.settings.streakFrequency(frequency)}
                    label={frequency.label}
                    selected={isFrequency(goal, frequency)}
                    onClick={() => change(index, { period: frequency.period, target: frequency.target })}
                  />
                ))}
              </div>
            </div>
          </fieldset>
        ))}
        {goals.length < MAX_STREAK_GOALS && first ? (
          <Button
            className="w-full"
            data-testid={testIds.settings.addStreakGoal}
            onClick={() => edit([...goals, suggestSecondGoal(first)])}
          >
            Add a second goal
          </Button>
        ) : null}
        <ErrorNote message={error} />
        <Button
          variant="primary"
          className="w-full"
          disabled={pending}
          data-testid={testIds.settings.saveStreakGoals}
          data-state={done && !pending ? SAVE_STATES.saved : SAVE_STATES.unsaved}
          onClick={save}
        >
          {done && !pending ? "Saved" : "Save goals"}
        </Button>
      </div>
    </Card>
  )
}

function ConnectCoach() {
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
  )
}
