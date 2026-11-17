import { useVideoPlayer, VideoView } from "expo-video"
import { useState } from "react"
import { View } from "react-native"
import type { ExerciseDemo } from "~/domain/demos"
import { Segmented } from "@/components/ui"
import { useDemos } from "./demos"

interface ClipProps {
  readonly uri: string
  readonly label: string
}

/** One silent, looping clip. A new clip gets a new player, so this is keyed by its address. */
function Clip({ uri, label }: ClipProps) {
  const player = useVideoPlayer({ uri, useCaching: true }, (created) => {
    created.loop = true
    created.muted = true
    // A demonstration must never interrupt the music someone is training to.
    created.audioMixingMode = "mixWithOthers"
    created.play()
  })

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <VideoView player={player} style={{ width: "100%", aspectRatio: 1 }} contentFit="contain" nativeControls={false} />
    </View>
  )
}

/** A looping demonstration of the movement, with a switch between the views that were rendered. */
export function Demonstration({ demo, name }: { readonly demo: ExerciseDemo; readonly name: string }) {
  const { demoFile } = useDemos()
  const [view, setView] = useState(demo.views[0] ?? "front")
  const uri = `${demoFile(demo, view)}.mp4`

  return (
    <View className="mb-4 overflow-hidden rounded-3xl border border-white/5 bg-ink">
      <Clip key={uri} uri={uri} label={`${name} demonstration, ${view} view`} />
      {demo.views.length > 1 ? (
        <View className="border-t border-white/5 bg-surface p-4">
          <Segmented label="View" options={demo.views} value={view} onChange={setView} />
        </View>
      ) : null}
    </View>
  )
}
