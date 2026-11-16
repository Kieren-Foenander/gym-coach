/** The camera views a demonstration can be rendered from, and what each adds to the file name. */
export const DEMO_VIEWS = { front: "", back: "-rear", muscles: "-muscles" } as const

export type DemoView = keyof typeof DEMO_VIEWS

export interface ExerciseDemo {
  /** File name under /exercises, without the view or the extension. */
  readonly slug: string
  /** The views that have been rendered. The first is shown to begin with. */
  readonly views: ReadonlyArray<DemoView>
  readonly primary: ReadonlyArray<string>
  readonly secondary: ReadonlyArray<string>
  readonly cues: ReadonlyArray<string>
}

/** Rendered demonstrations, by exercise name in lower case. Made with tools/blender. */
const DEMOS: ReadonlyArray<ExerciseDemo & { readonly exercise: string }> = [
  {
    exercise: "dumbbell curl",
    slug: "dumbbell-curl",
    views: ["front", "muscles"],
    primary: ["Biceps"],
    secondary: ["Forearms"],
    cues: [
      "Stand tall with your elbows pinned to your sides.",
      "Curl both dumbbells up without swinging your body.",
      "Squeeze at the top, then lower slowly until your arms are straight.",
    ],
  },
  {
    exercise: "squat",
    slug: "squat",
    views: ["front", "back", "muscles"],
    primary: ["Quads", "Glutes"],
    secondary: ["Hamstrings", "Adductors", "Lower back"],
    cues: [
      "Set the bar across your upper back, feet a little wider than your hips with toes turned out.",
      "Sit your hips back and down, knees tracking over your toes, until your thighs are level.",
      "Drive up through your whole foot, keeping your chest up.",
    ],
  },
  {
    exercise: "deadlift",
    slug: "deadlift",
    views: ["front", "back", "muscles"],
    primary: ["Glutes", "Hamstrings"],
    secondary: ["Quads", "Adductors", "Lower back", "Lats", "Traps", "Forearms"],
    cues: [
      "Set your feet about hip-width apart and grip the bar just outside your legs.",
      "Brace, keep your arms straight, and push through your feet as your hips and shoulders rise.",
      "Stand tall, then hinge back and bend your knees to return the bar close to your legs to the floor.",
    ],
  },
]

export const demoFor = (exerciseName: string): ExerciseDemo | null =>
  DEMOS.find((demo) => demo.exercise === exerciseName.trim().toLowerCase()) ?? null

/** Where a demonstration's video and poster image are served from, without the extension. */
export const demoFile = (demo: ExerciseDemo, view: DemoView): string => `/exercises/${demo.slug}${DEMO_VIEWS[view]}`
