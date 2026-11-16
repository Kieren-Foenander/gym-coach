/**
 * The built-in exercise library. It is plain data in the code, not in the database:
 * a user's own `exercises` row is created the first time they plan or log one, matched by name.
 */

export const MUSCLES = [
  "Chest",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Forearms",
  "Lats",
  "Upper back",
  "Traps",
  "Lower back",
  "Abs",
  "Obliques",
  "Glutes",
  "Quads",
  "Hamstrings",
  "Adductors",
  "Abductors",
  "Calves",
  "Neck",
  "Full body",
  "Cardio",
] as const

export type Muscle = (typeof MUSCLES)[number]

export const EQUIPMENT = [
  "Barbell",
  "Dumbbell",
  "EZ bar",
  "Cable",
  "Machine",
  "Smith machine",
  "Bodyweight",
  "Kettlebell",
  "Band",
  "Trap bar",
  "Plate",
  "Other",
] as const

export type Equipment = (typeof EQUIPMENT)[number]

export interface CatalogExercise {
  /** Stable id for links and render file names: the name in lower case with hyphens. */
  readonly slug: string
  readonly name: string
  readonly equipment: Equipment
  /** The muscles doing most of the work. The first is the group the exercise is filed under. */
  readonly primary: ReadonlyArray<Muscle>
  readonly secondary: ReadonlyArray<Muscle>
  /** Other names people search for. */
  readonly aliases: ReadonlyArray<string>
}

type Row = readonly [
  name: string,
  equipment: Equipment,
  primary: ReadonlyArray<Muscle>,
  secondary: ReadonlyArray<Muscle>,
  aliases?: ReadonlyArray<string>,
]

// Within each block the staples come first: a muscle group is listed in this order.
const ROWS: ReadonlyArray<Row> = [
  // ------------------------------------------------------------ chest
  ["Bench Press", "Barbell", ["Chest"], ["Triceps", "Shoulders"], ["Barbell Bench Press", "Flat Bench Press"]],
  ["Incline Bench Press", "Barbell", ["Chest"], ["Shoulders", "Triceps"], ["Incline Barbell Press"]],
  ["Decline Bench Press", "Barbell", ["Chest"], ["Triceps", "Shoulders"]],
  ["Dumbbell Bench Press", "Dumbbell", ["Chest"], ["Triceps", "Shoulders"], ["Flat Dumbbell Press"]],
  ["Incline Dumbbell Press", "Dumbbell", ["Chest"], ["Shoulders", "Triceps"], ["Incline Dumbbell Bench Press"]],
  ["Decline Dumbbell Press", "Dumbbell", ["Chest"], ["Triceps", "Shoulders"]],
  ["Machine Chest Press", "Machine", ["Chest"], ["Triceps", "Shoulders"], ["Chest Press Machine", "Seated Chest Press"]],
  ["Incline Machine Press", "Machine", ["Chest"], ["Shoulders", "Triceps"], ["Incline Chest Press Machine"]],
  ["Decline Machine Press", "Machine", ["Chest"], ["Triceps", "Shoulders"]],
  ["Smith Machine Bench Press", "Smith machine", ["Chest"], ["Triceps", "Shoulders"]],
  ["Smith Machine Incline Press", "Smith machine", ["Chest"], ["Shoulders", "Triceps"]],
  ["Wide-Grip Bench Press", "Barbell", ["Chest"], ["Shoulders", "Triceps"]],
  ["Paused Bench Press", "Barbell", ["Chest"], ["Triceps", "Shoulders"], ["Pause Bench"]],
  ["Floor Press", "Barbell", ["Chest", "Triceps"], ["Shoulders"]],
  ["Dumbbell Floor Press", "Dumbbell", ["Chest", "Triceps"], ["Shoulders"]],
  ["Dumbbell Squeeze Press", "Dumbbell", ["Chest"], ["Triceps", "Shoulders"], ["Hex Press"]],
  ["Single-Arm Cable Press", "Cable", ["Chest"], ["Triceps", "Shoulders", "Obliques"]],
  ["Dip", "Bodyweight", ["Chest", "Triceps"], ["Shoulders"], ["Chest Dip", "Parallel Bar Dip", "Weighted Dip"]],
  ["Assisted Dip", "Machine", ["Chest", "Triceps"], ["Shoulders"]],
  ["Pec Deck", "Machine", ["Chest"], ["Shoulders"], ["Machine Fly", "Butterfly", "Chest Fly Machine"]],
  ["Cable Fly", "Cable", ["Chest"], ["Shoulders"], ["Cable Crossover", "Standing Cable Fly"]],
  ["High-to-Low Cable Fly", "Cable", ["Chest"], ["Shoulders"], ["Decline Cable Fly", "High Cable Fly"]],
  ["Low-to-High Cable Fly", "Cable", ["Chest"], ["Shoulders"], ["Incline Cable Fly", "Low Cable Fly"]],
  ["Dumbbell Fly", "Dumbbell", ["Chest"], ["Shoulders"], ["Dumbbell Flye", "Chest Fly"]],
  ["Incline Dumbbell Fly", "Dumbbell", ["Chest"], ["Shoulders"], ["Incline Flye"]],
  ["Push-Up", "Bodyweight", ["Chest"], ["Triceps", "Shoulders", "Abs"], ["Pushup", "Press-Up"]],
  ["Incline Push-Up", "Bodyweight", ["Chest"], ["Triceps", "Shoulders"], ["Hands-Elevated Push-Up"]],
  ["Decline Push-Up", "Bodyweight", ["Chest"], ["Shoulders", "Triceps"], ["Feet-Elevated Push-Up"]],
  ["Dumbbell Pullover", "Dumbbell", ["Chest", "Lats"], ["Triceps"], ["Pullover"]],
  ["Svend Press", "Plate", ["Chest"], ["Shoulders"], ["Plate Squeeze Press"]],

  // ------------------------------------------------------------ shoulders
  ["Overhead Press", "Barbell", ["Shoulders"], ["Triceps", "Traps", "Abs"], ["OHP", "Military Press", "Standing Barbell Press", "Shoulder Press"]],
  ["Seated Barbell Press", "Barbell", ["Shoulders"], ["Triceps", "Traps"], ["Seated Overhead Press"]],
  ["Dumbbell Shoulder Press", "Dumbbell", ["Shoulders"], ["Triceps", "Traps"], ["Seated Dumbbell Press", "Dumbbell Overhead Press"]],
  ["Standing Dumbbell Shoulder Press", "Dumbbell", ["Shoulders"], ["Triceps", "Traps", "Abs"]],
  ["Arnold Press", "Dumbbell", ["Shoulders"], ["Triceps", "Traps"]],
  ["Machine Shoulder Press", "Machine", ["Shoulders"], ["Triceps"], ["Shoulder Press Machine"]],
  ["Smith Machine Shoulder Press", "Smith machine", ["Shoulders"], ["Triceps"]],
  ["Push Press", "Barbell", ["Shoulders"], ["Triceps", "Quads", "Glutes"]],
  ["Behind-the-Neck Press", "Barbell", ["Shoulders"], ["Triceps", "Traps"]],
  ["Landmine Press", "Barbell", ["Shoulders", "Chest"], ["Triceps", "Abs"]],
  ["Kettlebell Press", "Kettlebell", ["Shoulders"], ["Triceps", "Abs"], ["Kettlebell Overhead Press"]],
  ["Z Press", "Barbell", ["Shoulders"], ["Triceps", "Abs"]],
  ["Pike Push-Up", "Bodyweight", ["Shoulders"], ["Triceps", "Chest"]],
  ["Handstand Push-Up", "Bodyweight", ["Shoulders"], ["Triceps", "Traps"], ["HSPU"]],
  ["Lateral Raise", "Dumbbell", ["Shoulders"], ["Traps"], ["Dumbbell Lateral Raise", "Side Raise", "Side Lateral Raise"]],
  ["Cable Lateral Raise", "Cable", ["Shoulders"], ["Traps"]],
  ["Machine Lateral Raise", "Machine", ["Shoulders"], ["Traps"]],
  ["Front Raise", "Dumbbell", ["Shoulders"], ["Chest"], ["Dumbbell Front Raise"]],
  ["Cable Front Raise", "Cable", ["Shoulders"], ["Chest"]],
  ["Plate Front Raise", "Plate", ["Shoulders"], ["Chest"]],
  ["Barbell Front Raise", "Barbell", ["Shoulders"], ["Chest"]],
  ["Reverse Fly", "Dumbbell", ["Shoulders", "Upper back"], ["Traps"], ["Rear Delt Fly", "Bent-Over Reverse Fly", "Dumbbell Rear Delt Fly"]],
  ["Reverse Pec Deck", "Machine", ["Shoulders", "Upper back"], ["Traps"], ["Rear Delt Machine Fly", "Reverse Machine Fly"]],
  ["Cable Reverse Fly", "Cable", ["Shoulders", "Upper back"], ["Traps"], ["Cable Rear Delt Fly"]],
  ["Face Pull", "Cable", ["Shoulders", "Upper back"], ["Traps"], ["Cable Face Pull", "Rope Face Pull"]],
  ["Band Face Pull", "Band", ["Shoulders", "Upper back"], ["Traps"]],
  ["Band Pull-Apart", "Band", ["Shoulders", "Upper back"], ["Traps"]],
  ["Upright Row", "Barbell", ["Shoulders", "Traps"], ["Biceps"], ["Barbell Upright Row"]],
  ["Dumbbell Upright Row", "Dumbbell", ["Shoulders", "Traps"], ["Biceps"]],
  ["Cable Upright Row", "Cable", ["Shoulders", "Traps"], ["Biceps"]],
  ["Y Raise", "Dumbbell", ["Shoulders"], ["Traps", "Upper back"], ["Prone Y Raise"]],
  ["Cable External Rotation", "Cable", ["Shoulders"], [], ["Rotator Cuff External Rotation"]],
  ["Dumbbell External Rotation", "Dumbbell", ["Shoulders"], [], ["Side-Lying External Rotation"]],

  // ------------------------------------------------------------ biceps
  ["Barbell Curl", "Barbell", ["Biceps"], ["Forearms"], ["Standing Barbell Curl", "Straight Bar Curl"]],
  ["EZ Bar Curl", "EZ bar", ["Biceps"], ["Forearms"], ["EZ Curl"]],
  ["Dumbbell Curl", "Dumbbell", ["Biceps"], ["Forearms"], ["Bicep Curl", "Biceps Curl", "Standing Dumbbell Curl"]],
  ["Alternating Dumbbell Curl", "Dumbbell", ["Biceps"], ["Forearms"]],
  ["Incline Dumbbell Curl", "Dumbbell", ["Biceps"], ["Forearms"]],
  ["Hammer Curl", "Dumbbell", ["Biceps", "Forearms"], [], ["Dumbbell Hammer Curl", "Neutral-Grip Curl"]],
  ["Cross-Body Hammer Curl", "Dumbbell", ["Biceps", "Forearms"], [], ["Pinwheel Curl"]],
  ["Rope Hammer Curl", "Cable", ["Biceps", "Forearms"], [], ["Cable Hammer Curl"]],
  ["Preacher Curl", "EZ bar", ["Biceps"], ["Forearms"], ["EZ Bar Preacher Curl"]],
  ["Dumbbell Preacher Curl", "Dumbbell", ["Biceps"], ["Forearms"]],
  ["Machine Preacher Curl", "Machine", ["Biceps"], ["Forearms"], ["Preacher Curl Machine"]],
  ["Machine Biceps Curl", "Machine", ["Biceps"], ["Forearms"], ["Biceps Curl Machine"]],
  ["Cable Curl", "Cable", ["Biceps"], ["Forearms"], ["Cable Biceps Curl", "Straight Bar Cable Curl"]],
  ["Bayesian Curl", "Cable", ["Biceps"], ["Forearms"], ["Behind-the-Body Cable Curl"]],
  ["High Cable Curl", "Cable", ["Biceps"], [], ["Overhead Cable Curl", "Crucifix Curl"]],
  ["Concentration Curl", "Dumbbell", ["Biceps"], ["Forearms"]],
  ["Spider Curl", "EZ bar", ["Biceps"], ["Forearms"]],
  ["Drag Curl", "Barbell", ["Biceps"], ["Forearms"]],
  ["Zottman Curl", "Dumbbell", ["Biceps", "Forearms"], []],
  ["Band Curl", "Band", ["Biceps"], ["Forearms"]],

  // ------------------------------------------------------------ triceps
  ["Triceps Pushdown", "Cable", ["Triceps"], [], ["Tricep Pushdown", "Cable Pushdown", "Straight Bar Pushdown"]],
  ["Rope Pushdown", "Cable", ["Triceps"], [], ["Triceps Rope Pushdown", "Rope Pressdown"]],
  ["Reverse-Grip Pushdown", "Cable", ["Triceps"], ["Forearms"], ["Underhand Pushdown"]],
  ["Single-Arm Pushdown", "Cable", ["Triceps"], []],
  ["Overhead Cable Triceps Extension", "Cable", ["Triceps"], [], ["Overhead Rope Extension"]],
  ["Overhead Dumbbell Triceps Extension", "Dumbbell", ["Triceps"], [], ["Dumbbell French Press"]],
  ["EZ Bar Overhead Triceps Extension", "EZ bar", ["Triceps"], [], ["French Press"]],
  ["Skull Crusher", "EZ bar", ["Triceps"], [], ["Lying Triceps Extension", "Skullcrusher"]],
  ["Dumbbell Skull Crusher", "Dumbbell", ["Triceps"], [], ["Lying Dumbbell Triceps Extension"]],
  ["Close-Grip Bench Press", "Barbell", ["Triceps", "Chest"], ["Shoulders"], ["CGBP"]],
  ["JM Press", "Barbell", ["Triceps"], ["Chest"]],
  ["Machine Dip", "Machine", ["Triceps"], ["Chest", "Shoulders"], ["Seated Dip Machine"]],
  ["Bench Dip", "Bodyweight", ["Triceps"], ["Chest", "Shoulders"], ["Triceps Dip"]],
  ["Diamond Push-Up", "Bodyweight", ["Triceps", "Chest"], ["Shoulders"], ["Close-Grip Push-Up"]],
  ["Machine Triceps Extension", "Machine", ["Triceps"], [], ["Triceps Extension Machine"]],
  ["Triceps Kickback", "Dumbbell", ["Triceps"], [], ["Dumbbell Kickback"]],
  ["Cable Triceps Kickback", "Cable", ["Triceps"], []],
  ["Tate Press", "Dumbbell", ["Triceps"], []],
  ["Band Pushdown", "Band", ["Triceps"], []],

  // ------------------------------------------------------------ forearms
  ["Wrist Curl", "Barbell", ["Forearms"], [], ["Barbell Wrist Curl"]],
  ["Dumbbell Wrist Curl", "Dumbbell", ["Forearms"], []],
  ["Reverse Wrist Curl", "Barbell", ["Forearms"], [], ["Wrist Extension"]],
  ["Dumbbell Reverse Wrist Curl", "Dumbbell", ["Forearms"], []],
  ["Reverse Curl", "EZ bar", ["Forearms", "Biceps"], [], ["Overhand Curl", "Reverse-Grip Curl"]],
  ["Farmer's Carry", "Dumbbell", ["Forearms", "Traps"], ["Abs", "Glutes"], ["Farmer's Walk", "Farmers Walk"]],
  ["Dead Hang", "Bodyweight", ["Forearms"], ["Lats"], ["Bar Hang"]],
  ["Wrist Roller", "Other", ["Forearms"], []],
  ["Plate Pinch", "Plate", ["Forearms"], [], ["Pinch Grip Hold"]],
  ["Gripper", "Other", ["Forearms"], [], ["Hand Gripper"]],

  // ------------------------------------------------------------ lats and upper back
  ["Pull-Up", "Bodyweight", ["Lats"], ["Biceps", "Upper back", "Forearms"], ["Pullup", "Overhand Pull-Up", "Weighted Pull-Up"]],
  ["Chin-Up", "Bodyweight", ["Lats", "Biceps"], ["Upper back", "Forearms"], ["Chinup", "Underhand Pull-Up"]],
  ["Neutral-Grip Pull-Up", "Bodyweight", ["Lats"], ["Biceps", "Upper back", "Forearms"]],
  ["Wide-Grip Pull-Up", "Bodyweight", ["Lats"], ["Upper back", "Biceps", "Forearms"]],
  ["Assisted Pull-Up", "Machine", ["Lats"], ["Biceps", "Upper back"], ["Assisted Chin-Up"]],
  ["Lat Pulldown", "Cable", ["Lats"], ["Biceps", "Upper back"], ["Pulldown", "Wide-Grip Lat Pulldown"]],
  ["Close-Grip Lat Pulldown", "Cable", ["Lats"], ["Biceps", "Upper back"], ["V-Bar Pulldown"]],
  ["Neutral-Grip Lat Pulldown", "Cable", ["Lats"], ["Biceps", "Upper back"]],
  ["Reverse-Grip Lat Pulldown", "Cable", ["Lats"], ["Biceps", "Upper back"], ["Underhand Lat Pulldown"]],
  ["Single-Arm Lat Pulldown", "Cable", ["Lats"], ["Biceps"]],
  ["Machine Lat Pulldown", "Machine", ["Lats"], ["Biceps", "Upper back"], ["Plate-Loaded Pulldown"]],
  ["Straight-Arm Pulldown", "Cable", ["Lats"], ["Triceps", "Abs"], ["Cable Pullover", "Lat Pushdown"]],
  ["Machine Pullover", "Machine", ["Lats"], ["Chest", "Triceps"], ["Pullover Machine"]],
  ["Barbell Row", "Barbell", ["Lats", "Upper back"], ["Biceps", "Lower back", "Forearms"], ["Bent-Over Row", "Bent-Over Barbell Row"]],
  ["Pendlay Row", "Barbell", ["Upper back", "Lats"], ["Biceps", "Lower back"]],
  ["Underhand Barbell Row", "Barbell", ["Lats", "Upper back"], ["Biceps", "Lower back"], ["Yates Row", "Reverse-Grip Row"]],
  ["Dumbbell Row", "Dumbbell", ["Lats", "Upper back"], ["Biceps", "Forearms"], ["Single-Arm Dumbbell Row", "One-Arm Row"]],
  ["Seated Cable Row", "Cable", ["Lats", "Upper back"], ["Biceps", "Forearms"], ["Cable Row", "Low Row"]],
  ["Wide-Grip Seated Cable Row", "Cable", ["Upper back", "Lats"], ["Biceps", "Shoulders"]],
  ["Single-Arm Cable Row", "Cable", ["Lats", "Upper back"], ["Biceps", "Obliques"]],
  ["Machine Row", "Machine", ["Lats", "Upper back"], ["Biceps"], ["Seated Row Machine", "Hammer Strength Row"]],
  ["Machine High Row", "Machine", ["Lats", "Upper back"], ["Biceps"], ["High Row"]],
  ["Chest-Supported Row", "Dumbbell", ["Upper back", "Lats"], ["Biceps", "Shoulders"], ["Incline Dumbbell Row"]],
  ["Chest-Supported Machine Row", "Machine", ["Upper back", "Lats"], ["Biceps", "Shoulders"]],
  ["T-Bar Row", "Barbell", ["Upper back", "Lats"], ["Biceps", "Lower back"], ["Landmine Row"]],
  ["Chest-Supported T-Bar Row", "Machine", ["Upper back", "Lats"], ["Biceps"]],
  ["Seal Row", "Barbell", ["Upper back", "Lats"], ["Biceps"], ["Bench Pull"]],
  ["Meadows Row", "Barbell", ["Lats", "Upper back"], ["Biceps", "Forearms"]],
  ["Smith Machine Row", "Smith machine", ["Lats", "Upper back"], ["Biceps", "Lower back"]],
  ["Inverted Row", "Bodyweight", ["Upper back", "Lats"], ["Biceps", "Abs"], ["Bodyweight Row", "Australian Pull-Up", "Ring Row", "TRX Row"]],
  ["Kettlebell Row", "Kettlebell", ["Lats", "Upper back"], ["Biceps"]],
  ["Renegade Row", "Dumbbell", ["Lats", "Abs"], ["Upper back", "Biceps", "Shoulders"]],
  ["Band Row", "Band", ["Upper back", "Lats"], ["Biceps"]],
  ["Muscle-Up", "Bodyweight", ["Lats", "Chest"], ["Triceps", "Biceps", "Abs"]],

  // ------------------------------------------------------------ traps
  ["Barbell Shrug", "Barbell", ["Traps"], ["Forearms"], ["Shrug"]],
  ["Dumbbell Shrug", "Dumbbell", ["Traps"], ["Forearms"]],
  ["Trap Bar Shrug", "Trap bar", ["Traps"], ["Forearms"]],
  ["Smith Machine Shrug", "Smith machine", ["Traps"], ["Forearms"]],
  ["Machine Shrug", "Machine", ["Traps"], ["Forearms"]],
  ["Cable Shrug", "Cable", ["Traps"], ["Forearms"]],
  ["Rack Pull", "Barbell", ["Traps", "Lower back", "Glutes"], ["Hamstrings", "Forearms"], ["Block Pull"]],

  // ------------------------------------------------------------ lower back
  ["Back Extension", "Bodyweight", ["Lower back"], ["Glutes", "Hamstrings"], ["Hyperextension", "45-Degree Back Extension"]],
  ["Machine Back Extension", "Machine", ["Lower back"], ["Glutes"]],
  ["Reverse Hyperextension", "Machine", ["Lower back", "Glutes"], ["Hamstrings"], ["Reverse Hyper"]],
  ["Good Morning", "Barbell", ["Hamstrings", "Lower back"], ["Glutes"]],
  ["Superman", "Bodyweight", ["Lower back"], ["Glutes"]],
  ["Bird Dog", "Bodyweight", ["Lower back", "Abs"], ["Glutes"]],

  // ------------------------------------------------------------ abs
  ["Crunch", "Bodyweight", ["Abs"], []],
  ["Cable Crunch", "Cable", ["Abs"], [], ["Kneeling Cable Crunch"]],
  ["Machine Crunch", "Machine", ["Abs"], [], ["Ab Crunch Machine"]],
  ["Decline Crunch", "Bodyweight", ["Abs"], []],
  ["Sit-Up", "Bodyweight", ["Abs"], [], ["Situp"]],
  ["Decline Sit-Up", "Bodyweight", ["Abs"], []],
  ["Reverse Crunch", "Bodyweight", ["Abs"], []],
  ["Bicycle Crunch", "Bodyweight", ["Abs", "Obliques"], []],
  ["Hanging Knee Raise", "Bodyweight", ["Abs"], ["Forearms"]],
  ["Hanging Leg Raise", "Bodyweight", ["Abs"], ["Forearms"]],
  ["Captain's Chair Leg Raise", "Bodyweight", ["Abs"], [], ["Vertical Knee Raise", "Roman Chair Leg Raise"]],
  ["Lying Leg Raise", "Bodyweight", ["Abs"], []],
  ["Toes-to-Bar", "Bodyweight", ["Abs"], ["Forearms", "Lats"]],
  ["Plank", "Bodyweight", ["Abs"], ["Obliques", "Shoulders"], ["Front Plank"]],
  ["Ab Wheel Rollout", "Other", ["Abs"], ["Lats", "Shoulders"], ["Ab Rollout", "Ab Wheel"]],
  ["Dead Bug", "Bodyweight", ["Abs"], []],
  ["Hollow Hold", "Bodyweight", ["Abs"], [], ["Hollow Body Hold"]],
  ["V-Up", "Bodyweight", ["Abs"], [], ["Jackknife"]],
  ["Mountain Climber", "Bodyweight", ["Abs"], ["Shoulders", "Quads"]],
  ["Flutter Kick", "Bodyweight", ["Abs"], []],
  ["L-Sit", "Bodyweight", ["Abs"], ["Triceps", "Quads"]],
  ["Dragon Flag", "Bodyweight", ["Abs"], ["Lats"]],

  // ------------------------------------------------------------ obliques
  ["Russian Twist", "Bodyweight", ["Obliques"], ["Abs"]],
  ["Side Plank", "Bodyweight", ["Obliques"], ["Abs", "Shoulders"]],
  ["Cable Woodchopper", "Cable", ["Obliques"], ["Abs", "Shoulders"], ["Wood Chop", "Cable Chop"]],
  ["Pallof Press", "Cable", ["Obliques", "Abs"], []],
  ["Dumbbell Side Bend", "Dumbbell", ["Obliques"], [], ["Side Bend"]],
  ["Oblique Crunch", "Bodyweight", ["Obliques"], ["Abs"], ["Side Crunch"]],
  ["Landmine Twist", "Barbell", ["Obliques"], ["Abs", "Shoulders"], ["Landmine Rotation", "Landmine 180"]],
  ["Suitcase Carry", "Dumbbell", ["Obliques"], ["Forearms", "Traps"]],
  ["Machine Torso Rotation", "Machine", ["Obliques"], ["Abs"], ["Rotary Torso"]],

  // ------------------------------------------------------------ glutes
  ["Hip Thrust", "Barbell", ["Glutes"], ["Hamstrings"], ["Barbell Hip Thrust"]],
  ["Machine Hip Thrust", "Machine", ["Glutes"], ["Hamstrings"], ["Hip Thrust Machine"]],
  ["Single-Leg Hip Thrust", "Bodyweight", ["Glutes"], ["Hamstrings"]],
  ["Glute Bridge", "Bodyweight", ["Glutes"], ["Hamstrings"]],
  ["Barbell Glute Bridge", "Barbell", ["Glutes"], ["Hamstrings"]],
  ["Deadlift", "Barbell", ["Glutes", "Hamstrings"], ["Quads", "Adductors", "Lower back", "Lats", "Traps", "Forearms"], ["Conventional Deadlift", "Barbell Deadlift"]],
  ["Sumo Deadlift", "Barbell", ["Glutes", "Hamstrings"], ["Quads", "Adductors", "Lower back", "Traps", "Forearms"]],
  ["Trap Bar Deadlift", "Trap bar", ["Glutes", "Quads"], ["Hamstrings", "Lower back", "Traps", "Forearms"], ["Hex Bar Deadlift"]],
  ["Deficit Deadlift", "Barbell", ["Glutes", "Hamstrings"], ["Quads", "Lower back", "Traps", "Forearms"]],
  ["Cable Pull-Through", "Cable", ["Glutes", "Hamstrings"], ["Lower back"], ["Pull-Through"]],
  ["Cable Kickback", "Cable", ["Glutes"], ["Hamstrings"], ["Glute Kickback", "Cable Glute Kickback"]],
  ["Machine Glute Kickback", "Machine", ["Glutes"], ["Hamstrings"]],
  ["Kettlebell Swing", "Kettlebell", ["Glutes", "Hamstrings"], ["Lower back", "Shoulders", "Abs"], ["Russian Swing"]],
  ["Step-Up", "Dumbbell", ["Glutes", "Quads"], ["Hamstrings"]],
  ["Curtsy Lunge", "Dumbbell", ["Glutes", "Quads"], ["Adductors"]],
  ["Donkey Kick", "Bodyweight", ["Glutes"], ["Hamstrings"]],

  // ------------------------------------------------------------ quads
  ["Squat", "Barbell", ["Quads", "Glutes"], ["Hamstrings", "Adductors", "Lower back"], ["Back Squat", "Barbell Squat", "High-Bar Squat", "Low-Bar Squat"]],
  ["Front Squat", "Barbell", ["Quads"], ["Glutes", "Abs", "Upper back"]],
  ["Paused Squat", "Barbell", ["Quads", "Glutes"], ["Hamstrings", "Adductors", "Lower back"], ["Pause Squat"]],
  ["Box Squat", "Barbell", ["Quads", "Glutes"], ["Hamstrings", "Lower back"]],
  ["Safety Bar Squat", "Other", ["Quads", "Glutes"], ["Hamstrings", "Upper back", "Lower back"], ["SSB Squat"]],
  ["Zercher Squat", "Barbell", ["Quads", "Glutes"], ["Abs", "Upper back", "Biceps"]],
  ["Overhead Squat", "Barbell", ["Quads", "Glutes"], ["Shoulders", "Abs", "Upper back"]],
  ["Goblet Squat", "Dumbbell", ["Quads", "Glutes"], ["Abs", "Adductors"], ["Kettlebell Goblet Squat"]],
  ["Smith Machine Squat", "Smith machine", ["Quads", "Glutes"], ["Hamstrings", "Adductors"]],
  ["Hack Squat", "Machine", ["Quads"], ["Glutes", "Adductors"], ["Hack Squat Machine"]],
  ["Pendulum Squat", "Machine", ["Quads"], ["Glutes"]],
  ["Belt Squat", "Machine", ["Quads", "Glutes"], ["Adductors"]],
  ["Leg Press", "Machine", ["Quads", "Glutes"], ["Hamstrings", "Adductors"], ["45-Degree Leg Press", "Seated Leg Press"]],
  ["Single-Leg Leg Press", "Machine", ["Quads", "Glutes"], ["Hamstrings", "Adductors"]],
  ["Leg Extension", "Machine", ["Quads"], [], ["Quad Extension", "Knee Extension"]],
  ["Bulgarian Split Squat", "Dumbbell", ["Quads", "Glutes"], ["Hamstrings", "Adductors"], ["Rear-Foot-Elevated Split Squat", "RFESS"]],
  ["Split Squat", "Dumbbell", ["Quads", "Glutes"], ["Hamstrings", "Adductors"]],
  ["Walking Lunge", "Dumbbell", ["Quads", "Glutes"], ["Hamstrings", "Adductors"]],
  ["Reverse Lunge", "Dumbbell", ["Quads", "Glutes"], ["Hamstrings", "Adductors"]],
  ["Forward Lunge", "Dumbbell", ["Quads", "Glutes"], ["Hamstrings", "Adductors"], ["Lunge", "Dumbbell Lunge"]],
  ["Barbell Lunge", "Barbell", ["Quads", "Glutes"], ["Hamstrings", "Adductors"]],
  ["Lateral Lunge", "Dumbbell", ["Quads", "Adductors"], ["Glutes"], ["Side Lunge"]],
  ["Sissy Squat", "Bodyweight", ["Quads"], []],
  ["Bodyweight Squat", "Bodyweight", ["Quads", "Glutes"], ["Hamstrings"], ["Air Squat"]],
  ["Pistol Squat", "Bodyweight", ["Quads", "Glutes"], ["Hamstrings", "Abs"], ["Single-Leg Squat"]],
  ["Jump Squat", "Bodyweight", ["Quads", "Glutes"], ["Calves"], ["Squat Jump"]],
  ["Box Jump", "Other", ["Quads", "Glutes"], ["Calves", "Hamstrings"]],
  ["Wall Sit", "Bodyweight", ["Quads"], ["Glutes"]],
  ["Sled Push", "Other", ["Quads", "Glutes"], ["Calves", "Hamstrings"], ["Prowler Push"]],

  // ------------------------------------------------------------ hamstrings
  ["Romanian Deadlift", "Barbell", ["Hamstrings", "Glutes"], ["Lower back", "Forearms"], ["RDL", "Barbell RDL"]],
  ["Dumbbell Romanian Deadlift", "Dumbbell", ["Hamstrings", "Glutes"], ["Lower back", "Forearms"], ["Dumbbell RDL"]],
  ["Single-Leg Romanian Deadlift", "Dumbbell", ["Hamstrings", "Glutes"], ["Lower back", "Abs"], ["Single-Leg RDL"]],
  ["Stiff-Leg Deadlift", "Barbell", ["Hamstrings", "Glutes"], ["Lower back", "Forearms"], ["Straight-Leg Deadlift", "SLDL"]],
  ["Leg Curl", "Machine", ["Hamstrings"], ["Calves"], ["Hamstring Curl"]],
  ["Seated Leg Curl", "Machine", ["Hamstrings"], ["Calves"]],
  ["Lying Leg Curl", "Machine", ["Hamstrings"], ["Calves"], ["Prone Leg Curl"]],
  ["Standing Leg Curl", "Machine", ["Hamstrings"], ["Calves"], ["Single-Leg Curl"]],
  ["Nordic Curl", "Bodyweight", ["Hamstrings"], ["Glutes", "Calves"], ["Nordic Hamstring Curl"]],
  ["Glute-Ham Raise", "Other", ["Hamstrings", "Glutes"], ["Calves", "Lower back"], ["GHR"]],
  ["Stability Ball Leg Curl", "Other", ["Hamstrings"], ["Glutes"], ["Swiss Ball Leg Curl"]],

  // ------------------------------------------------------------ adductors
  ["Hip Adduction", "Machine", ["Adductors"], [], ["Adductor Machine", "Inner Thigh Machine"]],
  ["Cable Hip Adduction", "Cable", ["Adductors"], []],
  ["Copenhagen Plank", "Bodyweight", ["Adductors"], ["Obliques", "Abs"]],
  ["Cossack Squat", "Bodyweight", ["Adductors", "Quads"], ["Glutes"]],
  ["Sumo Squat", "Dumbbell", ["Adductors", "Quads", "Glutes"], [], ["Plie Squat"]],

  // ------------------------------------------------------------ abductors
  ["Hip Abduction", "Machine", ["Abductors"], ["Glutes"], ["Abductor Machine", "Outer Thigh Machine"]],
  ["Cable Hip Abduction", "Cable", ["Abductors"], ["Glutes"]],
  ["Banded Lateral Walk", "Band", ["Abductors"], ["Glutes"], ["Monster Walk", "Lateral Band Walk"]],
  ["Clamshell", "Band", ["Abductors"], ["Glutes"]],
  ["Side-Lying Leg Raise", "Bodyweight", ["Abductors"], ["Glutes"]],
  ["Fire Hydrant", "Bodyweight", ["Abductors", "Glutes"], []],

  // ------------------------------------------------------------ calves
  ["Standing Calf Raise", "Machine", ["Calves"], [], ["Calf Raise"]],
  ["Seated Calf Raise", "Machine", ["Calves"], []],
  ["Leg Press Calf Raise", "Machine", ["Calves"], [], ["Calf Press"]],
  ["Smith Machine Calf Raise", "Smith machine", ["Calves"], []],
  ["Dumbbell Calf Raise", "Dumbbell", ["Calves"], []],
  ["Single-Leg Calf Raise", "Bodyweight", ["Calves"], []],
  ["Donkey Calf Raise", "Machine", ["Calves"], []],
  ["Tibialis Raise", "Bodyweight", ["Calves"], [], ["Tib Raise"]],

  // ------------------------------------------------------------ neck
  ["Neck Curl", "Plate", ["Neck"], [], ["Neck Flexion"]],
  ["Neck Extension", "Plate", ["Neck"], ["Traps"]],

  // ------------------------------------------------------------ full body
  ["Power Clean", "Barbell", ["Full body"], ["Glutes", "Quads", "Hamstrings", "Traps"]],
  ["Clean", "Barbell", ["Full body"], ["Glutes", "Quads", "Hamstrings", "Traps"], ["Squat Clean"]],
  ["Hang Clean", "Barbell", ["Full body"], ["Glutes", "Quads", "Hamstrings", "Traps"]],
  ["Clean and Jerk", "Barbell", ["Full body"], ["Glutes", "Quads", "Shoulders", "Traps"]],
  ["Clean and Press", "Barbell", ["Full body"], ["Glutes", "Quads", "Shoulders", "Triceps"]],
  ["Push Jerk", "Barbell", ["Full body"], ["Shoulders", "Triceps", "Quads"], ["Jerk", "Split Jerk"]],
  ["Snatch", "Barbell", ["Full body"], ["Glutes", "Quads", "Shoulders", "Traps"], ["Squat Snatch"]],
  ["Power Snatch", "Barbell", ["Full body"], ["Glutes", "Quads", "Shoulders", "Traps"]],
  ["Hang Snatch", "Barbell", ["Full body"], ["Glutes", "Quads", "Shoulders", "Traps"]],
  ["Thruster", "Barbell", ["Full body"], ["Quads", "Glutes", "Shoulders", "Triceps"]],
  ["Dumbbell Snatch", "Dumbbell", ["Full body"], ["Glutes", "Shoulders", "Traps"]],
  ["Kettlebell Snatch", "Kettlebell", ["Full body"], ["Glutes", "Hamstrings", "Shoulders"]],
  ["Turkish Get-Up", "Kettlebell", ["Full body"], ["Shoulders", "Abs", "Glutes"], ["TGU"]],
  ["Man Maker", "Dumbbell", ["Full body"], ["Chest", "Lats", "Shoulders", "Quads"]],
  ["Burpee", "Bodyweight", ["Full body"], ["Chest", "Quads", "Abs"]],
  ["Bear Crawl", "Bodyweight", ["Full body"], ["Shoulders", "Abs", "Quads"]],
  ["Sled Pull", "Other", ["Full body"], ["Hamstrings", "Glutes", "Lats"], ["Sled Drag"]],
  ["Medicine Ball Slam", "Other", ["Full body"], ["Abs", "Lats", "Shoulders"], ["Ball Slam"]],
  ["Wall Ball", "Other", ["Full body"], ["Quads", "Glutes", "Shoulders"]],

  // ------------------------------------------------------------ cardio, logged by time and distance
  ["Treadmill Run", "Machine", ["Cardio"], ["Quads", "Hamstrings", "Calves"], ["Treadmill", "Running Machine"]],
  ["Outdoor Run", "Bodyweight", ["Cardio"], ["Quads", "Hamstrings", "Calves"], ["Run", "Running", "Jog"]],
  ["Incline Treadmill Walk", "Machine", ["Cardio"], ["Glutes", "Calves", "Hamstrings"], ["Incline Walk", "12-3-30"]],
  ["Walk", "Bodyweight", ["Cardio"], ["Calves", "Glutes"], ["Walking"]],
  ["Hike", "Bodyweight", ["Cardio"], ["Glutes", "Quads", "Calves"], ["Hiking"]],
  ["Sprint Intervals", "Bodyweight", ["Cardio"], ["Hamstrings", "Glutes", "Quads", "Calves"], ["Sprints"]],
  ["Stationary Bike", "Machine", ["Cardio"], ["Quads", "Glutes", "Calves"], ["Exercise Bike", "Spin Bike", "Indoor Cycling"]],
  ["Recumbent Bike", "Machine", ["Cardio"], ["Quads", "Glutes"]],
  ["Air Bike", "Machine", ["Cardio"], ["Quads", "Shoulders", "Glutes"], ["Assault Bike", "Echo Bike", "Fan Bike"]],
  ["Outdoor Cycling", "Other", ["Cardio"], ["Quads", "Glutes", "Calves"], ["Cycling", "Bike Ride"]],
  ["Rowing Machine", "Machine", ["Cardio"], ["Lats", "Upper back", "Quads", "Glutes"], ["Rower", "Erg", "Indoor Rowing"]],
  ["Elliptical", "Machine", ["Cardio"], ["Quads", "Glutes", "Calves"], ["Cross Trainer"]],
  ["Stair Climber", "Machine", ["Cardio"], ["Glutes", "Quads", "Calves"], ["StairMaster", "Step Mill", "Stepper"]],
  ["Ski Erg", "Machine", ["Cardio"], ["Lats", "Triceps", "Abs"], ["SkiErg"]],
  ["Swimming", "Bodyweight", ["Cardio"], ["Lats", "Shoulders", "Abs"], ["Swim", "Laps"]],
  ["Jump Rope", "Other", ["Cardio"], ["Calves", "Shoulders", "Forearms"], ["Skipping", "Skipping Rope"]],
  ["Battle Ropes", "Other", ["Cardio"], ["Shoulders", "Abs", "Forearms"], ["Battle Rope"]],
  ["Jumping Jacks", "Bodyweight", ["Cardio"], ["Calves", "Shoulders"], ["Star Jumps"]],
]

export const slugFor = (name: string): string =>
  name
    .toLowerCase()
    .replaceAll("'", "")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")

export const CATALOG: ReadonlyArray<CatalogExercise> = ROWS.map(([name, equipment, primary, secondary, aliases]) => ({
  slug: slugFor(name),
  name,
  equipment,
  primary,
  secondary,
  aliases: aliases ?? [],
}))

const BY_NAME = new Map(CATALOG.map((entry) => [entry.name.toLowerCase(), entry]))
const BY_SLUG = new Map(CATALOG.map((entry) => [entry.slug, entry]))

/** The library entry with exactly this name, ignoring case. Aliases do not count. */
export const catalogByName = (name: string): CatalogExercise | null => BY_NAME.get(name.trim().toLowerCase()) ?? null

export const catalogBySlug = (slug: string): CatalogExercise | null => BY_SLUG.get(slug) ?? null

/** The group an exercise is filed under: the library's when it knows the name, otherwise the one stored. */
export const muscleGroupFor = (name: string, stored: string): string => catalogByName(name)?.primary[0] ?? stored

/** Whether an exercise is logged by time and distance instead of weight and reps. */
export const isCardio = (name: string): boolean => catalogByName(name)?.primary[0] === "Cardio"

/** Library entries that work this muscle as a primary mover. */
export const catalogForMuscle = (muscle: Muscle): ReadonlyArray<CatalogExercise> =>
  CATALOG.filter((entry) => entry.primary.includes(muscle))

/** An exercise the user has planned or logged, as the server lists them. */
export interface KnownExercise {
  readonly id: number
  readonly name: string
  readonly muscleGroup: string
  readonly lastPerformedAt: number | null
}

/** One line in a list of exercises: a library entry, the user's own exercise, or both when they have used a library one. */
export interface LibraryItem {
  readonly name: string
  readonly entry: CatalogExercise | null
  readonly known: KnownExercise | null
}

/** The library with the user's exercises laid over it. Exercises the library does not have go at the end. */
export const mergeLibrary = (known: ReadonlyArray<KnownExercise>): ReadonlyArray<LibraryItem> => {
  const mine = new Map(known.map((exercise) => [exercise.name.toLowerCase(), exercise]))

  const builtIn = CATALOG.map(
    (entry): LibraryItem => ({ name: entry.name, entry, known: mine.get(entry.name.toLowerCase()) ?? null }),
  )

  const own = known.flatMap((exercise): ReadonlyArray<LibraryItem> =>
    catalogByName(exercise.name) ? [] : [{ name: exercise.name, entry: null, known: exercise }],
  )

  return [...builtIn, ...own]
}

const words = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll("'", "")
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim()

/** How well an item answers a search, lower being better. Null when it does not match. */
const rank = (item: LibraryItem, query: string): number | null => {
  const name = words(item.name)
  const tokens = query.split(" ")

  if (name === query) return 0

  if (name.startsWith(query)) return 1

  if (tokens.every((token) => name.includes(token))) return 2

  const aliases = (item.entry?.aliases ?? []).map(words)

  if (aliases.some((alias) => alias === query || alias.replaceAll(" ", "") === query)) return 3

  if (aliases.some((alias) => tokens.every((token) => alias.includes(token)))) return 4

  const everything = words(
    [item.name, ...aliases, item.entry?.equipment ?? "", ...(item.entry?.primary ?? []), item.known?.muscleGroup ?? ""].join(" "),
  )

  return tokens.every((token) => everything.includes(token)) ? 5 : null
}

/**
 * Finds exercises by name, alias, equipment or muscle. Every word typed has to appear somewhere.
 * Best matches first; ties keep the order given.
 */
export const searchLibrary = (items: ReadonlyArray<LibraryItem>, text: string): ReadonlyArray<LibraryItem> => {
  const query = words(text)

  if (query === "") return items

  return items
    .flatMap((item) => {
      const score = rank(item, query)

      return score === null ? [] : [{ item, score }]
    })
    .toSorted((a, b) => a.score - b.score)
    .map((match) => match.item)
}
