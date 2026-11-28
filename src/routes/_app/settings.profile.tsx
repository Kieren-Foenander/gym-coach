import { createFileRoute } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import {
  BackButton,
  Button,
  Card,
  ErrorNote,
  Field,
  PageTitle,
  Segmented,
  TextArea,
  TextInput,
  useAction,
} from "~/components/ui"
import { SETTINGS_TITLES } from "~/domain/settings"
import { SAVE_STATES, testIds } from "~/domain/test-ids"
import { updateProfile } from "~/functions/api"

export const Route = createFileRoute("/_app/settings/profile")({
  component: ProfilePage,
})

/** The name, the unit, and what the AI coach should know. */
function ProfilePage() {
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

  return (
    <>
      <BackButton fallback="/settings" />
      <PageTitle>{SETTINGS_TITLES.profile}</PageTitle>

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
    </>
  )
}
