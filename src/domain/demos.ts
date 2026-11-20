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
 * To add one, render it to tools/mannequin/renders/<slug>.mp4 and .webp (the slug is in src/domain/catalog.ts),
 * upload it to R2 with tools/mannequin/publish.sh, and list it here. The muscles that glow in it, and are listed beside it, come from the library entry.
 */
const DEMOS: ReadonlyArray<ExerciseDemo> = [
  {
    slug: "outdoor-cycling",
    views: ["front"],
    cues: [
      "Keep your hands steady on the bars.",
      "Pedal in smooth circles with quiet hips.",
      "Look ahead and keep a soft bend in your elbows.",
    ],
  },
  {
    slug: "stability-ball-leg-curl",
    views: ["front"],
    cues: [
      "Lie back with your heels on the ball and lift your hips.",
      "Bend your knees to draw the ball in.",
      "Roll it away slowly and keep your hips lifted.",
    ],
  },
  {
    slug: "gripper",
    views: ["front"],
    cues: [
      "Set one handle in your palm and wrap your fingers around the other.",
      "Squeeze the handles together with your wrist straight.",
      "Let the handles reopen slowly.",
    ],
  },
  {
    slug: "wrist-roller",
    views: ["front"],
    cues: [
      "Hold the roller with your elbows still.",
      "Turn the shaft to wind the cord and lift the weight.",
      "Unwind slowly under control.",
    ],
  },
  {
    slug: "sled-push",
    views: ["front"],
    cues: [
      "Grip both uprights and lean into the sled.",
      "Drive through the floor with short, alternating steps.",
      "Keep your arms long and your hips steady.",
    ],
  },
  {
    slug: "cable-woodchopper",
    views: ["front"],
    cues: [
      "Start with your hands high beside the pulley.",
      "Turn through your torso and hips as you pull diagonally down.",
      "Return along the same path under control.",
    ],
  },
  {
    slug: "cable-hip-adduction",
    views: ["front"],
    cues: [
      "Stand side-on with the cuff on the leg nearest the pulley.",
      "Draw that leg inward across your body without turning your hips.",
      "Return slowly to the side.",
    ],
  },
  {
    slug: "cable-crunch",
    views: ["front"],
    cues: [
      "Kneel facing the pulley with the rope beside your head.",
      "Curl your ribs toward your pelvis while keeping your hips steady.",
      "Uncurl slowly without pulling the rope with your arms.",
    ],
  },
  {
    slug: "cable-pull-through",
    views: ["back"],
    cues: [
      "Straddle the cable facing away from the low pulley.",
      "Push your hips back as the rope travels between your legs.",
      "Drive through your feet and stand tall.",
    ],
  },
  {
    slug: "cable-kickback",
    views: ["back"],
    cues: [
      "Attach the cuff and face the low pulley.",
      "Drive your working heel back while keeping your hips square.",
      "Bring the leg forward slowly without setting it down.",
    ],
  },
  {
    slug: "cable-hip-abduction",
    views: ["front"],
    cues: [
      "Stand side-on with the cuff on the leg farther from the pulley.",
      "Lift the working leg out to the side without tilting your hips.",
      "Lower under control while keeping tension.",
    ],
  },
  {
    slug: "cable-triceps-kickback",
    views: ["back"],
    cues: [
      "Hinge forward with your elbow beside your ribs.",
      "Straighten your arm behind you without swinging your upper arm.",
      "Return slowly to a bent elbow.",
    ],
  },
  {
    slug: "overhead-cable-triceps-extension",
    views: ["back"],
    cues: [
      "Stand facing away from the pulley with the rope behind your head.",
      "Keep your elbows steady as you extend your arms.",
      "Let your forearms fold back slowly.",
    ],
  },
  {
    slug: "wide-grip-seated-cable-row",
    views: ["back"],
    cues: [
      "Brace your feet and reach forward with long arms.",
      "Pull the wide bar toward your lower ribs with your chest lifted.",
      "Reach toward the pulley under control.",
    ],
  },
  {
    slug: "pallof-press",
    views: ["front"],
    cues: [
      "Stand side-on with the cable handle at your chest.",
      "Press it forward without turning your ribs or hips.",
      "Bring the handle back slowly and switch sides.",
    ],
  },
  {
    slug: "cable-upright-row",
    views: ["front"],
    cues: [
      "Start with the bar close to your thighs.",
      "Lead with your elbows as you raise the bar.",
      "Lower under control with your shoulders relaxed.",
    ],
  },
  {
    slug: "bayesian-curl",
    views: ["front"],
    cues: [
      "Stand ahead of the low pulley with your working elbow behind your ribs.",
      "Curl the handle without letting the elbow move forward.",
      "Uncurl slowly while keeping tension.",
    ],
  },
  {
    slug: "cable-external-rotation",
    views: ["front"],
    cues: [
      "Stand side-on and keep your elbow against your ribs.",
      "Turn your forearm away from your body without moving your elbow.",
      "Return slowly and repeat on the other side.",
    ],
  },
  {
    slug: "single-arm-cable-press",
    views: ["front"],
    cues: [
      "Stand facing away from the pulley and bring one handle to chest height.",
      "Press straight forward while keeping your ribs and hips square.",
      "Bring the handle back to your chest under control.",
    ],
  },
  {
    slug: "cable-reverse-fly",
    views: ["back"],
    cues: [
      "Reach toward the pulleys with both arms long.",
      "Open your arms out to the sides without shrugging.",
      "Return slowly without changing your elbow bend.",
    ],
  },
  {
    slug: "low-to-high-cable-fly",
    views: ["front"],
    cues: [
      "Start with the pulleys low and your elbows softly bent.",
      "Sweep the handles up and together in front of your chest.",
      "Lower and open your arms under control.",
    ],
  },
  {
    slug: "high-to-low-cable-fly",
    views: ["front"],
    cues: [
      "Start with the pulleys high and a soft bend in your elbows.",
      "Sweep the handles down and together in front of your waist.",
      "Open your arms slowly along the same path.",
    ],
  },
  {
    slug: "single-arm-lat-pulldown",
    views: ["back"],
    cues: [
      "Grip one handle overhead and keep your ribs square.",
      "Pull the elbow toward your side without leaning away.",
      "Reach overhead slowly and repeat on the other side.",
    ],
  },
  {
    slug: "neutral-grip-lat-pulldown",
    views: ["back"],
    cues: [
      "Hold the neutral handles with your palms facing each other.",
      "Drive your elbows down and bring the attachment toward your upper chest.",
      "Return slowly to a long overhead reach.",
    ],
  },
  {
    slug: "reverse-grip-lat-pulldown",
    views: ["back"],
    cues: [
      "Take a shoulder-width underhand grip.",
      "Pull down toward your upper chest with your elbows close to your sides.",
      "Reach overhead under control.",
    ],
  },
  {
    slug: "close-grip-lat-pulldown",
    views: ["back"],
    cues: [
      "Take a narrow overhand grip and sit tall under the pulley.",
      "Pull the bar to your upper chest with elbows close.",
      "Allow a controlled overhead reach.",
    ],
  },
  {
    slug: "lat-pulldown",
    views: ["back"],
    cues: [
      "Grip the wide bar overhand and brace your thighs under the pad.",
      "Pull your elbows down and bring the bar toward your upper chest.",
      "Let your arms straighten slowly without lifting off the seat.",
    ],
  },
  {
    slug: "high-cable-curl",
    views: ["front"],
    cues: [
      "Hold the handles with your upper arms out at shoulder height.",
      "Curl the handles toward your head without dropping your elbows.",
      "Straighten your arms slowly.",
    ],
  },
  {
    slug: "ab-wheel-rollout",
    views: ["front"],
    cues: [
      "Kneel and grip the wheel with straight arms.",
      "Roll forward as far as you can keep your ribs down.",
      "Pull the wheel back without arching your lower back.",
    ],
  },
  {
    slug: "box-jump",
    views: ["front"],
    cues: [
      "Bend your hips and knees and swing your arms back.",
      "Jump onto the box and land softly on both feet.",
      "Stand tall, then step down one foot at a time.",
    ],
  },
  {
    slug: "band-pull-apart",
    views: ["back"],
    cues: [
      "Hold the band at chest height with your arms long.",
      "Pull your hands apart without bending your elbows or shrugging.",
      "Return slowly and keep the band taut.",
    ],
  },
  {
    slug: "clamshell",
    views: ["front"],
    cues: [
      "Lie on your side with your knees bent and the band above them.",
      "Keep your feet together as you open the top knee.",
      "Lower slowly without rolling your hips back.",
    ],
  },
  {
    slug: "banded-lateral-walk",
    views: ["front"],
    cues: [
      "Place the band just above your knees and soften your knees.",
      "Step sideways while keeping your toes ahead and hips level.",
      "Bring the trailing foot in without letting the band go slack.",
    ],
  },
  {
    slug: "band-row",
    views: ["back"],
    cues: [
      "Anchor the band at waist height and face the post.",
      "Draw your elbow back toward your ribs without turning your torso.",
      "Reach forward slowly and keep the band taut.",
    ],
  },
  {
    slug: "band-face-pull",
    views: ["back"],
    cues: [
      "Set the band around shoulder height and step back.",
      "Pull the rope ends toward your temples with elbows high.",
      "Reach forward slowly without losing tension.",
    ],
  },
  {
    slug: "band-curl",
    views: ["front"],
    cues: [
      "Anchor the band low and hold the bar with palms up.",
      "Curl the bar while keeping your elbows by your ribs.",
      "Straighten your arms slowly and keep the band taut.",
    ],
  },
  {
    slug: "band-pushdown",
    views: ["back"],
    cues: [
      "Anchor the band high and step back until it is taut.",
      "Keep your elbows by your sides as you press the bar down.",
      "Let the bar rise slowly without moving your upper arms.",
    ],
  },
  {
    slug: "muscle-up",
    views: ["front"],
    cues: [
      "Start in a full hang with an overhand grip.",
      "Pull your chest up and bring your shoulders over the bar.",
      "Press to straight arms, then reverse under control.",
    ],
  },
  {
    slug: "swimming",
    views: ["front"],
    cues: [
      "Reach one arm forward while the other finishes its pull.",
      "Pull under the surface and recover the arm over the water.",
      "Keep a steady flutter kick and breathe to the side.",
    ],
  },
  {
    slug: "inverted-row",
    views: ["front"],
    cues: [
      "Grip the bar and plant your heels.",
      "Keep your body straight as you pull your chest toward the bar.",
      "Lower until your arms are long.",
    ],
  },
  {
    slug: "side-lying-leg-raise",
    views: ["front"],
    cues: [
      "Lie on your side with your hips stacked.",
      "Keep your top knee straight and lift the leg without rolling back.",
      "Lower slowly to the start.",
    ],
  },
  {
    slug: "captains-chair-leg-raise",
    views: ["front"],
    cues: [
      "Brace your forearms on the pads and grip the handles.",
      "Keep your back against the pad as you raise your knees.",
      "Lower your legs without swinging.",
    ],
  },
  {
    slug: "handstand-push-up",
    views: ["front"],
    cues: [
      "Set your palms shoulder-width apart and keep your toes on the wall.",
      "Lower your head between and just ahead of your hands.",
      "Press to straight arms while keeping your legs long.",
    ],
  },
  {
    slug: "nordic-curl",
    views: ["front"],
    cues: [
      "Kneel with your ankles secured under the roller.",
      "Keep a straight line from your knees to your shoulders as you lower.",
      "Pull yourself upright with your hamstrings.",
    ],
  },
  {
    slug: "outdoor-run",
    views: ["front"],
    cues: [
      "Lean slightly forward with your gaze ahead.",
      "Land lightly and drive the opposite arm with each stride.",
      "Keep your shoulders and hands relaxed.",
    ],
  },
  {
    slug: "walk",
    views: ["front"],
    cues: [
      "Stand tall and let your arms swing naturally.",
      "Roll through each step from heel to toe.",
      "Keep an even rhythm.",
    ],
  },
  {
    slug: "hike",
    views: ["front"],
    cues: [
      "Lean slightly forward and keep your gaze ahead.",
      "Lift your feet to clear uneven ground.",
      "Match your step length to the terrain.",
    ],
  },
  {
    slug: "sprint-intervals",
    views: ["front"],
    cues: [
      "Build speed with quick steps and strong arm drive.",
      "Sprint for the work interval.",
      "Ease back into a slower stride for recovery.",
    ],
  },
  {
    slug: "back-extension",
    views: ["front"],
    cues: [
      "Set the pad just below the hip crease and secure your ankles.",
      "Hinge forward at the hips with a long spine.",
      "Rise until your head, hips and heels form a straight line.",
    ],
  },
  {
    slug: "russian-twist",
    views: ["front"],
    cues: [
      "Sit with your knees bent and heels down.",
      "Lean back slightly and turn your ribs from side to side.",
      "Keep your hips steady throughout.",
    ],
  },
  {
    slug: "tibialis-raise",
    views: ["front"],
    cues: [
      "Lean your back against the wall with your feet forward.",
      "Keep your heels down and lift your toes toward your shins.",
      "Lower your toes slowly.",
    ],
  },
  {
    slug: "jumping-jacks",
    views: ["front"],
    cues: [
      "Start with feet together and arms at your sides.",
      "Jump your feet apart as your arms sweep overhead.",
      "Land softly and jump back to the start.",
    ],
  },
  {
    slug: "l-sit",
    views: ["front"],
    cues: [
      "Grip the bars beside your hips and straighten your arms.",
      "Lift your hips and hold both legs out in front.",
      "Keep your knees straight and breathe steadily.",
    ],
  },
  {
    slug: "donkey-kick",
    views: ["front"],
    cues: [
      "Start on your hands and knees.",
      "Keep one knee bent as you press that heel toward the ceiling.",
      "Lower slowly while keeping your hips square.",
    ],
  },
  {
    slug: "fire-hydrant",
    views: ["front"],
    cues: [
      "Set up with your hands under your shoulders and knees under your hips.",
      "Lift one bent knee out to the side without turning your torso.",
      "Lower under control.",
    ],
  },
  {
    slug: "superman",
    views: ["front"],
    cues: [
      "Lie face down and reach both arms forward.",
      "Lift your arms, chest and legs slightly while keeping your neck in line.",
      "Lower slowly and keep your pelvis against the floor.",
    ],
  },
  {
    slug: "decline-crunch",
    views: ["front"],
    cues: [
      "Secure your feet under the roller and lie back on the pad.",
      "Curl your ribs toward your pelvis to lift your shoulder blades.",
      "Lower your upper back and head with control.",
    ],
  },
  {
    slug: "decline-sit-up",
    views: ["front"],
    cues: [
      "Secure your ankles under the roller.",
      "Curl up and reach toward your knees.",
      "Lower slowly until your back and head return to the pad.",
    ],
  },
  {
    slug: "dragon-flag",
    views: ["front"],
    cues: [
      "Grip the bench behind your head and brace.",
      "Keep your hips and legs in line as you lift on your upper back.",
      "Lower the whole line under control.",
    ],
  },
  {
    slug: "copenhagen-plank",
    views: ["front"],
    cues: [
      "Place your upper foot on the bench and your elbow under your shoulder.",
      "Lift your hips and keep your chest facing forward.",
      "Hold the position and breathe steadily.",
    ],
  },
  {
    slug: "pistol-squat",
    views: ["front"],
    cues: [
      "Balance on one foot and reach the other leg forward.",
      "Sit down slowly with the free foot clear of the floor.",
      "Push through the planted foot to stand tall.",
    ],
  },
  {
    slug: "sissy-squat",
    views: ["front"],
    cues: [
      "Stand tall and brace through your hips.",
      "Rise onto your toes and bend your knees as your body leans back.",
      "Straighten your knees and lower your heels with control.",
    ],
  },
  {
    slug: "bird-dog",
    views: ["front"],
    cues: [
      "Set up on hands and knees with your back steady.",
      "Reach one arm and the opposite leg away from you.",
      "Return both to the floor and switch sides.",
    ],
  },
  {
    slug: "side-plank",
    views: ["front"],
    cues: [
      "Lie on your side with your elbow under your shoulder.",
      "Stack your feet and lift your hips into a straight line.",
      "Keep your hips facing forward and breathe steadily.",
    ],
  },
  {
    slug: "lying-leg-raise",
    views: ["front"],
    cues: [
      "Lie on your back and brace your lower back against the floor.",
      "Raise both legs together with a soft bend in the knees.",
      "Lower slowly as far as you can keep your back down.",
    ],
  },
  {
    slug: "flutter-kick",
    views: ["front"],
    cues: [
      "Lie on your back with your legs extended off the floor.",
      "Alternate short kicks from the hips.",
      "Keep your lower back down and your legs moving smoothly.",
    ],
  },
  {
    slug: "dead-bug",
    views: ["front"],
    cues: [
      "Start with arms up and hips and knees bent.",
      "Extend one leg and the opposite arm as you exhale.",
      "Return to centre and switch sides with your lower back down.",
    ],
  },
  {
    slug: "hollow-hold",
    views: ["front"],
    cues: [
      "Press your lower back into the floor.",
      "Lift your shoulders and extend your legs and arms.",
      "Hold the position and breathe steadily.",
    ],
  },
  {
    slug: "reverse-crunch",
    views: ["front"],
    cues: [
      "Lie on your back and bend both knees.",
      "Draw your knees toward your chest and curl your pelvis up.",
      "Lower your hips with control.",
    ],
  },
  {
    slug: "sit-up",
    views: ["front"],
    cues: [
      "Lie with your knees bent and your feet flat.",
      "Curl up toward your thighs as your hands reach forward.",
      "Lower slowly until your shoulders and head return to the floor.",
    ],
  },
  {
    slug: "v-up",
    views: ["front"],
    cues: [
      "Start on your back with your arms overhead and legs extended.",
      "Lift your torso and legs together and reach for your feet.",
      "Lower both under control.",
    ],
  },
  {
    slug: "bicycle-crunch",
    views: ["front"],
    cues: [
      "Lift your shoulders and keep your lower back down.",
      "Turn one shoulder toward the opposite knee as you extend the other leg.",
      "Switch sides in one smooth motion.",
    ],
  },
  {
    slug: "oblique-crunch",
    views: ["front"],
    cues: [
      "Lie on your back with knees bent and feet planted.",
      "Curl one shoulder toward the opposite knee.",
      "Lower to the floor and switch sides.",
    ],
  },
  {
    slug: "crunch",
    views: ["front"],
    cues: [
      "Lie on your back with knees bent and feet flat.",
      "Curl your ribs toward your pelvis and reach toward your knees.",
      "Lower your shoulders slowly while keeping your lower back down.",
    ],
  },
  {
    slug: "dip",
    views: ["front"],
    cues: [
      "Support yourself on straight arms between the bars.",
      "Lean slightly forward and bend your elbows back.",
      "Press through the bars to straighten your arms.",
    ],
  },
  {
    slug: "pull-up",
    views: ["front"],
    cues: [
      "Take an overhand grip just outside shoulder width.",
      "Drive your elbows down until your chin clears the bar.",
      "Lower smoothly to straight arms.",
    ],
  },
  {
    slug: "wide-grip-pull-up",
    views: ["front"],
    cues: [
      "Grip the bar well outside shoulder width.",
      "Draw your elbows down and lift your chin over the bar.",
      "Return to straight arms without swinging.",
    ],
  },
  {
    slug: "chin-up",
    views: ["front"],
    cues: [
      "Grip the bar with your palms facing you.",
      "Pull your elbows down and bring your chin above the bar.",
      "Lower under control to a full hang.",
    ],
  },
  {
    slug: "neutral-grip-pull-up",
    views: ["front"],
    cues: [
      "Grab the parallel handles with your palms facing in.",
      "Pull your elbows down as you lift your chin above your hands.",
      "Lower until your arms are straight.",
    ],
  },
  {
    slug: "hanging-knee-raise",
    views: ["front"],
    cues: [
      "Hang from the bar with both arms straight.",
      "Bend your knees and lift them toward your chest.",
      "Lower your legs under control without swinging.",
    ],
  },
  {
    slug: "hanging-leg-raise",
    views: ["front"],
    cues: [
      "Hang with your feet together and your arms straight.",
      "Lift both legs forward to about hip height.",
      "Lower slowly without swinging.",
    ],
  },
  {
    slug: "mountain-climber",
    views: ["front"],
    cues: [
      "Start in a high plank with your palms planted.",
      "Drive one knee forward while keeping your hips steady.",
      "Return that foot and switch sides.",
    ],
  },
  {
    slug: "dead-hang",
    views: ["front"],
    cues: [
      "Reach overhead and take a secure overhand grip.",
      "Lift your feet clear and let your arms straighten.",
      "Keep your body still as you breathe.",
    ],
  },
  {
    slug: "burpee",
    views: ["front"],
    cues: [
      "Squat and plant both palms on the floor.",
      "Send both feet back and lower into a push-up.",
      "Press up, bring your feet in and stand tall.",
    ],
  },
  {
    slug: "diamond-push-up",
    views: ["front"],
    cues: [
      "Bring your index fingertips and thumb tips together under your chest.",
      "Brace and bend your elbows back as you lower.",
      "Press through both palms and lift your body as one unit.",
    ],
  },
  {
    slug: "pike-push-up",
    views: ["front"],
    cues: [
      "Plant your hands and lift your hips high.",
      "Bend your elbows and lower the top of your head toward the floor.",
      "Press through your palms while keeping your hips high.",
    ],
  },
  {
    slug: "bear-crawl",
    views: ["front"],
    cues: [
      "Set your hands under your shoulders and hover your knees.",
      "Move one hand and the opposite foot together.",
      "Keep your hips low and alternate sides.",
    ],
  },
  {
    slug: "plank",
    views: ["front"],
    cues: [
      "Set your palms under your shoulders and extend both legs.",
      "Brace your abdomen and squeeze your glutes.",
      "Keep your body in a straight line as you breathe.",
    ],
  },
  {
    slug: "incline-push-up",
    views: ["front"],
    cues: [
      "Plant your palms on a sturdy elevated surface.",
      "Keep a straight line from shoulders to heels as your chest lowers.",
      "Press through both palms to return.",
    ],
  },
  {
    slug: "decline-push-up",
    views: ["front"],
    cues: [
      "Set your toes on a bench and your palms on the floor.",
      "Brace and lower your chest without letting your hips sag.",
      "Press the floor away until your elbows straighten.",
    ],
  },
  {
    slug: "push-up",
    views: ["front"],
    cues: [
      "Plant your palms just outside your shoulders and spread your fingers.",
      "Brace and lower your chest with your elbows angled back.",
      "Press the floor away and lift your hips and chest together.",
    ],
  },
  {
    slug: "cossack-squat",
    views: ["front"],
    cues: [
      "Take a wide stance and shift toward one foot.",
      "Keep that heel down and extend the other leg.",
      "Drive back to center and repeat on the other side.",
    ],
  },
  {
    slug: "jump-squat",
    views: ["front"],
    cues: [
      "Sit into a shallow squat to load your legs.",
      "Drive through the floor and jump straight up.",
      "Land softly and bend your hips and knees.",
    ],
  },
  {
    slug: "wall-sit",
    views: ["front"],
    cues: [
      "Rest your back against a wall and step your feet forward.",
      "Slide down until your knees are near a right angle.",
      "Keep both feet flat and breathe steadily as you hold.",
    ],
  },
  {
    slug: "elliptical",
    views: ["front"],
    cues: [
      "Keep your feet flat on the pedals.",
      "Push and pull the handles as you stride.",
      "Stay tall and move at a steady pace.",
    ],
  },
  {
    slug: "ski-erg",
    views: ["front"],
    cues: [
      "Reach high with soft elbows and knees.",
      "Hinge and drive the handles down past your hips.",
      "Stand tall as your arms return overhead.",
    ],
  },
  {
    slug: "single-leg-calf-raise",
    views: ["back"],
    cues: [
      "Balance on one foot and lift the other clear.",
      "Rise onto the ball of your foot without rolling the ankle.",
      "Lower the heel slowly before repeating.",
    ],
  },
  {
    slug: "single-leg-hip-thrust",
    views: ["back"],
    cues: [
      "Rest your upper back on the bench and plant one foot.",
      "Drive through the planted foot and lift your hips level.",
      "Lower slowly with your ribs tucked.",
    ],
  },
  {
    slug: "bodyweight-squat",
    views: ["front"],
    cues: [
      "Plant your feet about shoulder-width apart.",
      "Sit between your hips and let your knees follow your toes.",
      "Drive through your whole foot to stand tall.",
    ],
  },
  {
    slug: "stair-climber",
    views: ["front"],
    cues: [
      "Plant your whole foot on each step.",
      "Stand tall and let your legs carry your weight.",
      "Set a pace that lets you place each foot smoothly.",
    ],
  },
  {
    slug: "rowing-machine",
    views: ["front"],
    cues: [
      "Set your feet on the footrests and reach forward with straight arms.",
      "Drive through your legs, then open your hips and pull to your lower ribs.",
      "Reach your hands forward before bending your knees to return.",
    ],
  },
  {
    slug: "belt-squat",
    views: ["front"],
    cues: [
      "Fasten the belt around your hips and plant both feet.",
      "Sit down between your feet with your knees following your toes.",
      "Drive through your whole foot to stand tall.",
    ],
  },
  {
    slug: "machine-torso-rotation",
    views: ["front"],
    cues: [
      "Settle into the seat and hold both handles.",
      "Turn your rib cage while keeping your hips square.",
      "Return through center under control and change sides.",
    ],
  },
  {
    slug: "donkey-calf-raise",
    views: ["back"],
    cues: [
      "Brace on the handles and set the balls of your feet on the step.",
      "Raise your heels while keeping your hips steady.",
      "Lower your heels slowly below the step.",
    ],
  },
  {
    slug: "machine-glute-kickback",
    views: ["back"],
    cues: [
      "Plant one foot and hold the support handles.",
      "Drive the working leg back from the hip.",
      "Return slowly without turning your hips or arching your back.",
    ],
  },
  {
    slug: "machine-hip-thrust",
    views: ["back"],
    cues: [
      "Rest your upper back on the pad and plant both feet.",
      "Drive your hips up until your torso and thighs line up.",
      "Lower under control with your ribs and chin tucked.",
    ],
  },
  {
    slug: "treadmill-run",
    views: ["front"],
    cues: [
      "Run tall with a slight forward lean.",
      "Land under your hips and keep your steps quick.",
      "Let your arms swing loosely beside you.",
    ],
  },
  {
    slug: "incline-treadmill-walk",
    views: ["front"],
    cues: [
      "Walk tall with a slight lean from the ankles.",
      "Take short steps and drive through each planted foot.",
      "Let your arms swing without holding the rails.",
    ],
  },
  {
    slug: "stationary-bike",
    views: ["front"],
    cues: [
      "Set the saddle so your knee stays soft at the bottom.",
      "Keep your hips steady and hold the grips lightly.",
      "Pedal smoothly through each revolution.",
    ],
  },
  {
    slug: "recumbent-bike",
    views: ["front"],
    cues: [
      "Sit against the backrest and hold the side grips.",
      "Set the seat so your knees stay soft at full reach.",
      "Pedal smoothly without rocking your hips.",
    ],
  },
  {
    slug: "air-bike",
    views: ["front"],
    cues: [
      "Sit tall and hold both handles.",
      "Push one handle and pull the other as you pedal.",
      "Keep your effort smooth and your hips steady.",
    ],
  },
  {
    slug: "machine-lateral-raise",
    views: ["front"],
    cues: [
      "Set the pads against the outside of your elbows.",
      "Raise your elbows to shoulder height with a steady wrist.",
      "Lower the pads under control.",
    ],
  },
  {
    slug: "machine-crunch",
    views: ["front"],
    cues: [
      "Sit with your chest against the pad.",
      "Curl your ribs toward your hips.",
      "Return under control without lifting your hips.",
    ],
  },
  {
    slug: "machine-back-extension",
    views: ["front"],
    cues: [
      "Sit with the pad against your back.",
      "Extend your torso until you are upright.",
      "Return forward slowly without lifting your hips.",
    ],
  },
  {
    slug: "standing-leg-curl",
    views: ["front"],
    cues: [
      "Plant one foot and set the roller behind the other lower calf.",
      "Curl your heel back without shifting your hips.",
      "Lower the roller slowly.",
    ],
  },
  {
    slug: "reverse-hyperextension",
    views: ["front"],
    cues: [
      "Support your torso on the bench and grip the handles.",
      "Lift your legs until they are in line with your torso.",
      "Lower slowly without swinging.",
    ],
  },
  {
    slug: "machine-dip",
    views: ["front"],
    cues: [
      "Sit tall with a neutral grip and your hands beside your hips.",
      "Press the handles down until your arms are long.",
      "Return slowly without shrugging your shoulders.",
    ],
  },
  {
    slug: "assisted-dip",
    views: ["front"],
    cues: [
      "Kneel on the assistance pad and hold both handles.",
      "Bend your elbows to lower your chest.",
      "Press through your hands to return to the top.",
    ],
  },
  {
    slug: "assisted-pull-up",
    views: ["back"],
    cues: [
      "Kneel on the assistance pad and start with your arms long.",
      "Pull your elbows down to bring your chin toward the grips.",
      "Lower under control.",
    ],
  },
  {
    slug: "reverse-pec-deck",
    views: ["back"],
    cues: [
      "Set your chest against the pad and reach forward.",
      "Open your arms out to the sides with soft elbows.",
      "Bring the handles forward under control.",
    ],
  },
  {
    slug: "machine-lat-pulldown",
    views: ["back"],
    cues: [
      "Sit with your thighs under the restraint and reach up.",
      "Pull your elbows down until the handles reach your shoulders.",
      "Let your arms rise slowly under control.",
    ],
  },
  {
    slug: "machine-pullover",
    views: ["front"],
    cues: [
      "Sit with your back against the pad and reach for the handles.",
      "Sweep the handles down with a soft bend in your elbows.",
      "Return slowly as your arms rise.",
    ],
  },
  {
    slug: "machine-preacher-curl",
    views: ["front"],
    cues: [
      "Rest your upper arms on the angled pad.",
      "Curl the handles without lifting your elbows.",
      "Lower until your arms are long.",
    ],
  },
  {
    slug: "machine-biceps-curl",
    views: ["front"],
    cues: [
      "Hold the handles with your palms up and arms supported.",
      "Curl by bending only your elbows.",
      "Lower slowly and keep your upper arms on the pad.",
    ],
  },
  {
    slug: "machine-triceps-extension",
    views: ["front"],
    cues: [
      "Rest your upper arms on the pad with your elbows bent.",
      "Press the handles away and straighten your elbows.",
      "Return the handles slowly without lifting your upper arms.",
    ],
  },
  {
    slug: "machine-high-row",
    views: ["back"],
    cues: [
      "Reach up to the handles with your chest on the pad.",
      "Pull your elbows down and back.",
      "Return slowly until your arms are long.",
    ],
  },
  {
    slug: "chest-supported-machine-row",
    views: ["back"],
    cues: [
      "Set your chest against the angled pad.",
      "Draw the handles toward your ribs with your elbows back.",
      "Reach forward again without lifting your chest.",
    ],
  },
  {
    slug: "leg-curl",
    views: ["front"],
    cues: [
      "Lie face down with the rollers above your heels.",
      "Curl your heels toward your glutes while keeping your hips down.",
      "Straighten your knees slowly.",
    ],
  },
  {
    slug: "hack-squat",
    views: ["front"],
    cues: [
      "Plant your feet on the platform and keep your back on the pad.",
      "Bend your knees to lower the sled under control.",
      "Press through your whole foot to stand.",
    ],
  },
  {
    slug: "pendulum-squat",
    views: ["front"],
    cues: [
      "Set your shoulders against the pads and plant your feet.",
      "Lower along the arc with your knees tracking over your toes.",
      "Drive through the platform to return to standing.",
    ],
  },
  {
    slug: "hip-abduction",
    views: ["front"],
    cues: [
      "Sit tall with the pads against the outside of your thighs.",
      "Press your knees outward without leaning back.",
      "Bring your knees in slowly.",
    ],
  },
  {
    slug: "hip-adduction",
    views: ["front"],
    cues: [
      "Sit tall with the pads against the inside of your thighs.",
      "Bring your knees together while keeping your hips against the seat.",
      "Let your knees open slowly.",
    ],
  },
  {
    slug: "pec-deck",
    views: ["front"],
    cues: [
      "Sit with your back on the pad and elbows softly bent.",
      "Bring the handles together in front of your chest.",
      "Open your arms under control.",
    ],
  },
  {
    slug: "standing-calf-raise",
    views: ["back"],
    cues: [
      "Set the pads over your shoulders and plant your forefeet on the step.",
      "Raise your heels without bending your knees.",
      "Lower your heels slowly.",
    ],
  },
  {
    slug: "seated-calf-raise",
    views: ["back"],
    cues: [
      "Sit with the pads over your thighs and your forefeet on the step.",
      "Raise your heels to lift the pads.",
      "Lower slowly while keeping your forefeet planted.",
    ],
  },
  {
    slug: "leg-press-calf-raise",
    views: ["front"],
    cues: [
      "Place the balls of your feet on the foot plate with your knees softly bent.",
      "Press through your forefeet to raise your heels.",
      "Lower your heels without moving your knees.",
    ],
  },
  {
    slug: "smith-machine-calf-raise",
    views: ["back"],
    cues: [
      "Set the bar across your upper back.",
      "Rise onto the balls of your feet with your knees softly bent.",
      "Lower your heels slowly.",
    ],
  },
  {
    slug: "smith-machine-row",
    views: ["back"],
    cues: [
      "Hinge at the hips and start with long arms.",
      "Drive your elbows back to pull the bar toward your waist.",
      "Lower the bar while holding your torso still.",
    ],
  },
  {
    slug: "smith-machine-shrug",
    views: ["front"],
    cues: [
      "Hold the bar in front of your thighs with arms long.",
      "Lift your shoulders toward your ears.",
      "Lower your shoulders without rolling them.",
    ],
  },
  {
    slug: "smith-machine-bench-press",
    views: ["front"],
    cues: [
      "Set the bench so the bar lowers over your chest.",
      "Lower the bar under control with your feet planted.",
      "Press it up the guides until your arms are long.",
    ],
  },
  {
    slug: "smith-machine-incline-press",
    views: ["front"],
    cues: [
      "Set the incline bench so the bar lowers over your upper chest.",
      "Keep your back on the pad as you lower.",
      "Press straight up the guides.",
    ],
  },
  {
    slug: "smith-machine-shoulder-press",
    views: ["front"],
    cues: [
      "Sit with the bar just in front of your shoulders.",
      "Press up the guides without arching your back.",
      "Lower to shoulder height under control.",
    ],
  },
  {
    slug: "smith-machine-squat",
    views: ["front"],
    cues: [
      "Set the bar across your upper back.",
      "Bend your hips and knees as the bar slides down the guides.",
      "Drive through your feet and stand tall.",
    ],
  },
  {
    slug: "machine-shrug",
    views: ["front"],
    cues: [
      "Hold both handles with your arms long.",
      "Lift your shoulders toward your ears.",
      "Lower the handles without rolling your shoulders.",
    ],
  },
  {
    slug: "decline-machine-press",
    views: ["front"],
    cues: [
      "Set the seat so the grips start near your lower chest.",
      "Press forward and slightly down.",
      "Return slowly with your back on the pad.",
    ],
  },
  {
    slug: "machine-row",
    views: ["back"],
    cues: [
      "Set the chest pad so you can reach with long arms.",
      "Drive your elbows back while keeping your chest on the pad.",
      "Reach forward slowly to reset.",
    ],
  },
  {
    slug: "leg-press",
    views: ["front"],
    cues: [
      "Plant both feet on the plate and keep your back on the pad.",
      "Press the sled away without locking your knees.",
      "Lower until your knees are deeply bent.",
    ],
  },
  {
    slug: "single-leg-leg-press",
    views: ["front"],
    cues: [
      "Plant one foot on the plate and keep both hips on the pad.",
      "Press through the whole foot with your knee in line with your toes.",
      "Lower slowly without twisting your pelvis.",
    ],
  },
  {
    slug: "leg-extension",
    views: ["front"],
    cues: [
      "Sit with your knees in line with the axle and the rollers on the front of your shins.",
      "Straighten your knees without lifting your hips.",
      "Lower the rollers under control.",
    ],
  },
  {
    slug: "seated-leg-curl",
    views: ["front"],
    cues: [
      "Sit with the rollers behind your lower legs.",
      "Curl your heels under the seat while keeping your thighs still.",
      "Straighten your legs slowly.",
    ],
  },
  {
    slug: "lying-leg-curl",
    views: ["front"],
    cues: [
      "Lie face down with the rollers above your heels.",
      "Curl your heels toward your glutes without lifting your hips.",
      "Lower until your legs are long.",
    ],
  },
  {
    slug: "machine-shoulder-press",
    views: ["front"],
    cues: [
      "Set the seat so the handles start near shoulder height.",
      "Press overhead while keeping your back on the pad.",
      "Lower the handles slowly.",
    ],
  },
  {
    slug: "machine-chest-press",
    views: ["front"],
    cues: [
      "Set the seat so the grips start at chest height.",
      "Keep your back on the pad and press forward.",
      "Return the handles under control.",
    ],
  },
  {
    slug: "incline-machine-press",
    views: ["front"],
    cues: [
      "Sit with your upper back against the inclined pad.",
      "Press up and forward from your upper chest.",
      "Lower slowly to the starting position.",
    ],
  },
  {
    slug: "straight-arm-pulldown",
    views: ["back"],
    cues: [
      "Hinge slightly and start with your arms out in front.",
      "Sweep the bar toward your thighs with soft elbows.",
      "Let your arms rise slowly without standing up.",
    ],
  },
  {
    slug: "single-arm-cable-row",
    views: ["back"],
    cues: [
      "Stand tall and reach toward the cable.",
      "Draw your elbow back and pull the handle toward your side.",
      "Reach forward again without turning your torso.",
    ],
  },
  {
    slug: "cable-shrug",
    views: ["front"],
    cues: [
      "Hold the bar with long arms.",
      "Lift your shoulders straight toward your ears.",
      "Lower your shoulders under control.",
    ],
  },
  {
    slug: "cable-front-raise",
    views: ["front"],
    cues: [
      "Stand facing the low pulley with a soft bend in your elbows.",
      "Raise the bar to shoulder height.",
      "Lower slowly without leaning back.",
    ],
  },
  {
    slug: "reverse-grip-pushdown",
    views: ["back"],
    cues: [
      "Hold the bar with palms up.",
      "Keep your elbows by your sides as you straighten your arms.",
      "Let the bar rise under control.",
    ],
  },
  {
    slug: "single-arm-pushdown",
    views: ["back"],
    cues: [
      "Hold the handle with your elbow at your side.",
      "Straighten your arm without moving the upper arm.",
      "Return the handle slowly.",
    ],
  },
  {
    slug: "cable-lateral-raise",
    views: ["front"],
    cues: [
      "Stand sideways to the low pulley.",
      "Lead with your elbow to raise your arm to shoulder height.",
      "Lower the handle slowly without leaning.",
    ],
  },
  {
    slug: "face-pull",
    views: ["back"],
    cues: [
      "Set the pulley near shoulder height.",
      "Pull the rope toward your face with elbows wide.",
      "Extend your arms slowly to reset.",
    ],
  },
  {
    slug: "seated-cable-row",
    views: ["back"],
    cues: [
      "Plant your feet and sit tall.",
      "Pull the handle toward your lower ribs.",
      "Reach forward under control without rounding your back.",
    ],
  },
  {
    slug: "cable-fly",
    views: ["front"],
    cues: [
      "Start with your arms open and elbows soft.",
      "Sweep the handles together in front of your chest.",
      "Keep the same soft bend as you open your arms.",
    ],
  },
  {
    slug: "cable-curl",
    views: ["front"],
    cues: [
      "Face the low pulley with palms up.",
      "Keep your elbows still as you curl the bar.",
      "Lower the bar without leaning back.",
    ],
  },
  {
    slug: "rope-hammer-curl",
    views: ["front"],
    cues: [
      "Hold the rope with your palms facing in.",
      "Curl the ends up while keeping your elbows still.",
      "Lower slowly until your arms are nearly straight.",
    ],
  },
  {
    slug: "triceps-pushdown",
    views: ["back"],
    cues: [
      "Pin your elbows at your sides.",
      "Press the bar down until your arms are straight.",
      "Let the bar rise without moving your upper arms.",
    ],
  },
  {
    slug: "rope-pushdown",
    views: ["back"],
    cues: [
      "Hold both rope ends with elbows at your sides.",
      "Press down until your arms are straight.",
      "Bring the rope back up under control.",
    ],
  },
  {
    slug: "snatch",
    views: ["front"],
    cues: [
      "Push through the floor with the bar close.",
      "Extend fast and pull under the bar.",
      "Catch in an overhead squat and stand with the bar steady.",
    ],
  },
  {
    slug: "hang-snatch",
    views: ["front"],
    cues: [
      "Hinge with a wide grip and the bar near knee height.",
      "Extend through your legs and keep the bar close.",
      "Catch overhead with straight arms, then stand.",
    ],
  },
  {
    slug: "power-snatch",
    views: ["front"],
    cues: [
      "Start from the floor with a wide grip.",
      "Extend quickly, then guide the bar overhead.",
      "Catch above parallel with straight arms and stand.",
    ],
  },
  {
    slug: "push-jerk",
    views: ["front"],
    cues: [
      "Rack the bar on your shoulders and dip straight down.",
      "Drive up and re-bend your knees to catch with arms straight.",
      "Stand to finish before lowering the bar.",
    ],
  },
  {
    slug: "renegade-row",
    views: ["back"],
    cues: [
      "Set up in a wide-foot plank on the dumbbells.",
      "Row one dumbbell toward your ribs while keeping your hips square.",
      "Set it down before switching sides.",
    ],
  },
  {
    slug: "kettlebell-swing",
    views: ["front"],
    cues: [
      "Grip the bell with both hands and hinge as it sweeps between your thighs.",
      "Snap your hips forward to float the bell to chest height.",
      "Guide it back into the next hinge.",
    ],
  },
  {
    slug: "single-leg-romanian-deadlift",
    views: ["back"],
    cues: [
      "Stand on one leg with a soft bend in the knee.",
      "Hinge as your free leg reaches back and the weights lower.",
      "Keep your hips square as you stand.",
    ],
  },
  {
    slug: "thruster",
    views: ["front"],
    cues: [
      "Rack the bar at shoulder height and squat.",
      "Drive out of the squat and press overhead in one motion.",
      "Lower the bar to the rack before the next squat.",
    ],
  },
  {
    slug: "concentration-curl",
    views: ["front"],
    cues: [
      "Sit wide and brace your upper arm against your inner thigh.",
      "Curl the dumbbell without moving your elbow.",
      "Lower it under control.",
    ],
  },
  {
    slug: "hip-thrust",
    views: ["back"],
    cues: [
      "Rest your upper back on the bench and centre the bar across your hips.",
      "Drive through your feet until your thighs and torso line up.",
      "Lower your hips under control.",
    ],
  },
  {
    slug: "barbell-glute-bridge",
    views: ["back"],
    cues: [
      "Lie with knees bent and the bar across your hips.",
      "Press through your feet and squeeze your glutes to lift your hips.",
      "Lower slowly while keeping your shoulders planted.",
    ],
  },
  {
    slug: "glute-bridge",
    views: ["front"],
    cues: [
      "Lie on your back with your feet flat and knees bent.",
      "Press through your feet to lift your hips.",
      "Pause at the top, then lower slowly.",
    ],
  },
  {
    slug: "dumbbell-calf-raise",
    views: ["back"],
    cues: [
      "Stand tall with a dumbbell in each hand.",
      "Rise onto the balls of both feet.",
      "Lower your heels slowly to the floor.",
    ],
  },
  {
    slug: "seal-row",
    views: ["back"],
    cues: [
      "Lie chest-down on the elevated bench with your arms hanging.",
      "Pull the bar up beneath the bench without lifting your chest.",
      "Lower to long arms.",
    ],
  },
  {
    slug: "zercher-squat",
    views: ["front"],
    cues: [
      "Cradle the bar in your elbow creases.",
      "Squat between your feet with your chest up.",
      "Drive through your feet to stand.",
    ],
  },
  {
    slug: "curtsy-lunge",
    views: ["front"],
    cues: [
      "Step back and diagonally behind your front leg.",
      "Bend both knees with the front foot flat.",
      "Drive through the front leg to return to standing.",
    ],
  },
  {
    slug: "walking-lunge",
    views: ["front"],
    cues: [
      "Step forward and lower your rear knee toward the floor.",
      "Push through the front foot to stand.",
      "Bring the rear leg through into the next step.",
    ],
  },
  {
    slug: "lateral-lunge",
    views: ["front"],
    cues: [
      "Step wide to one side.",
      "Sit back over the stepping leg while keeping the other leg long.",
      "Push off the bent leg to return to centre.",
    ],
  },
  {
    slug: "dumbbell-side-bend",
    views: ["front"],
    cues: [
      "Stand tall with one dumbbell hanging at your side.",
      "Bend sideways toward the weight with your hips still.",
      "Return to upright slowly.",
    ],
  },
  {
    slug: "kettlebell-press",
    views: ["front"],
    cues: [
      "Start with the bells racked at your shoulders.",
      "Press overhead with your ribs down.",
      "Lower the bells smoothly to the rack.",
    ],
  },
  {
    slug: "tate-press",
    views: ["front"],
    cues: [
      "Lie back with the dumbbells over your chest.",
      "Let your elbows flare as the weights lower toward your chest.",
      "Straighten your elbows to press the weights back up.",
    ],
  },
  {
    slug: "farmers-carry",
    views: ["front"],
    cues: [
      "Hold a dumbbell at each side and stand tall.",
      "Take short, steady steps with the weights quiet.",
      "Keep your shoulders level and your gaze forward.",
    ],
  },
  {
    slug: "suitcase-carry",
    views: ["front"],
    cues: [
      "Hold one dumbbell at your side.",
      "Brace and take steady steps with your shoulders level.",
      "Repeat with the weight on the other side.",
    ],
  },
  {
    slug: "landmine-twist",
    views: ["front"],
    cues: [
      "Hold the attachment at chest height with both arms long.",
      "Turn your torso as the weight arcs toward one hip.",
      "Guide it back through centre and repeat on the other side.",
    ],
  },
  {
    slug: "landmine-press",
    views: ["front"],
    cues: [
      "Start with the handle just in front of one shoulder.",
      "Brace and press up and forward along the arc.",
      "Bring the handle back to shoulder height.",
    ],
  },
  {
    slug: "wrist-curl",
    views: ["front"],
    cues: [
      "Rest your forearms on your thighs with your palms up.",
      "Lift your knuckles by moving only your wrists.",
      "Lower slowly to a comfortable stretch.",
    ],
  },
  {
    slug: "reverse-wrist-curl",
    views: ["front"],
    cues: [
      "Rest your forearms on your thighs with your palms down.",
      "Lift your knuckles by moving only your wrists.",
      "Lower slowly to a comfortable stretch.",
    ],
  },
  {
    slug: "dumbbell-wrist-curl",
    views: ["front"],
    cues: [
      "Rest your forearms on your thighs with your palms up.",
      "Lift your knuckles by moving only your wrists.",
      "Lower slowly to a comfortable stretch.",
    ],
  },
  {
    slug: "dumbbell-reverse-wrist-curl",
    views: ["front"],
    cues: [
      "Rest your forearms on your thighs with your palms down.",
      "Lift your knuckles by moving only your wrists.",
      "Lower slowly to a comfortable stretch.",
    ],
  },
  {
    slug: "t-bar-row",
    views: ["back", "front"],
    cues: [
      "Straddle the bar and hinge with a flat back.",
      "Pull the handles toward your lower ribs.",
      "Lower to long arms while holding the hinge.",
    ],
  },
  {
    slug: "meadows-row",
    views: ["back", "front"],
    cues: [
      "Hinge and grip the end of the bar from the side.",
      "Drive your working elbow up and out.",
      "Lower the bar until your arm is long.",
    ],
  },
  {
    slug: "pendlay-row",
    views: ["back", "front"],
    cues: [
      "Hinge until your torso is nearly horizontal.",
      "Row the bar from the floor to your lower ribs.",
      "Return it to a dead stop before each rep.",
    ],
  },
  {
    slug: "preacher-curl",
    views: ["front"],
    cues: [
      "Set your upper arms against the pad.",
      "Curl toward chin height with your upper arms on the pad.",
      "Lower slowly until your arms are nearly straight.",
    ],
  },
  {
    slug: "dumbbell-preacher-curl",
    views: ["front"],
    cues: [
      "Set your upper arms against the pad, palms up.",
      "Curl toward chin height while keeping your elbows still.",
      "Lower slowly to a comfortable stretch.",
    ],
  },
  {
    slug: "zottman-curl",
    views: ["front"],
    cues: [
      "Curl with your palms up and elbows still.",
      "Turn your palms down at the top.",
      "Lower slowly, then turn your palms up again.",
    ],
  },
  {
    slug: "overhead-squat",
    views: ["front"],
    cues: [
      "Lock the bar overhead with a wide grip.",
      "Squat between your heels with your arms straight.",
      "Stand up while keeping the bar over your midfoot.",
    ],
  },
  {
    slug: "deficit-deadlift",
    views: ["back", "front"],
    cues: [
      "Stand on a low platform and grip the bar outside your legs.",
      "Push through the platform and keep the bar close.",
      "Return the plates to the floor under control.",
    ],
  },
  {
    slug: "rack-pull",
    views: ["back", "front"],
    cues: [
      "Set the bar on pins just below your knees.",
      "Brace and stand tall with the bar close to your legs.",
      "Hinge back and let the bar settle on the pins.",
    ],
  },
  {
    slug: "ez-bar-overhead-triceps-extension",
    views: ["back", "front"],
    cues: [
      "Hold the EZ bar overhead with your ribs down.",
      "Keep your upper arms still as the bar lowers behind your head.",
      "Straighten your elbows to return overhead.",
    ],
  },
  {
    slug: "arnold-press",
    views: ["front"],
    cues: [
      "Start with the dumbbells at chin height, palms facing you.",
      "Press overhead as you turn your palms forward.",
      "Lower slowly and turn your palms back toward you.",
    ],
  },
  {
    slug: "front-squat",
    views: ["front"],
    cues: [
      "Rest the bar across your front shoulders and lift your elbows.",
      "Squat to parallel or deeper with your chest tall.",
      "Push through your whole foot to stand.",
    ],
  },
  {
    slug: "overhead-dumbbell-triceps-extension",
    views: ["back", "front"],
    cues: [
      "Cup the top of the dumbbell with both hands overhead.",
      "Bend your elbows to lower the weight behind your head.",
      "Extend your elbows to bring the weight back up.",
    ],
  },
  {
    slug: "upright-row",
    views: ["front"],
    cues: [
      "Stand tall with the bar in front of your thighs.",
      "Lead with your elbows as you pull toward your lower chest.",
      "Lower smoothly along the same path.",
    ],
  },
  {
    slug: "dumbbell-upright-row",
    views: ["front"],
    cues: [
      "Stand tall with the dumbbells in front of your thighs.",
      "Lead with your elbows as you pull toward your lower chest.",
      "Lower smoothly along the same path.",
    ],
  },
  {
    slug: "dumbbell-external-rotation",
    views: ["front"],
    cues: [
      "Lift your upper arms out to the sides and bend your elbows to a right angle.",
      "Rotate the weights upward while keeping your elbows still.",
      "Lower until your forearms point forward again.",
    ],
  },
  {
    slug: "dumbbell-pullover",
    views: ["front"],
    cues: [
      "Lie back and cup one end of the dumbbell above your chest.",
      "Keep a soft elbow bend as you lower the weight behind your head.",
      "Bring the dumbbell back over your chest along the same arc.",
    ],
  },
  {
    slug: "sumo-deadlift",
    views: ["front", "back"],
    cues: [
      "Take a wide stance with your toes turned out and grip inside your knees.",
      "Push the floor away while keeping the bar close.",
      "Stand tall, then hinge and bend your knees to lower the bar.",
    ],
  },
  {
    slug: "cross-body-hammer-curl",
    views: ["front"],
    cues: [
      "Stand tall with palms facing inward.",
      "Curl one weight toward the opposite side of your chest.",
      "Lower under control and switch arms.",
    ],
  },
  {
    slug: "behind-the-neck-press",
    views: ["front"],
    cues: [
      "Take a wide overhand grip with the bar behind your head.",
      "Press straight up as the bar clears your head.",
      "Lower under control to a comfortable depth.",
    ],
  },
  {
    slug: "z-press",
    views: ["front"],
    cues: [
      "Sit tall on the floor with your legs extended.",
      "Press the bar overhead while keeping your torso upright.",
      "Lower it to your shoulders under control.",
    ],
  },
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
      "Cup the upper head of a vertical dumbbell against your sternum.",
      "Keep your heels planted and lower your elbows between your knees.",
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
      "Hold the plate at three and nine o’clock, centred in front of your thighs.",
      "Raise it to shoulder height with its face pointing forward.",
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
