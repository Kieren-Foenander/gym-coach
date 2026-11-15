import { formatWeight } from "~/domain/progression"

export { formatWeight }

interface Prescription {
  readonly sets: number
  readonly repMin: number
  readonly repMax: number
  readonly targetWeight: number | null
}

export const formatReps = (repMin: number, repMax: number) => (repMin === repMax ? `${repMin}` : `${repMin}–${repMax}`)

export const formatPrescription = (target: Prescription, unit: string) => {
  const weight = target.targetWeight === null ? "find your weight" : `${formatWeight(target.targetWeight)} ${unit}`

  return `${target.sets} × ${formatReps(target.repMin, target.repMax)} · ${weight}`
}

export const formatClock = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(seconds / 60)

  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" })

export const formatDay = (timestamp: number) => dayFormat.format(timestamp)

export const formatVolume = (volume: number, unit: string) =>
  `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(volume)} ${unit}`
