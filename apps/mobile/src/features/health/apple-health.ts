import type { HealthAnchors, HealthChanges } from "./types"

/** Apple Health only exists on an iPhone; see apple-health.ios.ts. Elsewhere there is nothing to read. */

export const healthKitAvailable = (): boolean => false

export const requestHealthAccess = async (): Promise<void> => {
  throw new Error("Apple Health is only on iPhone.")
}

export const readHealthChanges = async (
  _anchors: HealthAnchors,
  _lastSyncedAt: number | null,
  _backfillDaily: boolean,
): Promise<HealthChanges> => ({
  deleted: [],
  body: [],
  workouts: [],
  daily: [],
  anchors: {},
})
