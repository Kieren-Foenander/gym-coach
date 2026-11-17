import { DEMO_VIEWS, type DemoView, type ExerciseDemo } from "~/domain/demos"
import { useSession } from "@/api/session"
import { useCall } from "@/data/calls"

/**
 * The rendered demonstrations, asked from the server instead of built into the app,
 * so an exercise rendered after this build was made still shows its video.
 */
export const useDemos = () => {
  const session = useSession()
  const { data } = useCall("getDemos", {})
  const serverUrl = session.status === "loading" ? "" : session.serverUrl

  return {
    demoFor: (slug: string): ExerciseDemo | null => data?.find((demo) => demo.slug === slug) ?? null,
    /** Where a demonstration's video and poster image are served from, without the extension. */
    demoFile: (demo: ExerciseDemo, view: DemoView): string => `${serverUrl}/exercises/${demo.slug}${DEMO_VIEWS[view]}`,
  }
}
