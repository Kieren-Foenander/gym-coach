import { createFileRoute } from "@tanstack/react-router"
import { ExerciseDetail } from "~/components/exercise"
import { catalogByName } from "~/domain/catalog"
import { getExerciseProgress } from "~/functions/api"

export const Route = createFileRoute("/_app/exercise/$exerciseId")({
  loader: ({ params }) => getExerciseProgress({ data: { exerciseId: Number(params.exerciseId) } }),
  component: ExercisePage,
})

/** An exercise reached by the user's own id for it, from a workout or the history. */
function ExercisePage() {
  const { progress, plan } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const name = progress.exercise.name

  return <ExerciseDetail name={name} entry={catalogByName(name)} points={progress.points} plan={plan} unit={user.unit} />
}
