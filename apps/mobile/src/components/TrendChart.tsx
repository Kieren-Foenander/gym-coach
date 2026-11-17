import { View } from "react-native"
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg"
import { formatDay, formatWeight } from "~/format"
import { Text } from "@/components/ui"
import { colors } from "@/theme"

export interface TrendPoint {
  readonly id: number
  readonly date: number
  readonly value: number
}

interface TrendChartProps {
  /** Oldest first. */
  readonly points: ReadonlyArray<TrendPoint>
  readonly unit: string
  /** What the line measures, for screen readers. */
  readonly label: string
}

const WIDTH = 320
const HEIGHT = 140
const PAD = 8

/** A single line over time, oldest on the left, with the high and low marked. */
export function TrendChart({ points, unit, label }: TrendChartProps) {
  const values = points.map((point) => point.value)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const span = high - low || 1
  const x = (index: number) => (points.length === 1 ? WIDTH / 2 : PAD + (index * (WIDTH - PAD * 2)) / (points.length - 1))
  const y = (value: number) => HEIGHT - PAD - ((value - low) / span) * (HEIGHT - PAD * 2)
  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ")
  const first = points[0]
  const last = points.at(-1)

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${label} over ${points.length} entries, from ${formatWeight(values[0] ?? 0)} to ${formatWeight(values.at(-1) ?? 0)} ${unit}`}
    >
      <View className="flex-row justify-between pb-1">
        <Text className="text-xs tabular-nums text-faint">
          High {formatWeight(high)} {unit}
        </Text>
        <Text className="text-xs tabular-nums text-faint">
          Low {formatWeight(low)} {unit}
        </Text>
      </View>
      <Svg width="100%" height={undefined} style={{ aspectRatio: WIDTH / HEIGHT }} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <Defs>
          <LinearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor={colors.accent} stopOpacity={0.28} />
            <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Line x1={PAD} x2={WIDTH - PAD} y1={PAD} y2={PAD} stroke={colors.line} strokeDasharray="3 4" />
        <Line x1={PAD} x2={WIDTH - PAD} y1={HEIGHT - PAD} y2={HEIGHT - PAD} stroke={colors.line} strokeDasharray="3 4" />
        {points.length > 1 ? (
          <Path d={`${path} L${x(points.length - 1).toFixed(1)},${HEIGHT} L${x(0).toFixed(1)},${HEIGHT} Z`} fill="url(#trend-fill)" />
        ) : null}
        <Path d={path} fill="none" stroke={colors.accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => (
          <Circle key={point.id} cx={x(index)} cy={y(point.value)} r={index === points.length - 1 ? 4.5 : 3} fill={colors.accent} />
        ))}
      </Svg>
      <View className="flex-row justify-between pt-1">
        <Text className="text-xs text-faint">{first ? formatDay(first.date) : ""}</Text>
        <Text className="text-xs text-faint">{last && points.length > 1 ? formatDay(last.date) : ""}</Text>
      </View>
    </View>
  )
}
