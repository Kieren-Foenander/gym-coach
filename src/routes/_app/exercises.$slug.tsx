import { createFileRoute, notFound } from "@tanstack/react-router"
import { ExerciseDetail } from "~/components/exercise"
import { catalogBySlug } from "~/domain/catalog"
import { getLibraryExercise } from "~/functions/api"

export const Route = createFileRoute("/_app/exercises/$slug")({
  loader: ({ params }) => getLibraryExercise({ data: { slug: params.slug } }),
  component: LibraryExercisePage,
})

/** An exercise from the built-in library, whether or not the user has ever done it. */
function LibraryExercisePage() {
  const { progress, plan } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const entry = catalogBySlug(Route.useParams().slug)

  if (!entry) throw notFound()

  return <ExerciseDetail name={entry.name} entry={entry} points={progress.points} plan={plan} unit={user.unit} />
}
