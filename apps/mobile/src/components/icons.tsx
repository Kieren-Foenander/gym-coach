import Svg, { Circle, Path, Rect } from "react-native-svg"
import { colors } from "@/theme"

interface IconProps {
  readonly size?: number
  readonly color?: string
}

interface StrokeIconProps extends IconProps {
  readonly path: string
}

function StrokeIcon({ size = 16, color = colors.white, path }: StrokeIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden importantForAccessibility="no">
      <Path d={path} stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

interface FilledIconProps extends IconProps {
  readonly path: string
}

function FilledIcon({ size = 20, color = colors.white, path }: FilledIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Path d={path} fill={color} />
    </Svg>
  )
}

export const CheckIcon = (props: IconProps) => <StrokeIcon path="M5 12.5l4.5 4.5L19 7.5" {...props} />

export const ArrowUpIcon = (props: IconProps) => <StrokeIcon path="M12 19V5M6 11l6-6 6 6" {...props} />

export const ArrowDownIcon = (props: IconProps) => <StrokeIcon path="M12 5v14M6 13l6 6 6-6" {...props} />

export const ChevronIcon = (props: IconProps) => <StrokeIcon path="M9 5l7 7-7 7" {...props} />

export const BackIcon = (props: IconProps) => <StrokeIcon path="M15 5l-7 7 7 7" {...props} />

export const CloseIcon = (props: IconProps) => <StrokeIcon path="M6 6l12 12M18 6L6 18" {...props} />

export const FlameIcon = (props: IconProps) => (
  <FilledIcon
    path="M12.6 2c.5 3.2-1 5-2.6 6.7C8.3 10.5 6.5 12.4 6.5 15.3a5.5 5.5 0 0 0 11 0c0-1.800-.7-3.200-1.500-4.300-.4 1.200-1.100 2-2.100 2.400.5-3.600-.3-7.900-1.300-11.400z"
    {...props}
  />
)

export const TrophyIcon = (props: IconProps) => (
  <FilledIcon
    path="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3zm0 4H6v1a2 2 0 0 0 1 1.7zm10 0v2.7A2 2 0 0 0 18 8V7z"
    {...props}
  />
)

/** The app's mark: a barbell. */
export function BarbellIcon({ size = 24, color = colors.white }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Rect x={8} y={11} width={8} height={2} rx={0.5} fill={color} />
      <Rect x={5.5} y={7} width={2.5} height={10} rx={1} fill={color} />
      <Rect x={16} y={7} width={2.5} height={10} rx={1} fill={color} />
      <Rect x={2.5} y={9} width={2} height={6} rx={0.9} fill={color} />
      <Rect x={19.5} y={9} width={2} height={6} rx={0.9} fill={color} />
    </Svg>
  )
}

export function SearchIcon({ size = 20, color = colors.white }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden importantForAccessibility="no">
      <Circle cx={11} cy={11} r={6.5} stroke={color} strokeWidth={2.4} />
      <Path d="M16 16l4.5 4.5" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  )
}

/** The pictures on the tab bar, drawn the same as the web app's. */
export const TAB_ICON_PATHS = {
  Today: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  Plan: "M5 4h14v3H5zM5 10.5h14v3H5zM5 17h14v3H5z",
  Exercises: "M2 9h2.5v6H2zM5.5 6.5h3v11h-3zM9.5 11h5v2h-5zM15.5 6.5h3v11h-3zM19.5 9H22v6h-2.5z",
  History: "M4 20V10h3v10zM10.5 20V4h3v16zM17 20v-7h3v7z",
  Settings: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0z",
} as const

export type TabName = keyof typeof TAB_ICON_PATHS

interface TabIconProps extends IconProps {
  readonly tab: TabName
}

export const TabIcon = ({ tab, ...props }: TabIconProps) => <FilledIcon path={TAB_ICON_PATHS[tab]} {...props} />
