/**
 * Turns a Gymverse export into `seed/training-history.json`.
 *
 *   bun tools/seed/from-gymverse.ts <gymverse.sqlite> [out.json]
 *
 * The input is the SQLite file made from the Gymverse app's files in an iPhone backup, with tables
 * `workouts` and `sets` (times are local Brisbane time, weights are kg). Gymverse's exercise names
 * are mapped onto the app's library so they show muscles and demonstrations. A Gymverse exercise
 * with no close library match keeps a name of its own, listed in CUSTOM.
 */
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { catalogByName } from "../../src/domain/catalog"
import type { History, HistoryExercise, HistorySet, HistoryWorkout } from "./history"

/** Gymverse name → library name. Grip and stance variants of one lift go to that lift. */
const LIBRARY = {
  "Barbell Back Squat": "Squat",
  "Barbell Bench Press": "Bench Press",
  "Barbell Bench Press, Close Grip": "Close-Grip Bench Press",
  "Barbell Deadlift": "Deadlift",
  "Barbell Hip Thrust": "Hip Thrust",
  "Barbell Romanian Deadlift": "Romanian Deadlift",
  "Barbell Staggered Stance Good Morning": "Good Morning",
  "Barbell Upright Row": "Upright Row",
  "Bench Dips": "Bench Dip",
  "Bent Over Barbell Row, Overhand Grip": "Barbell Row",
  "Bent Over Barbell Row, Underhand Grip": "Underhand Barbell Row",
  "Cable Face Pull": "Face Pull",
  "Cable Tricep Kick Back, Single Arm": "Cable Triceps Kickback",
  "Cable Upright Row, Rope": "Cable Upright Row",
  "Calf Raise Machine": "Standing Calf Raise",
  "Chest Fly Machine": "Pec Deck",
  "Chest Supported Dumbbell Row": "Chest-Supported Row",
  "Concentration Curl": "Concentration Curl",
  Dips: "Dip",
  "Dips, Weighted": "Dip",
  "Dumbbell Bench Press": "Dumbbell Bench Press",
  "Dumbbell Bent Over Reverse Fly": "Reverse Fly",
  "Dumbbell Fly": "Dumbbell Fly",
  "Dumbbell Incline Prone Reverse Fly": "Reverse Fly",
  "Dumbbell Preacher Curl": "Dumbbell Preacher Curl",
  "Dumbbell Preacher Curl, Single Arm": "Dumbbell Preacher Curl",
  "Dumbbell Skull Crusher": "Dumbbell Skull Crusher",
  "Dumbbell Skull Crusher, Behind Head": "Dumbbell Skull Crusher",
  "Dumbbell Step Up": "Step-Up",
  "Dumbbell Walking Lunges": "Walking Lunge",
  "Elliptical Machine": "Elliptical",
  "EZ Bar Preacher Curl": "Preacher Curl",
  "EZ Bar Skull Crusher": "Skull Crusher",
  "EZ Bar Skull Crusher, Behind Head": "Skull Crusher",
  "EZ Bar Standing Barbell Curl, Narrow Grip": "EZ Bar Curl",
  "EZ Bar Standing Barbell Curl, Wide Grip": "EZ Bar Curl",
  "EZ Bar Upright Row": "Upright Row",
  "Floor Back Extension": "Superman",
  "Goblet Squat": "Goblet Squat",
  "H Bar Skull Crusher": "Skull Crusher",
  "Hack Squat": "Hack Squat",
  "Hanging Knee Raise, Ab Station": "Hanging Knee Raise",
  "Hanging Leg Raise, Ab Station": "Captain's Chair Leg Raise",
  "High Cable Fly": "High-to-Low Cable Fly",
  "Incline Barbell Bench Press": "Incline Bench Press",
  "Incline Dumbbell Bench Press": "Incline Dumbbell Press",
  "Incline Dumbbell Curl": "Incline Dumbbell Curl",
  "Incline Dumbbell Fly": "Incline Dumbbell Fly",
  "Incline Dumbbell Hammer Curl": "Hammer Curl",
  "Leg Extension": "Leg Extension",
  "Leg Press": "Leg Press",
  "Low Cable Fly": "Low-to-High Cable Fly",
  "Lying Leg Curl Machine": "Lying Leg Curl",
  "Machine Supported Dips": "Assisted Dip",
  "Machine Supported Pull Ups, Overhand Grip": "Assisted Pull-Up",
  "Machine Supported Pull Ups, Wide Grip": "Assisted Pull-Up",
  "Medium Cable Fly": "Cable Fly",
  "Neutral Grip Lat Pulldown": "Neutral-Grip Lat Pulldown",
  "Neutral Grip Pull Up": "Neutral-Grip Pull-Up",
  "Neutral Grip Pull Up, Weighted": "Neutral-Grip Pull-Up",
  "Overhand Grip Lat Pulldown": "Lat Pulldown",
  "Overhand Grip Plate Loaded Lat Pulldown": "Machine Lat Pulldown",
  "Overhand Grip Pull Up": "Pull-Up",
  "Plate Loaded Chest Supported Row Machine, Neutral Grip, Narrow": "Chest-Supported Machine Row",
  "Plate Loaded Chest Supported Row Machine, Overhand, Wide": "Chest-Supported Machine Row",
  "Plate Loaded Incline Chest Press Machine": "Incline Machine Press",
  "Plate Loaded Machine Overhead Press": "Machine Shoulder Press",
  "Push Up": "Push-Up",
  "Push Up, Close Grip": "Diamond Push-Up",
  "Rear Delt Machine": "Reverse Pec Deck",
  "Roman Chair Back Extension": "Back Extension",
  Running: "Treadmill Run",
  "Russian Twist": "Russian Twist",
  "Seated Barbell Behind The Neck Press": "Behind-the-Neck Press",
  "Seated Barbell Overhead Press": "Seated Barbell Press",
  "Seated Cable Row, Neutral Grip": "Seated Cable Row",
  "Seated Cable Row, Wide Grip": "Wide-Grip Seated Cable Row",
  "Seated Dumbbell Curl": "Dumbbell Curl",
  "Seated Dumbbell Curl, Alternating": "Alternating Dumbbell Curl",
  "Seated Dumbbell Hammer Curl": "Hammer Curl",
  "Seated Dumbbell Lateral Raise": "Lateral Raise",
  "Seated Dumbbell Overhead Press": "Dumbbell Shoulder Press",
  "Seated Dumbbell Overhead Tricep Extensions": "Overhead Dumbbell Triceps Extension",
  "Seated Leg Curl Machine": "Seated Leg Curl",
  "seated dips": "Machine Dip",
  "Selector Chest Press Machine": "Machine Chest Press",
  "Selector Chest Supported Row Machine, Neutral Grip, Narrow": "Chest-Supported Machine Row",
  "Selector Chest Supported Row Machine, Wide Grip": "Chest-Supported Machine Row",
  "Selector Overhead Press Machine, Narrow": "Machine Shoulder Press",
  "Single Arm Cable Lateral Raise": "Cable Lateral Raise",
  "Single Arm Cable Reverse Fly": "Cable Reverse Fly",
  "Single Arm Dumbbell Row": "Dumbbell Row",
  "Single Leg Lying Leg Curl Machine": "Lying Leg Curl",
  "Single Leg Press": "Single-Leg Leg Press",
  "Situps, Weighted": "Sit-Up",
  "Smith Machine Bench Press": "Smith Machine Bench Press",
  "Smith Machine Incline Bench Press": "Smith Machine Incline Press",
  "Smith Machine Overhead Press, Seated": "Smith Machine Shoulder Press",
  "Smith Machine Squat": "Smith Machine Squat",
  "Standing Barbell Overhead Press": "Overhead Press",
  "Standing Behind Back Barbell Wrist Curl": "Wrist Curl",
  "Standing Cable Curl": "Cable Curl",
  "Standing Cable Overhead Tricep Extension, Rope": "Overhead Cable Triceps Extension",
  "Standing Cable Overhead Tricep Extensions, Straight Bar": "Overhead Cable Triceps Extension",
  "Standing Cable Pullover Bar": "Straight-Arm Pulldown",
  "Standing Cable Pullover Rope": "Straight-Arm Pulldown",
  "Standing Cable Tricep Pushdown, Rope": "Rope Pushdown",
  "Standing Cable Tricep Pushdown, Single Arm": "Single-Arm Pushdown",
  "Standing Cable Tricep Pushdown, Straight Bar": "Triceps Pushdown",
  "Standing Calf Raise, Weighted": "Dumbbell Calf Raise",
  "Standing Dumbbell Curl": "Dumbbell Curl",
  "Standing Dumbbell Front Raise": "Front Raise",
  "Standing Dumbbell Hammer Curl": "Hammer Curl",
  "Standing Dumbbell Lateral Raise": "Lateral Raise",
  "Standing Dumbbell Overhead Press": "Standing Dumbbell Shoulder Press",
  "Standing Dumbbell Overhead Tricep Extensions": "Overhead Dumbbell Triceps Extension",
  "Standing Straight Bar Barbell Curl": "Barbell Curl",
  "TBar Row": "T-Bar Row",
  "Underhand Grip Lat Pulldown": "Reverse-Grip Lat Pulldown",
  "Underhand Grip Pull Up": "Chin-Up",
  "Wide Grip Lat Pulldown": "Lat Pulldown",
  "Wide Grip Pull Up": "Wide-Grip Pull-Up",
} as const satisfies Record<string, string>

/** Gymverse name → [own name, muscle group], for lifts the library has nothing close to. */
const CUSTOM = {
  "Dumbbell Hammer Preacher Curl": ["Hammer Preacher Curl", "Biceps"],
  "Incline Barbell Bench Press, Close Grip": ["Close-Grip Incline Bench Press", "Chest"],
  "Seated Cable Russian Twist": ["Cable Russian Twist", "Obliques"],
  "Seated Dumbbell Overhead Tricep Extensions, Single Arm": ["Single-Arm Overhead Dumbbell Triceps Extension", "Triceps"],
  "Standing Dumbbell Overhead Press, Single Arm": ["Single-Arm Dumbbell Shoulder Press", "Shoulders"],
} as const satisfies Record<string, readonly [string, string]>

/** Sets typed wrong in Gymverse, by workout start, Gymverse exercise and set number. */
const TYPOS: ReadonlyArray<{ startedAt: string; exercise: string; setNo: number; weight: number }> = [
  // 125 kg among 12.5 kg sets: a missed decimal point.
  { startedAt: "2023-11-06 15:33:30", exercise: "Standing Cable Overhead Tricep Extension, Rope", setNo: 4, weight: 12.5 },
]

const NOTES = "Imported from Gymverse."
const OFFSET = "+10:00" // Brisbane, which has no daylight saving.
const BRISBANE_MS = 10 * 3_600_000

interface WorkoutRow {
  workout_no: number
  workout_name: string
  plan_name: string
  started_at: string
  duration_min: number
}

interface SetRow {
  workout_no: number
  exercise_order: number
  exercise: string
  set_no: number
  set_type: "weight" | "bodyWeight" | "longTime"
  weight_kg: number | null
  reps: number | null
  seconds: number | null
  user_rir: number | null
}

const query = <Row>(file: string, sql: string): ReadonlyArray<Row> =>
  JSON.parse(execFileSync("sqlite3", ["-json", "-readonly", file, sql], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) || "[]")

const library: ReadonlyMap<string, string> = new Map(Object.entries(LIBRARY))
const custom: ReadonlyMap<string, readonly [string, string]> = new Map(Object.entries(CUSTOM))

const nameFor = (gymverse: string): string => {
  const own = custom.get(gymverse)?.[0] ?? library.get(gymverse)

  if (!own) throw new Error(`No mapping for the Gymverse exercise "${gymverse}". Add it to LIBRARY or CUSTOM.`)

  if (!custom.has(gymverse) && !catalogByName(own)) throw new Error(`"${own}" is not a library name`)

  return own
}

const iso = (local: string) => `${local.replace(" ", "T")}${OFFSET}`

const setFor = (workout: WorkoutRow, row: SetRow): HistorySet => {
  if (row.set_type === "longTime") return { durationSeconds: row.seconds ?? 0 }

  const typo = TYPOS.find(
    (fix) => fix.startedAt === workout.started_at && fix.exercise === row.exercise && fix.setNo === row.set_no,
  )

  const weight = typo?.weight ?? row.weight_kg ?? 0
  // Gymverse asks how many reps were left in the tank; the app stores effort as RPE, which is 10 minus that.
  const rpe = row.user_rir === null ? undefined : 10 - row.user_rir

  return rpe === undefined ? { weight, reps: row.reps ?? 0 } : { weight, reps: row.reps ?? 0, rpe }
}

export const convert = (file: string): History => {
  const workouts = query<WorkoutRow>(file, "SELECT * FROM workouts ORDER BY started_at")
  const sets = query<SetRow>(file, "SELECT * FROM sets ORDER BY workout_no, exercise_order, set_no")

  const converted = workouts.map((workout): HistoryWorkout => {
    // The same library exercise can come from two Gymverse slots in one workout; its sets are joined up.
    const exercises = new Map<string, Array<HistorySet>>()

    for (const row of sets) {
      if (row.workout_no !== workout.workout_no) continue
      const name = nameFor(row.exercise)
      const list = exercises.get(name) ?? []
      list.push(setFor(workout, row))
      exercises.set(name, list)
    }

    const startedAt = Date.parse(iso(workout.started_at))
    // Gymverse's own timer, not its completion date: an unfinished workout it saved later can be days out.
    const finishedAt = startedAt + Math.round(workout.duration_min * 60_000)

    return {
      // "Day Name" is Gymverse's placeholder for a day that was never named.
      name: workout.workout_name === "Day Name" ? workout.plan_name : workout.workout_name,
      startedAt: iso(workout.started_at),
      finishedAt: `${new Date(finishedAt + BRISBANE_MS).toISOString().slice(0, 19)}${OFFSET}`,
      notes: NOTES,
      exercises: [...exercises].map(([name, list]): HistoryExercise => ({ name, sets: list })),
    }
  })

  return {
    about: "Training history exported from the Gymverse iPhone app, Nov 2022 to Jul 2026. Made by tools/seed/from-gymverse.ts.",
    unit: "kg",
    customExercises: Object.fromEntries(Object.values(CUSTOM).map(([name, group]) => [name, group])),
    workouts: converted,
  }
}

if (import.meta.main) {
  const [input, output = "seed/training-history.json"] = process.argv.slice(2)

  if (!input) throw new Error("Usage: bun tools/seed/from-gymverse.ts <gymverse.sqlite> [out.json]")

  const history = convert(input)
  writeFileSync(output, `${JSON.stringify(history, null, 1)}\n`)
  const setCount = history.workouts.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.length, 0), 0)
  console.log(`${history.workouts.length} workouts, ${setCount} sets → ${output}`)
}
