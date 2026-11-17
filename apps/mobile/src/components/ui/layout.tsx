import { useQueryClient } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"
import { Pressable, RefreshControl, ScrollView, View, type ViewProps } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg"
import { CloseIcon } from "@/components/icons"
import { cn } from "@/lib/cn"
import { colors } from "@/theme"
import { Display, Eyebrow, Text } from "./text"

/** Room left at the bottom of a tab's content for the floating tab bar. */
export const TAB_BAR_CLEARANCE = 112

/** The faint glow behind the top of every screen. */
function Glow() {
  return (
    <View pointerEvents="none" className="absolute inset-x-0 top-0 h-96">
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="-10%" rx="70%" ry="80%" gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor={colors.accent} stopOpacity={0.1} />
            <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100" height="100" fill="url(#glow)" />
      </Svg>
    </View>
  )
}

interface ScreenProps {
  readonly children: ReactNode
  /** Leaves room for the tab bar. Off for screens pushed over the tabs. */
  readonly tabs?: boolean
  /** Stays put at the top while the rest scrolls. */
  readonly header?: ReactNode
  /** Stays put at the bottom, over the content. */
  readonly footer?: ReactNode
  /** Extra room under the content, such as for a floating bar. */
  readonly bottomSpace?: number
}

/** One screen of the app: scrolls, keeps clear of the notch and keyboard, and refreshes when pulled down. */
export function Screen({ children, tabs = false, header, footer, bottomSpace = 0 }: ScreenProps) {
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    await queryClient.invalidateQueries()
    setRefreshing(false)
  }

  return (
    <View className="flex-1 bg-ink">
      <Glow />
      {header ? <View style={{ paddingTop: Math.max(insets.top, 16) }}>{header}</View> : null}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: header ? 4 : Math.max(insets.top, 16),
          paddingBottom: (tabs ? TAB_BAR_CLEARANCE : 24) + insets.bottom + bottomSpace,
          paddingHorizontal: 16,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      >
        {children}
      </ScrollView>
      {footer}
    </View>
  )
}

interface SheetScreenProps {
  readonly title: string
  readonly onClose: () => void
  readonly children: ReactNode
}

/** A panel presented over the screen below it, with a title and a way to close it. */
export function SheetScreen({ title, onClose, children }: SheetScreenProps) {
  const insets = useSafeAreaInsets()

  return (
    <View className="flex-1 bg-surface">
      <View className="flex-row items-center justify-between gap-3 px-4 pb-3 pt-5">
        <Display numberOfLines={1} className="flex-1">
          {title}
        </Display>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={8}
          onPress={onClose}
          className="size-11 items-center justify-center rounded-full bg-raised"
        >
          <CloseIcon size={20} color={colors.muted} />
        </Pressable>
      </View>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {children}
      </ScrollView>
    </View>
  )
}

interface CardProps extends ViewProps {
  readonly className?: string
}

export function Card({ className, ...props }: CardProps) {
  return <View className={cn("rounded-3xl border border-white/5 bg-surface p-4", className)} {...props} />
}

interface PageTitleProps {
  readonly children: string
  readonly eyebrow?: string
  readonly action?: ReactNode
}

export function PageTitle({ children, eyebrow, action }: PageTitleProps) {
  return (
    <View className="flex-row items-end justify-between gap-3 pb-5 pt-2">
      <View className="flex-1">
        {eyebrow === undefined ? null : (
          <Eyebrow numberOfLines={1} className="min-h-4 pb-1 text-accent">
            {eyebrow}
          </Eyebrow>
        )}
        <Display accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} className="text-5xl">
          {children}
        </Display>
      </View>
      {action}
    </View>
  )
}

export function SectionTitle({ children }: { readonly children: string }) {
  return (
    <View className="flex-row items-center gap-2 pb-3 pt-7">
      <View className="h-3.5 w-1 rounded-full bg-accent" />
      <Eyebrow accessibilityRole="header">{children}</Eyebrow>
    </View>
  )
}

interface StatProps {
  readonly label: string
  readonly value: string | number
  readonly unit?: string | undefined
}

/** One headline number with a label under it. */
export function Stat({ label, value, unit }: StatProps) {
  return (
    <View className="flex-1 rounded-2xl bg-raised/70 px-3 py-3">
      <Display numberOfLines={1} adjustsFontSizeToFit className="tabular-nums">
        {value}
        {unit ? <Display className="text-base text-muted"> {unit}</Display> : null}
      </Display>
      <Text numberOfLines={1} className="pt-1 text-xs text-muted">
        {label}
      </Text>
    </View>
  )
}

/** A dashed box saying there is nothing here yet. */
export function Empty({ children }: { readonly children: string }) {
  return (
    <View className="rounded-3xl border border-dashed border-line px-4 py-10">
      <Text className="text-center text-muted">{children}</Text>
    </View>
  )
}

/** A hairline between rows of a list. */
export function Divider() {
  return <View className="h-px bg-white/5" />
}

export function ErrorNote({ message }: { readonly message: string | null }) {
  if (!message) return null

  return (
    <View accessibilityRole="alert" className="rounded-2xl border border-red-900/60 bg-red-950/60 px-4 py-3">
      <Text className="text-sm text-red-200">{message}</Text>
    </View>
  )
}

/** Shown in place of a screen's content the first time it loads, and when that fails with nothing to fall back on. */
export function Loading({ error }: { readonly error: string | null }) {
  return error === null ? (
    <Text className="py-10 text-center text-faint">Loading…</Text>
  ) : (
    <View className="pt-4">
      <ErrorNote message={error} />
    </View>
  )
}

interface BackLinkProps {
  readonly label?: string
  readonly onPress: () => void
}

/** The way back at the top of a page pushed over the tabs. Swiping from the edge does the same. */
export function BackLink({ label = "Back", onPress }: BackLinkProps) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress} className="min-h-11 flex-row items-center self-start">
      <Eyebrow className="text-accent">‹ {label}</Eyebrow>
    </Pressable>
  )
}
