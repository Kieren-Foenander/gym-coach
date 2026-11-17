import { useEffect, useState } from "react"

/** The current time. Ticks each second if asked, for clocks and countdowns. */
export const useNow = (ticking = false): number => {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setNow(Date.now())

    if (!ticking) return

    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [ticking])

  return now
}
