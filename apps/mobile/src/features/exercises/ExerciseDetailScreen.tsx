import { useNavigation } from "@react-navigation/native"
import { View } from "react-native"
import { catalogByName, catalogBySlug, isCardio, type CatalogExercise } from "~/domain/catalog"
import { howToFor } from "~/domain/howto"
import { distanceUnit, type Unit } from "~/domain/units"
import { formatDay, formatDuration, formatSet, formatWeight } from "~/format"
import type { Plan, ProgressPoint } from "~/server/repo"
import { describeError } from "@/api/client"
import { TrendChart } from "@/components/TrendChart"
import { BackLink, Button, Card, Display, Divider, Eyebrow, Loading, Screen, SectionTitle, Stat, Text } from "@/components/ui"
import { useCall } from "@/data/calls"
import { useUser } from "@/features/user"
import type { AppScreenProps } from "@/navigation"
import { Demonstration } from "./Demonstration"
import { useDemos } from "./demos"

/** An exercise from the built-in library, whether or not the user has ever done it. */
export function LibraryExerciseScreen({ route }: AppScreenProps<"LibraryExercise">) {
  const entry = catalogBySlug(route.params.slug)
  const { data, error } = useCall("getLibraryExercise", { slug: route.params.slug })

  // How to do it is built in, so the page is useful before the user's own progress arrives, and with no signal.
  return (
    <ExerciseDetail
      name={entry?.name ?? "Exercise"}
      entry={entry}
      points={data?.progress.points ?? null}
      plan={data?.plan ?? null}
      loadError={error ? describeError(error) : null}
    />
  )
}

/** An exercise reached by the user's own id for it, from a workout or the history. */
export function OwnExerciseScreen({ route }: AppScreenProps<"OwnExercise">) {
  const { data, error } = useCall("getExerciseProgress", { exerciseId: route.params.exerciseId })
  const name = data?.progress.exercise.name

  if (name === undefined) {
    return (
      <Screen>
        <BackButton />
        <Loading error={error ? describeError(error) : null} />
      </Screen>
    )
  }

  return <ExerciseDetail name={name} entry={catalogByName(name)} points={data?.progress.points ?? null} plan={data?.plan ?? null} loadError={null} />
}

function BackButton() {
  const navigation = useNavigation()

  return <BackLink onPress={navigation.goBack} />
}

/** What the exercise works and how to do it. */
function About({ entry }: { readonly entry: CatalogExercise }) {
  const steps = howToFor(entry.name)

  return (
    <Card className="mb-4 gap-3">
      <View className="flex-row flex-wrap items-center gap-2">
        {entry.primary.map((muscle) => (
          <View key={muscle} className="rounded-full bg-accent px-3 py-1">
            <Eyebrow className="text-xs text-accent-ink">{muscle}</Eyebrow>
          </View>
        ))}
        {entry.secondary.map((muscle) => (
          <View key={muscle} className="rounded-full bg-accent/15 px-3 py-1">
            <Eyebrow className="text-xs text-accent">{muscle}</Eyebrow>
          </View>
        ))}
      </View>
      {steps.length > 0 ? (
        <View className="gap-1.5">
          {steps.map((step, index) => (
            <View key={step} className="flex-row gap-2">
              <Text className="w-5 text-sm font-semibold text-accent">{index + 1}.</Text>
              <Text className="flex-1 text-sm text-muted">{step}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {entry.aliases.length > 0 ? <Text className="text-sm text-faint">Also called {entry.aliases.join(", ")}.</Text> : null}
    </Card>
  )
}

interface ProgressProps {
  /** Oldest first, and not empty. */
  readonly points: ReadonlyArray<ProgressPoint>
  readonly unit: Unit
}

const session = (point: ProgressPoint) => ({ weight: 0, reps: 0, durationSeconds: point.durationSeconds, distance: point.distance })

/** Progress on something logged by time and distance: the last session, the longest, and the trend. */
function CardioProgress({ points, unit }: ProgressProps) {
  const latest = points.at(-1)
  const longest = points.reduce((max, point) => Math.max(max, point.durationSeconds), 0)
  const furthest = points.reduce((max, point) => Math.max(max, point.distance), 0)
  // Distance says more than time when it is logged; the chart follows whichever the user records.
  const byDistance = points.every((point) => point.distance > 0)

  return (
    <>
      <View className="flex-row gap-2">
        <Stat label="Last session" value={latest ? formatSet(session(latest), unit) : ""} />
        {furthest > 0 ? (
          <Stat label="Furthest" value={formatWeight(furthest)} unit={distanceUnit(unit)} />
        ) : (
          <Stat label="Longest" value={formatDuration(longest)} />
        )}
      </View>

      <SectionTitle>{byDistance ? "Distance each session" : "Minutes each session"}</SectionTitle>
      <Card>
        <TrendChart
          label={byDistance ? "Distance each session" : "Minutes each session"}
          unit={byDistance ? distanceUnit(unit) : "min"}
          points={points.map((point) => ({
            id: point.workoutId,
            date: point.date,
            value: byDistance ? point.distance : Math.round(point.durationSeconds / 6) / 10,
          }))}
        />
      </Card>

      <SectionTitle>Sessions</SectionTitle>
      <Card className="py-1">
        {points.toReversed().map((point, index) => (
          <View key={point.workoutId}>
            {index > 0 ? <Divider /> : null}
            <View className="flex-row items-baseline justify-between gap-3 py-2">
              <Text className="text-muted">{formatDay(point.date)}</Text>
              <Text className="font-semibold tabular-nums">
                {formatSet(session(point), unit)}
                {point.sets > 1 ? <Text className="font-normal text-faint">{`  ${point.sets} rounds`}</Text> : null}
              </Text>
            </View>
          </View>
        ))}
      </Card>
    </>
  )
}

function StrengthProgress({ points, unit }: ProgressProps) {
  const latest = points.at(-1)
  const best = points.reduce((max, point) => Math.max(max, point.estimatedOneRepMax), 0)

  return (
    <>
      <View className="flex-row gap-2">
        <Stat label="Last top set" value={latest ? `${formatWeight(latest.topWeight)} × ${latest.topReps}` : ""} />
        <Stat label="Best estimated 1RM" value={formatWeight(best)} unit={unit} />
      </View>

      <SectionTitle>Estimated one-rep max</SectionTitle>
      <Card>
        <TrendChart
          label="Estimated one-rep max"
          unit={unit}
          points={points.map((point) => ({ id: point.workoutId, date: point.date, value: point.estimatedOneRepMax }))}
        />
      </Card>

      <SectionTitle>Sessions</SectionTitle>
      <Card className="py-1">
        {points.toReversed().map((point, index) => (
          <View key={point.workoutId}>
            {index > 0 ? <Divider /> : null}
            <View className="flex-row items-baseline justify-between gap-3 py-2">
              <Text className="text-muted">{formatDay(point.date)}</Text>
              <Text className="font-semibold tabular-nums">
                {formatWeight(point.topWeight)} {unit} × {point.topReps}
                <Text className="font-normal text-faint">{`  ${point.sets} sets`}</Text>
              </Text>
            </View>
          </View>
        ))}
      </Card>
    </>
  )
}

interface ExerciseDetailProps {
  readonly name: string
  /** The library entry, or null for an exercise the user made up. */
  readonly entry: CatalogExercise | null
  /** Oldest first. Null until the user's progress has loaded. */
  readonly points: ReadonlyArray<ProgressPoint> | null
  readonly plan: Plan | null
  readonly loadError: string | null
}

/** Everything about one exercise: how it is done, what it works, and the user's progress on it. */
function ExerciseDetail({ name, entry, points, plan, loadError }: ExerciseDetailProps) {
  const { unit } = useUser()
  const navigation = useNavigation()
  const { demoFor } = useDemos()
  const demo = entry ? demoFor(entry.slug) : null

  return (
    <Screen>
      <BackButton />
      <Eyebrow className="min-h-4 pb-1">{entry ? entry.equipment : "Your own exercise"}</Eyebrow>
      <Display accessibilityRole="header" className="pb-5 text-5xl">
        {name}
      </Display>

      {demo ? <Demonstration key={demo.slug} demo={demo} name={name} /> : null}
      {entry ? <About entry={entry} /> : null}

      {plan && plan.days.length > 0 ? <Button onPress={() => navigation.navigate("AddToPlan", { name })}>Add to plan</Button> : null}

      <SectionTitle>Your progress</SectionTitle>
      {points === null ? <Loading error={loadError} /> : null}
      {points !== null && points.length === 0 ? <Text className="text-muted">Nothing logged for this exercise yet.</Text> : null}
      {points !== null && points.length > 0 ? (
        isCardio(name) ? (
          <CardioProgress points={points} unit={unit} />
        ) : (
          <StrengthProgress points={points} unit={unit} />
        )
      ) : null}
    </Screen>
  )
}
