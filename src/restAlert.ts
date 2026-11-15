/**
 * The sound played when a rest ends. Browsers only allow audio that starts
 * from a tap, so the tones are scheduled on the audio clock at the moment the
 * set is logged, rather than triggered by a timer when the rest runs out.
 */

const SOUND_KEY = "gym.restSound"

let context: AudioContext | null = null
let scheduled: ReadonlyArray<OscillatorNode> = []

export const soundEnabled = (): boolean => {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off"
  } catch {
    return true
  }
}

export const setSoundEnabled = (enabled: boolean) => {
  try {
    window.localStorage.setItem(SOUND_KEY, enabled ? "on" : "off")
  } catch {
    // Private browsing can refuse storage. The choice then lasts for this visit only.
  }
}

export const cancelRestAlert = () => {
  for (const tone of scheduled) {
    tone.onended = null
    tone.stop()
    tone.disconnect()
  }

  scheduled = []
}

const TONES = [
  { offset: 0, frequency: 880 },
  { offset: 0.22, frequency: 880 },
  { offset: 0.44, frequency: 1320 },
] as const

/** Wakes the audio system. Call it directly from a tap, before any waiting, or the browser keeps audio blocked. */
export const primeRestAlert = () => {
  if (!soundEnabled() || !("AudioContext" in window)) return

  context ??= new AudioContext()
  void context.resume()
}

/** Schedules three short tones for when the rest ends, replacing any earlier schedule. */
export const scheduleRestAlert = (secondsFromNow: number) => {
  cancelRestAlert()
  primeRestAlert()

  const audio = context

  if (!audio || !soundEnabled()) return

  scheduled = TONES.map(({ offset, frequency }) => {
    const startAt = audio.currentTime + Math.max(0, secondsFromNow) + offset
    const tone = audio.createOscillator()
    const volume = audio.createGain()

    tone.frequency.value = frequency
    volume.gain.setValueAtTime(0.0001, startAt)
    volume.gain.exponentialRampToValueAtTime(0.5, startAt + 0.02)
    volume.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.18)
    tone.connect(volume).connect(audio.destination)
    tone.start(startAt)
    tone.stop(startAt + 0.2)

    return tone
  })
}
