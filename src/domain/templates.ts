import type { ExercisePrescription, PlanInput } from "./schema"

const lift = (
  exercise: string,
  muscleGroup: string,
  sets: number,
  repMin: number,
  repMax: number,
  restSeconds = 120,
): ExercisePrescription => ({ exercise, muscleGroup, sets, repMin, repMax, restSeconds })

export interface PlanTemplate {
  readonly id: string
  readonly summary: string
  readonly plan: PlanInput
}

/** Starter plans for getting going without the AI coach. Target weights are found in the first session. */
export const PLAN_TEMPLATES: ReadonlyArray<PlanTemplate> = [
  {
    id: "full-body-3",
    summary: "3 days a week. Good for starting out or coming back.",
    plan: {
      name: "Full body",
      description: "Three full-body sessions a week with a rest day between each.",
      days: [
        {
          name: "Full body A",
          exercises: [
            lift("Squat", "Legs", 3, 5, 8, 180),
            lift("Bench Press", "Chest", 3, 6, 10, 150),
            lift("Barbell Row", "Back", 3, 8, 12),
            lift("Overhead Press", "Shoulders", 2, 8, 12),
            lift("Hanging Knee Raise", "Core", 3, 8, 15, 60),
          ],
        },
        {
          name: "Full body B",
          exercises: [
            lift("Romanian Deadlift", "Hamstrings", 3, 6, 10, 180),
            lift("Incline Dumbbell Press", "Chest", 3, 8, 12),
            lift("Lat Pulldown", "Back", 3, 8, 12),
            lift("Leg Press", "Legs", 3, 10, 15),
            lift("Dumbbell Curl", "Arms", 2, 10, 15, 90),
          ],
        },
        {
          name: "Full body C",
          exercises: [
            lift("Deadlift", "Back", 2, 3, 6, 240),
            lift("Dumbbell Shoulder Press", "Shoulders", 3, 8, 12),
            lift("Seated Cable Row", "Back", 3, 8, 12),
            lift("Bulgarian Split Squat", "Legs", 3, 8, 12),
            lift("Triceps Pushdown", "Arms", 2, 10, 15, 90),
          ],
        },
      ],
    },
  },
  {
    id: "upper-lower-4",
    summary: "4 days a week. Each muscle group twice.",
    plan: {
      name: "Upper / Lower",
      description: "Two upper and two lower sessions a week.",
      days: [
        {
          name: "Upper 1",
          exercises: [
            lift("Bench Press", "Chest", 4, 5, 8, 180),
            lift("Barbell Row", "Back", 4, 6, 10, 150),
            lift("Overhead Press", "Shoulders", 3, 8, 12),
            lift("Lat Pulldown", "Back", 3, 10, 12),
            lift("Triceps Pushdown", "Arms", 3, 10, 15, 90),
          ],
        },
        {
          name: "Lower 1",
          exercises: [
            lift("Squat", "Legs", 4, 5, 8, 180),
            lift("Romanian Deadlift", "Hamstrings", 3, 8, 10, 150),
            lift("Leg Press", "Legs", 3, 10, 15),
            lift("Standing Calf Raise", "Calves", 3, 10, 15, 90),
          ],
        },
        {
          name: "Upper 2",
          exercises: [
            lift("Incline Dumbbell Press", "Chest", 3, 8, 12),
            lift("Seated Cable Row", "Back", 3, 8, 12),
            lift("Lateral Raise", "Shoulders", 3, 12, 20, 60),
            lift("Dumbbell Curl", "Arms", 3, 10, 15, 90),
            lift("Face Pull", "Shoulders", 3, 12, 20, 60),
          ],
        },
        {
          name: "Lower 2",
          exercises: [
            lift("Deadlift", "Back", 3, 3, 6, 240),
            lift("Bulgarian Split Squat", "Legs", 3, 8, 12),
            lift("Leg Curl", "Hamstrings", 3, 10, 15, 90),
            lift("Hanging Knee Raise", "Core", 3, 8, 15, 60),
          ],
        },
      ],
    },
  },
  {
    id: "push-pull-legs",
    summary: "3 to 6 days a week. Run the three days in a loop.",
    plan: {
      name: "Push / Pull / Legs",
      description: "Rotate push, pull and legs. Rest when you need to.",
      days: [
        {
          name: "Push",
          exercises: [
            lift("Bench Press", "Chest", 4, 5, 8, 180),
            lift("Overhead Press", "Shoulders", 3, 8, 12),
            lift("Incline Dumbbell Press", "Chest", 3, 8, 12),
            lift("Lateral Raise", "Shoulders", 3, 12, 20, 60),
            lift("Triceps Pushdown", "Arms", 3, 10, 15, 90),
          ],
        },
        {
          name: "Pull",
          exercises: [
            lift("Deadlift", "Back", 3, 3, 6, 240),
            lift("Lat Pulldown", "Back", 3, 8, 12),
            lift("Seated Cable Row", "Back", 3, 8, 12),
            lift("Face Pull", "Shoulders", 3, 12, 20, 60),
            lift("Dumbbell Curl", "Arms", 3, 10, 15, 90),
          ],
        },
        {
          name: "Legs",
          exercises: [
            lift("Squat", "Legs", 4, 5, 8, 180),
            lift("Romanian Deadlift", "Hamstrings", 3, 8, 10, 150),
            lift("Leg Press", "Legs", 3, 10, 15),
            lift("Leg Curl", "Hamstrings", 3, 10, 15, 90),
            lift("Standing Calf Raise", "Calves", 3, 10, 15, 90),
          ],
        },
      ],
    },
  },
]
