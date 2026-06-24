import { useEffect, useRef, useState } from 'react'

/**
 * Drives the looping slideshow.
 *
 * Holds the current slide index and advances to the next one after that
 * slide's own duration, wrapping back to 0 at the end. Each slide can declare
 * a different `durationMs`, so the timer is re-armed per slide rather than on a
 * fixed global interval.
 *
 * The elapsed-time visual is owned by the ProgressBar (a GPU CSS animation of
 * the same duration), so this hook no longer ticks per frame — it just sets a
 * single timer per slide.
 */
export function useAutoAdvance(durations: number[]) {
  const [index, setIndex] = useState(0)

  // Keep the latest durations in a ref so the effect doesn't re-run (and reset
  // the timer) just because the array identity changed.
  const durationsRef = useRef(durations)
  durationsRef.current = durations

  useEffect(() => {
    const total = durationsRef.current[index] ?? 10000
    const timer = setTimeout(() => {
      setIndex((i) => (i + 1) % durationsRef.current.length)
    }, total)
    return () => clearTimeout(timer)
  }, [index])

  return { index }
}
