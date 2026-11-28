import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { BackButton, Button, Card, ErrorNote, PageTitle, useAction } from "~/components/ui"
import { SETTINGS_TITLES } from "~/domain/settings"
import {
  ACTIVITY_HINTS,
  ACTIVITY_LABELS,
  activeGoals,
  describeGoal,
  FREQUENCIES,
  isFrequency,
  MAX_STREAK_GOALS,
  normaliseGoal,
  RING_COLORS,
  ringFor,
  STREAK_ACTIVITIES,
  suggestNextGoal,
  type StreakGoal,
} from "~/domain/streaks"
import { CHOICE_STATES, GOAL_SLOTS, SAVE_STATES, testIds } from "~/domain/test-ids"
import { updateProfile } from "~/functions/api"

const SLOT_NAMES = ["Main goal", "Second goal", "Third goal"] as const

export const Route = createFileRoute("/_app/settings/streaks")({
  component: StreakGoalsPage,
})

function StreakGoalsPage() {
  const { user } = Route.useRouteContext()

  return (
    <>
      <BackButton fallback="/settings" />
      <PageTitle>{SETTINGS_TITLES.streaks}</PageTitle>
      <StreakGoalsCard saved={activeGoals(user.streakGoals)} />
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

/** What the calendar's streaks count and how often: one goal, or up to three with the first leading. */
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
        Your streak counts what you set here. A walk on its own only counts toward a goal for walks or for anything. Each
        goal rings the days it counts on the calendar in its own colour.
      </p>
      <div className="space-y-5">
        {goals.map((goal, index) => (
          <fieldset key={index} className="space-y-3" data-testid={testIds.settings.streakGoal(GOAL_SLOTS[index] ?? "third")}>
            <legend className="flex w-full items-center justify-between gap-3 pb-1">
              <span className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="size-6 shrink-0 rounded-full"
                  style={{ borderWidth: 3, borderStyle: "solid", borderColor: RING_COLORS[ringFor(goal.activity)] }}
                />
                <span>
                  <span className="eyebrow block text-xs text-faint">{SLOT_NAMES[index] ?? "Goal"}</span>
                  <span className="display block text-2xl">{describeGoal(goal)}</span>
                </span>
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
            onClick={() => edit([...goals, suggestNextGoal(goals)])}
          >
            {goals.length === 1 ? "Add a second goal" : "Add a third goal"}
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
