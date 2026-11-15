import { Schema } from "effect"

export const Unit = Schema.Literals(["kg", "lb"])

export type Unit = typeof Unit.Type

const Text = (max: number) => Schema.String.check(Schema.isMaxLength(max))
const Name = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(80))
const Int = (min: number, max: number) => Schema.Int.check(Schema.isBetween({ minimum: min, maximum: max }))
const Weight = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 2000 }))
export const Id = Schema.Int.check(Schema.isGreaterThan(0))

export const Credentials = Schema.Struct({
  email: Schema.Trim.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/), Schema.isMaxLength(200)),
  password: Schema.String.check(Schema.isMinLength(10), Schema.isMaxLength(200)),
})

export const SignUpInput = Schema.Struct({
  ...Credentials.fields,
  displayName: Name,
  inviteCode: Schema.optional(Text(200)),
})

export const ProfilePatch = Schema.Struct({
  displayName: Schema.optional(Name),
  unit: Schema.optional(Unit),
  goal: Schema.optional(Text(2000)),
  trainingContext: Schema.optional(Text(4000)),
})

export type ProfilePatch = typeof ProfilePatch.Type

/** The prescription for one exercise on one day of a plan. */
export const ExercisePrescription = Schema.Struct({
  exercise: Name,
  muscleGroup: Schema.optional(Text(40)),
  sets: Int(1, 12),
  repMin: Int(1, 100),
  repMax: Int(1, 100),
  targetWeight: Schema.optional(Schema.NullOr(Weight)),
  increment: Schema.optional(Weight),
  restSeconds: Schema.optional(Int(0, 900)),
  notes: Schema.optional(Text(500)),
  autoProgress: Schema.optional(Schema.Boolean),
})

export type ExercisePrescription = typeof ExercisePrescription.Type

export const PlanInput = Schema.Struct({
  name: Name,
  description: Schema.optional(Text(2000)),
  days: Schema.Array(
    Schema.Struct({ name: Name, exercises: Schema.Array(ExercisePrescription) }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(14)),
})

export type PlanInput = typeof PlanInput.Type

export const PlanExercisePatch = Schema.Struct({
  sets: Schema.optional(Int(1, 12)),
  repMin: Schema.optional(Int(1, 100)),
  repMax: Schema.optional(Int(1, 100)),
  targetWeight: Schema.optional(Schema.NullOr(Weight)),
  increment: Schema.optional(Weight),
  restSeconds: Schema.optional(Int(0, 900)),
  notes: Schema.optional(Text(500)),
  autoProgress: Schema.optional(Schema.Boolean),
})

export type PlanExercisePatch = typeof PlanExercisePatch.Type

export const SetInput = Schema.Struct({
  weight: Weight,
  reps: Int(0, 1000),
  rpe: Schema.optional(Schema.NullOr(Schema.Finite.check(Schema.isBetween({ minimum: 1, maximum: 10 })))),
})

export type SetInput = typeof SetInput.Type

export type AdjustmentSource = "rule" | "ai" | "user"

export const MEASUREMENT_KINDS = ["weight", "waist", "chest", "hips", "arm", "thigh"] as const

export const MeasurementKind = Schema.Literals(MEASUREMENT_KINDS)

export type MeasurementKind = typeof MeasurementKind.Type

export const MeasurementInput = Schema.Struct({
  kind: MeasurementKind,
  value: Schema.Finite.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
})

export type MeasurementInput = typeof MeasurementInput.Type

export const Direction = Schema.Literals(["up", "down"])

export type Direction = typeof Direction.Type

/** Bodyweight uses the weight unit. Tape measurements use cm alongside kg and inches alongside lb. */
export const measurementUnit = (kind: MeasurementKind, unit: Unit) =>
  kind === "weight" ? unit : unit === "kg" ? "cm" : "in"
