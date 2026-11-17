/**
 * The app's colours as plain values, for the places a class name cannot reach:
 * drawings, native controls and navigation. global.css holds the same values for class names.
 */
export const colors = {
  ink: "#08090b",
  surface: "#121418",
  raised: "#1c1f25",
  line: "#272b33",
  accent: "#d7ff3e",
  accentStrong: "#bfe822",
  accentInk: "#0b0d05",
  muted: "#9299a5",
  faint: "#737a86",
  white: "#f5f6f7",
  danger: "#f87171",
  warning: "#fcd34d",
} as const

export type ColorName = keyof typeof colors
