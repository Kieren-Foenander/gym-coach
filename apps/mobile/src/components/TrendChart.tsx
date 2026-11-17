import { useId } from "react"
import { View } from "react-native"
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg"
import { CHART, layoutTrend, type TrendPoint } from "~/domain/chart"
import { formatWeight } from "~/format"
import { Text } from "@/components/ui"
import { colors } from "@/theme"

export type { TrendPoint }

interface TrendChartProps {
  /** Oldest first. */
  readonly points: ReadonlyArray<TrendPoint>
  readonly unit: string
  /** What the line measures, for screen readers. */
  readonly label: string
  /** Also draw the highest value so far, for numbers that should climb. */
  readonly best?: boolean
}

/** A line over time with dates along the bottom and values up the side. */
export function TrendChart({ points, unit, label, best = false }: TrendChartProps) {
  const layout = layoutTrend(points, { best })
  // An id per chart, so two charts on one screen do not share a fill.
  const fill = `trend-fill-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`
  const first = layout.points[0]
  const last = layout.points.at(-1)

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${label} over ${points.length} entries, from ${formatWeight(first?.value ?? 0)} to ${formatWeight(last?.value ?? 0)} ${unit}`}
    >
      {layout.best ? (
        <View className="flex-row justify-end gap-4 pb-1">
          <View className="flex-row items-center gap-1.5">
            <View className="h-0.5 w-4 rounded bg-accent" />
            <Text className="text-xs text-faint">Each session</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="w-4 border-t-2 border-dashed border-muted" />
            <Text className="text-xs text-faint">Best so far</Text>
          </View>
        </View>
      ) : null}
      <Svg width="100%" height={undefined} style={{ aspectRatio: CHART.width / CHART.height }} viewBox={`0 0 ${CHART.width} ${CHART.height}`}>
        <Defs>
          <LinearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor={colors.accent} stopOpacity={0.22} />
            <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {layout.valueTicks.map((tick) => (
          <G key={tick.label}>
            <Line x1={CHART.left} x2={CHART.right} y1={tick.y} y2={tick.y} stroke={colors.line} strokeDasharray="3 4" />
            <SvgText x={CHART.left - 6} y={tick.y + 3.5} textAnchor="end" fontSize={10} fill={colors.faint}>
              {tick.label}
            </SvgText>
          </G>
        ))}
        {layout.dateTicks.map((tick) => (
          <SvgText key={tick.label} x={tick.x} y={CHART.dateLabelY} textAnchor={tick.anchor} fontSize={10} fill={colors.faint}>
            {tick.label}
          </SvgText>
        ))}
        {layout.area ? <Path d={layout.area} fill={`url(#${fill})`} /> : null}
        {layout.best ? <Path d={layout.best} fill="none" stroke={colors.muted} strokeWidth={1.5} strokeDasharray="4 3" /> : null}
        <Path d={layout.line} fill="none" stroke={colors.accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {layout.points.map((point, index) => (
          <Circle key={point.id} cx={point.x} cy={point.y} r={index === layout.points.length - 1 ? 4.5 : 3} fill={colors.accent} />
        ))}
      </Svg>
    </View>
  )
}
