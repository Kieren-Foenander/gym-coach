import type { CallInput } from "~/server/calls"

/** What the phone sends the server from Apple Health. The server's input schema is the source of truth. */
type HealthImport = CallInput<"importHealth">

export type BodyRecord = NonNullable<HealthImport["body"]>[number]

export type WorkoutRecord = NonNullable<HealthImport["workouts"]>[number]

export type DailyRecord = NonNullable<HealthImport["daily"]>[number]

/** Where each anchored Health query got up to, so the next sync starts from there. */
export interface HealthAnchors {
  readonly weight?: string
  readonly waist?: string
  readonly bodyFat?: string
  readonly workouts?: string
}

export interface HealthChanges {
  readonly deleted: ReadonlyArray<string>
  readonly body: ReadonlyArray<BodyRecord>
  readonly workouts: ReadonlyArray<WorkoutRecord>
  readonly daily: ReadonlyArray<DailyRecord>
  readonly anchors: HealthAnchors
}
