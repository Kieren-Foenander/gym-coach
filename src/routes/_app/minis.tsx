import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Schema } from "effect"
import { DayProgress, EntryList, MiniSettingsForm, NudgeCard, PauseNudges, PushCard, SetupLink } from "~/components/minis"
import { BackButton, ErrorNote, SectionTitle, useAction, useNow } from "~/components/ui"
import { daysAround } from "~/domain/days"
import { localDay } from "~/domain/health"
import { describeGoal } from "~/domain/streaks"
import { Id } from "~/domain/schema"
import { getMinis, logMini, skipNudge } from "~/functions/api"

/** The nudge a notification opened, when it opened one. The router reads `?nudge=12` as the number 12. */
const Search = Schema.Struct({ nudge: Schema.optional(Id) })

export const Route = createFileRoute("/_app/minis")({
  validateSearch: Schema.toStandardSchemaV1(Search),
  // The days that may be today wherever the browser is; the screen picks its own.
  loader: () => getMinis({ data: daysAround(Date.now()) }),
  component: MinisPage,
})

/** Mini workouts: today's targets and what is done, the nudge that brought you here, and the settings. */
function MinisPage() {
  const now = useNow()

  return (
    <>
      <BackButton fallback="/" />
      <p className="eyebrow min-h-4 pb-1 text-mini">A few at a time</p>
      <h1 className="display pb-5 text-5xl">Mini workouts</h1>
      {now === null ? null : <MinisDay today={localDay(now)} />}
    </>
  )
}

function MinisDay({ today }: { readonly today: string }) {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const { user } = Route.useRouteContext()
  const { act, pending, error } = useAction()
  const day = data.days.find((item) => item.day === today) ?? data.days[1]!
  const entries = data.entries.filter((entry) => entry.day === today)
  const nudge = search.nudge === undefined ? undefined : data.nudges.find((item) => item.id === search.nudge)
  const chunks = new Map(day.targets.map((target) => [target.exercise, target.chunk]))
  const minisGoal = user.streakGoals.find((goal) => goal.activity === "minis")

  const log = (exercise: string, amount: number, nudgeId?: number) =>
    act(async () => {
      await logMini({ data: { day: today, exercise, amount, nudgeId, clientKey: crypto.randomUUID() } })
    })

  return (
    <>
      <ErrorNote message={error} />
      {nudge ? (
        <NudgeCard
          key={nudge.id}
          nudge={nudge}
          pending={pending}
          onDone={(amount) => void log(nudge.exercise, amount, nudge.id)}
          onSkip={() => void act(() => skipNudge({ data: { nudgeId: nudge.id } }))}
        />
      ) : null}

      {day.progress.length > 0 ? (
        <>
          <DayProgress day={day} chunks={chunks} pending={pending} onLog={(exercise, amount) => log(exercise, amount)} />
          <PauseNudges settings={data.settings} today={today} />
          <p className="pt-3 text-sm text-faint">
            {minisGoal
              ? `Your streak goal: ${describeGoal(minisGoal)}. Days with every target done get a blue ring on the calendar.`
              : "Add a mini workouts streak goal in Settings to ring the days you finish every target on the calendar."}
          </p>
          <SectionTitle>Done today</SectionTitle>
          <EntryList entries={entries} />
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-muted">
            Pick a few exercises you can do at home and a daily target for each, such as 100 push-ups and 50 pull-ups. Nudges
            then come at random through your day, each asking for a few, until the day is done.
          </p>
          <SetupLink />
        </div>
      )}

      <div id="setup">
        <SectionTitle>Targets and nudges</SectionTitle>
        <MiniSettingsForm settings={data.settings} today={today} />
      </div>

      <SectionTitle>This device</SectionTitle>
      <PushCard publicKey={data.push.publicKey} endpoints={data.push.endpoints} />

      {nudge ? (
        <button type="button" className="mt-4 min-h-11 w-full text-sm font-semibold text-muted" onClick={() => void navigate({ to: "/minis", search: {} })}>
          Close the nudge
        </button>
      ) : null}
    </>
  )
}
