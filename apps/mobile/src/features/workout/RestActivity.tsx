import { HStack, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui"
import { font, foregroundStyle, frame, lineLimit, monospacedDigit, multilineTextAlignment, padding, tint } from "@expo/ui/swift-ui/modifiers"
import { createLiveActivity, type LiveActivityEnvironment, type LiveActivityLayout } from "expo-widgets"

export interface RestActivityProps {
  /** What the rest follows, such as the exercise's name. */
  readonly title: string
  /** When the rest began and when it ends, in milliseconds since 1970. */
  readonly startedAt: number
  readonly endsAt: number
}

/**
 * The rest countdown on the Lock Screen and in the Dynamic Island. iOS draws the ticking
 * clock itself from the two times, so it keeps counting while the app is asleep.
 */
// This runs inside the widget, on its own. It can only use what is imported from Expo UI and what is written inside it.
function RestActivity(props: RestActivityProps, environment: LiveActivityEnvironment): LiveActivityLayout {
  "widget"

  const ACCENT = "#d7ff3e"
  const interval = { lower: new Date(props.startedAt), upper: new Date(props.endsAt) }
  // iOS marks the activity as out of date when the rest runs out, which is the moment to say "Go".
  const over = environment.isStale === true

  const clock = (size: number) =>
    over ? (
      <Text modifiers={[font({ weight: "bold", size }), foregroundStyle(ACCENT)]}>Go</Text>
    ) : (
      <Text
        timerInterval={interval}
        countsDown
        modifiers={[font({ weight: "bold", size }), monospacedDigit(), foregroundStyle(ACCENT), multilineTextAlignment("trailing")]}
      />
    )

  return {
    banner: (
      <VStack alignment="leading" spacing={10} modifiers={[padding({ all: 16 })]}>
        <HStack alignment="center" spacing={12}>
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[font({ weight: "semibold", size: 13 }), foregroundStyle(ACCENT)]}>{over ? "REST OVER" : "REST"}</Text>
            <Text modifiers={[font({ weight: "semibold", size: 17 }), lineLimit(1)]}>{props.title}</Text>
          </VStack>
          <Spacer minLength={8} />
          {clock(40)}
        </HStack>
        {over ? null : <ProgressView timerInterval={interval} countsDown modifiers={[tint(ACCENT)]} />}
      </VStack>
    ),
    compactLeading: <Text modifiers={[font({ weight: "semibold", size: 13 }), foregroundStyle(ACCENT)]}>Rest</Text>,
    compactTrailing: <HStack modifiers={[frame({ maxWidth: 48 })]}>{clock(14)}</HStack>,
    minimal: <HStack modifiers={[frame({ maxWidth: 36 })]}>{clock(11)}</HStack>,
    expandedLeading: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 6 })]}>
        <Text modifiers={[font({ weight: "semibold", size: 12 }), foregroundStyle(ACCENT)]}>{over ? "REST OVER" : "REST"}</Text>
        <Text modifiers={[font({ weight: "semibold", size: 15 }), lineLimit(1)]}>{props.title}</Text>
      </VStack>
    ),
    expandedTrailing: <HStack modifiers={[padding({ trailing: 6 })]}>{clock(30)}</HStack>,
    expandedBottom: over ? null : (
      <ProgressView timerInterval={interval} countsDown modifiers={[tint(ACCENT), padding({ horizontal: 8 })]} />
    ),
  }
}

export default createLiveActivity<RestActivityProps>("RestActivity", RestActivity)
