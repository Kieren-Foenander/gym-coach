/** The camera views a demonstration can be rendered from, and what each adds to the file name. */
export const DEMO_VIEWS = { front: "", back: "-rear" } as const

export type DemoView = keyof typeof DEMO_VIEWS

export interface ExerciseDemo {
  /** The exercise's slug in the library, which is also the file name under /exercises without the view or extension. */
  readonly slug: string
  /** The views that have been rendered. The first is shown to begin with. */
  readonly views: ReadonlyArray<DemoView>
  /** How to do the movement, one step per line. */
  readonly cues: ReadonlyArray<string>
}

/**
 * Rendered demonstrations, made with tools/mannequin from the specs in tools/mannequin/exercises.
 * To add one, render it to public/exercises/<slug>.mp4 and .webp (the slug is in src/domain/catalog.ts)
 * and list it here. The muscles that glow in it, and are listed beside it, come from the library entry.
 */
const DEMOS: ReadonlyArray<ExerciseDemo> = [
  {
    slug: "overhead-press",
    views: ["front", "back"],
    cues: [
      "Stand tall with the bar at shoulder height and your feet planted.",
      "Brace and draw your head back just enough to let the bar pass.",
      "Straighten your arms overhead, then lower the bar along the same path.",
    ],
  },
  {
    slug: "barbell-row",
    views: ["front", "back"],
    cues: [
      "Hinge at the hips with soft knees and let the bar hang below your shoulders.",
      "Hold your torso still as you pull the bar toward your waist.",
      "Lower under control until your arms hang long again.",
    ],
  },
  {
    slug: "hammer-curl",
    views: ["front", "back"],
    cues: [
      "Stand with the dumbbells by your sides and your thumbs pointing forward.",
      "Bend both elbows, keeping your upper arms close and your thumbs leading.",
      "Lower the weights slowly with your palms still facing each other.",
    ],
  },
  {
    slug: "lateral-raise",
    views: ["front", "back"],
    cues: [
      "Stand tall with a dumbbell in each hand and a slight bend in your elbows.",
      "Lift your arms out and slightly forward to shoulder height.",
      "Keep your torso still as you lower the weights to your sides.",
    ],
  },
  {
    slug: "good-morning",
    views: ["front", "back"],
    cues: [
      "Rest the bar across your upper back and soften your knees.",
      "Brace and push your hips back as your torso tips forward.",
      "Press through your feet and bring your hips forward to stand tall.",
    ],
  },
  {
    slug: "front-raise",
    views: ["front"],
    cues: [
      "Stand tall with a dumbbell in each hand and your palms facing back.",
      "Raise both weights in front of you with a slight bend in your elbows.",
      "Pause near shoulder height, then lower without rocking back.",
    ],
  },
  {
    slug: "dumbbell-shrug",
    views: ["front", "back"],
    cues: [
      "Hold the dumbbells beside your thighs with your arms long.",
      "Lift your shoulders toward your ears while keeping your head still.",
      "Pause at the top, then slowly lower your shoulders.",
    ],
  },
  {
    slug: "dumbbell-curl",
    views: ["front"],
    cues: [
      "Stand tall with your elbows pinned to your sides.",
      "Curl both dumbbells up without swinging your body.",
      "Squeeze at the top, then lower slowly until your arms are straight.",
    ],
  },
  {
    slug: "bench-press",
    views: ["front"],
    cues: [
      "Plant your feet and draw your shoulder blades back against the bench.",
      "Lower the bar to your mid chest with your wrists over your elbows.",
      "Press up and slightly back over your shoulders, keeping your hips on the bench.",
    ],
  },
  {
    slug: "squat",
    views: ["front", "back"],
    cues: [
      "Set the bar across your upper back, feet a little wider than your hips with toes turned out.",
      "Sit your hips back and down, knees tracking over your toes, until your thighs are level.",
      "Drive up through your whole foot, keeping your chest up.",
    ],
  },
  {
    slug: "deadlift",
    views: ["front", "back"],
    cues: [
      "Set your feet about hip-width apart and grip the bar just outside your legs.",
      "Brace, keep your arms straight, and push through your feet as your hips and shoulders rise.",
      "Stand tall, then hinge back and bend your knees to return the bar close to your legs to the floor.",
    ],
  },
]

export const demoFor = (slug: string): ExerciseDemo | null => DEMOS.find((demo) => demo.slug === slug) ?? null

export const RENDERED_SLUGS: ReadonlyArray<string> = DEMOS.map((demo) => demo.slug)

/** Where a demonstration's video and poster image are served from, without the extension. */
export const demoFile = (demo: ExerciseDemo, view: DemoView): string => `/exercises/${demo.slug}${DEMO_VIEWS[view]}`
