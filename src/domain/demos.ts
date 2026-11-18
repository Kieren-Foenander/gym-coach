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
    slug: "neck-curl",
    views: ["front"],
    cues: [
      "Lie face up with your head just beyond the bench.",
      "Steady the light plate against your forehead with both hands.",
      "Tuck your chin gently and lower under control.",
    ],
  },
  {
    slug: "neck-extension",
    views: ["front", "back"],
    cues: [
      "Support your chest on the pad with your head beyond its edge.",
      "Steady the light plate on the back of your head.",
      "Raise your head in line with your torso, then lower gently.",
    ],
  },
  {
    slug: "dumbbell-row",
    views: ["front", "back"],
    cues: [
      "Brace your free hand on the bench and hinge at the hips.",
      "Pull the dumbbell toward your ribs with your elbow close.",
      "Lower until your arm hangs beneath your shoulder.",
    ],
  },
  {
    slug: "goblet-squat",
    views: ["front"],
    cues: [
      "Cup the upper end of a dumbbell against your chest.",
      "Bend your hips and knees together and keep your heels planted.",
      "Push through both feet to stand tall.",
    ],
  },
  {
    slug: "sumo-squat",
    views: ["front"],
    cues: [
      "Stand wide with your toes turned out and the dumbbell between your legs.",
      "Bend your knees in line with your toes.",
      "Drive through both feet to return to standing.",
    ],
  },
  {
    slug: "plate-pinch",
    views: ["front"],
    cues: [
      "Stand tall with a plate beside each thigh.",
      "Pinch each rim between your thumb and fingers.",
      "Hold the plates steady with your wrists straight.",
    ],
  },
  {
    slug: "svend-press",
    views: ["front"],
    cues: [
      "Stand with a plate between your palms at chest height.",
      "Squeeze inward as you press the plate forward.",
      "Draw it back toward your chest under control.",
    ],
  },
  {
    slug: "plate-front-raise",
    views: ["front"],
    cues: [
      "Pinch the upper rim of the plate with both hands.",
      "Raise it in front of you to shoulder height.",
      "Lower slowly with a soft bend in your elbows.",
    ],
  },
  {
    slug: "bulgarian-split-squat",
    views: ["front", "back"],
    cues: [
      "Rest the ball of your rear foot on the bench and plant your front foot.",
      "Bend your front knee and lower your rear knee toward the floor.",
      "Drive through your front foot to stand back up.",
    ],
  },
  {
    slug: "step-up",
    views: ["front"],
    cues: [
      "Place your whole front foot on the bench with a dumbbell at each side.",
      "Drive through the elevated foot until your front knee and hip straighten.",
      "Lower the trailing foot to the floor under control.",
    ],
  },
  {
    slug: "y-raise",
    views: ["front", "back"],
    cues: [
      "Rest your chest on the pad and let the dumbbells hang.",
      "Lift your arms forward and apart into a Y with a soft elbow bend.",
      "Lower smoothly while keeping your chest against the pad.",
    ],
  },
  {
    slug: "chest-supported-row",
    views: ["front", "back"],
    cues: [
      "Rest your chest against the inclined pad with a weight in each hand.",
      "Pull your elbows behind you and bring the weights alongside your ribs.",
      "Lower the weights while keeping your chest on the pad.",
    ],
  },
  {
    slug: "incline-dumbbell-curl",
    views: ["front"],
    cues: [
      "Rest your back against the inclined pad and let your arms hang.",
      "Curl the weights while keeping your elbows beside your torso.",
      "Lower until your arms are long.",
    ],
  },
  {
    slug: "spider-curl",
    views: ["front"],
    cues: [
      "Rest your chest on the inclined pad and let the bar hang below your shoulders.",
      "Curl the angled bar without lifting your chest.",
      "Lower under control until your arms are long.",
    ],
  },
  {
    slug: "incline-dumbbell-fly",
    views: ["front"],
    cues: [
      "Lie back on the incline with palms facing each other.",
      "Keep a soft bend in your elbows as you open your arms wide.",
      "Sweep the weights back over your chest.",
    ],
  },
  {
    slug: "incline-bench-press",
    views: ["front"],
    cues: [
      "Lie back on the incline bench with your feet planted.",
      "Lower the bar toward your upper chest.",
      "Press the bar back over your shoulders.",
    ],
  },
  {
    slug: "incline-dumbbell-press",
    views: ["front"],
    cues: [
      "Lie back on the incline bench with your feet planted.",
      "Lower the dumbbells beside your upper chest.",
      "Press the dumbbells back over your shoulders.",
    ],
  },
  {
    slug: "decline-bench-press",
    views: ["front"],
    cues: [
      "Lie back on the decline bench with your feet planted.",
      "Lower the bar toward your lower chest.",
      "Press the bar back over your shoulders.",
    ],
  },
  {
    slug: "decline-dumbbell-press",
    views: ["front"],
    cues: [
      "Lie back on the decline bench with your feet planted.",
      "Lower the dumbbells beside your lower chest.",
      "Press the dumbbells back over your shoulders.",
    ],
  },
  {
    slug: "split-squat",
    views: ["front", "back"],
    cues: [
      "Set a long staggered stance with the rear heel raised.",
      "Bend both knees and lower your rear knee toward the floor.",
      "Push through your front foot to rise, keeping your stance.",
    ],
  },
  {
    slug: "reverse-lunge",
    views: ["front"],
    cues: [
      "Stand tall with a dumbbell at each side.",
      "Step back onto the ball of one foot and lower your rear knee.",
      "Push through the front foot and bring your feet back together.",
    ],
  },
  {
    slug: "forward-lunge",
    views: ["front"],
    cues: [
      "Hold the dumbbells at your sides and take a long step forward.",
      "Bend both knees while keeping the front foot planted.",
      "Push back through the front foot to return to standing.",
    ],
  },
  {
    slug: "barbell-lunge",
    views: ["front"],
    cues: [
      "Brace with the bar across your upper back.",
      "Step forward and lower your rear knee toward the floor.",
      "Drive through your front foot and step back to the start.",
    ],
  },
  {
    slug: "kettlebell-row",
    views: ["front", "back"],
    cues: [
      "Hinge at the hips with a bell hanging beneath each shoulder.",
      "Pull your elbows back to draw the handles alongside your waist.",
      "Lower both bells and keep your torso still.",
    ],
  },
  {
    slug: "trap-bar-shrug",
    views: ["front", "back"],
    cues: [
      "Stand centered in the frame with your hands on the parallel handles.",
      "Keep your arms long and lift your shoulders straight up.",
      "Pause, then lower the frame under control.",
    ],
  },
  {
    slug: "trap-bar-deadlift",
    views: ["front", "back"],
    cues: [
      "Stand inside the frame and grip the handles beside your shins.",
      "Brace and push the floor away until your knees and hips are straight.",
      "Hinge and bend your knees to set the plates down.",
    ],
  },
  {
    slug: "ez-bar-curl",
    views: ["front"],
    cues: [
      "Grip the angled sections of the bar with palms up.",
      "Curl the bar toward your shoulders without leaning back.",
      "Lower under control until your arms are long.",
    ],
  },
  {
    slug: "reverse-curl",
    views: ["front"],
    cues: [
      "Hold the angled grips with your palms down.",
      "Bend your elbows and lift the bar while keeping your wrists steady.",
      "Lower until your arms are long.",
    ],
  },
  {
    slug: "skull-crusher",
    views: ["front"],
    cues: [
      "Lie on the bench with the angled grips above you.",
      "Bend your elbows to lower the bar toward your forehead.",
      "Extend your elbows and bring the bar back up.",
    ],
  },
  {
    slug: "dumbbell-skull-crusher",
    views: ["front"],
    cues: [
      "Lie back with a dumbbell in each hand and your palms facing each other.",
      "Bend your elbows to lower the weights beside your head.",
      "Straighten your elbows to return the weights overhead.",
    ],
  },
  {
    slug: "jm-press",
    views: ["front"],
    cues: [
      "Set a close grip and hold the bar over your upper chest.",
      "Bend your elbows and guide the bar down toward your upper chest.",
      "Extend your elbows to press the bar back up.",
    ],
  },
  {
    slug: "dumbbell-fly",
    views: ["front"],
    cues: [
      "Lie back with the weights over your chest and your palms facing each other.",
      "Open your arms in a wide arc with a soft bend at the elbows.",
      "Bring the dumbbells back over your chest along the same arc.",
    ],
  },
  {
    slug: "dumbbell-squeeze-press",
    views: ["front"],
    cues: [
      "Lie back and hold the dumbbells together over your chest.",
      "Keep pressing the weights together as you lower them to your chest.",
      "Drive both weights up while maintaining contact.",
    ],
  },
  {
    slug: "standing-dumbbell-shoulder-press",
    views: ["front"],
    cues: [
      "Stand tall with a dumbbell beside each shoulder.",
      "Press both weights overhead while keeping your ribs down.",
      "Lower them under control to shoulder height.",
    ],
  },
  {
    slug: "dumbbell-shoulder-press",
    views: ["front"],
    cues: [
      "Sit tall on the bench with your feet planted.",
      "Press the dumbbells up from shoulder height.",
      "Bring them back down with your forearms under the weights.",
    ],
  },
  {
    slug: "seated-barbell-press",
    views: ["front"],
    cues: [
      "Sit tall and grip the bar just outside shoulder width.",
      "Move your chin back as you press the bar past your face.",
      "Lower to your upper chest with your feet planted.",
    ],
  },
  {
    slug: "push-press",
    views: ["front", "back"],
    cues: [
      "Stand with the bar at your shoulders and brace.",
      "Dip at the knees, then drive through your feet to send the bar up.",
      "Finish overhead and lower the bar back to your shoulders.",
    ],
  },
  {
    slug: "romanian-deadlift",
    views: ["front", "back"],
    cues: [
      "Start tall with the bar against your thighs and soften your knees.",
      "Push your hips back and guide the bar close to your shins.",
      "Bring your hips forward to stand tall again.",
    ],
  },
  {
    slug: "stiff-leg-deadlift",
    views: ["front", "back"],
    cues: [
      "Stand with the bar at your thighs and a slight bend in your knees.",
      "Keep that bend as you reach your hips back and lower the bar.",
      "Keep your arms long as you extend your hips to stand.",
    ],
  },
  {
    slug: "dumbbell-romanian-deadlift",
    views: ["front", "back"],
    cues: [
      "Stand tall with the dumbbells in front of your thighs.",
      "Soften your knees and push your hips back as the weights descend.",
      "Keep the weights close as you bring your hips forward.",
    ],
  },
  {
    slug: "barbell-front-raise",
    views: ["front"],
    cues: [
      "Hold the bar in front of your thighs with palms facing back.",
      "With a slight elbow bend, lift the bar in an arc to shoulder height.",
      "Lower the bar without leaning back or swinging.",
    ],
  },
  {
    slug: "reverse-fly",
    views: ["front", "back"],
    cues: [
      "Hinge at your hips and let the dumbbells hang beneath your shoulders.",
      "Keep a soft elbow bend and sweep your arms out to the sides.",
      "Lower the weights together while holding your torso still.",
    ],
  },
  {
    slug: "barbell-shrug",
    views: ["front", "back"],
    cues: [
      "Hold the bar in front of your thighs with an overhand grip.",
      "Keep your arms long and lift your shoulders toward your ears.",
      "Pause briefly, then lower your shoulders under control.",
    ],
  },
  {
    slug: "barbell-curl",
    views: ["front"],
    cues: [
      "Hold the bar with palms forward and your arms long.",
      "Bend your elbows to bring the bar toward your shoulders.",
      "Lower along the same arc while keeping your torso still.",
    ],
  },
  {
    slug: "drag-curl",
    views: ["front"],
    cues: [
      "Take an underhand grip with the bar in front of your thighs.",
      "Draw your elbows back as you curl the bar close to your body.",
      "Lower slowly and let your elbows return to your sides.",
    ],
  },
  {
    slug: "alternating-dumbbell-curl",
    views: ["front"],
    cues: [
      "Stand tall with a dumbbell in each hand and palms forward.",
      "Curl one weight while the other arm stays long.",
      "Lower fully before curling with the other arm.",
    ],
  },
  {
    slug: "paused-squat",
    views: ["front", "back"],
    cues: [
      "Set the bar across your upper back and brace.",
      "Sit down between your hips and hold still at depth.",
      "Keep pressure across your whole foot as you stand.",
    ],
  },
  {
    slug: "box-squat",
    views: ["front", "back"],
    cues: [
      "Set a flat bench behind you and brace under the bar.",
      "Sit back until your hips settle lightly on the pad.",
      "Keep your feet planted and stand without rocking forward.",
    ],
  },
  {
    slug: "paused-bench-press",
    views: ["front"],
    cues: [
      "Plant your feet and set your shoulder blades against the bench.",
      "Lower the bar to your chest and hold it still.",
      "Press back up without bouncing the bar.",
    ],
  },
  {
    slug: "wide-grip-bench-press",
    views: ["front"],
    cues: [
      "Set your hands wider than your usual bench grip.",
      "Keep your shoulder blades against the pad as you lower to your chest.",
      "Drive the bar up and slightly back over your shoulders.",
    ],
  },
  {
    slug: "close-grip-bench-press",
    views: ["front"],
    cues: [
      "Take a shoulder-width grip and plant both feet.",
      "Keep your elbows close as you lower to the lower chest.",
      "Press the bar up until your arms are long.",
    ],
  },
  {
    slug: "dumbbell-bench-press",
    views: ["front"],
    cues: [
      "Lie back with a dumbbell over each shoulder and plant your feet.",
      "Lower the weights beside your chest with your elbows beneath your wrists.",
      "Press both weights up together.",
    ],
  },
  {
    slug: "floor-press",
    views: ["front"],
    cues: [
      "Lie on the floor with bent knees and hold the bar above your shoulders.",
      "Lower until the backs of your upper arms settle on the floor.",
      "Pause, then press the bar up without lifting your hips.",
    ],
  },
  {
    slug: "dumbbell-floor-press",
    views: ["front"],
    cues: [
      "Lie on your back with a dumbbell over each shoulder.",
      "Lower the weights until your upper arms meet the floor.",
      "Keep your hips down and press both weights up together.",
    ],
  },
  {
    slug: "underhand-barbell-row",
    views: ["front", "back"],
    cues: [
      "Take an underhand grip and hinge until the bar hangs below your shoulders.",
      "Pull your elbows back and bring the bar toward your waist.",
      "Lower the bar under control and hold your torso angle.",
    ],
  },
  {
    slug: "triceps-kickback",
    views: ["back", "front"],
    cues: [
      "Hinge until your torso is nearly level and lift your elbows alongside your ribs.",
      "Straighten your elbows to send the weights behind you.",
      "Keep your elbows still as you lower your forearms to vertical.",
    ],
  },
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
