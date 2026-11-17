/**
 * Units and measurement kinds as plain values, with no schema library behind them,
 * so the native app can use them without bundling one.
 */

export type Unit = "kg" | "lb"

export const MEASUREMENT_KINDS = ["weight", "waist", "chest", "hips", "arm", "thigh"] as const

export type MeasurementKind = (typeof MEASUREMENT_KINDS)[number]

/** Cardio distance is in km alongside kg and miles alongside lb. */
export const distanceUnit = (unit: Unit) => (unit === "kg" ? "km" : "mi")

/** Bodyweight uses the weight unit. Tape measurements use cm alongside kg and inches alongside lb. */
export const measurementUnit = (kind: MeasurementKind, unit: Unit) =>
  kind === "weight" ? unit : unit === "kg" ? "cm" : "in"
