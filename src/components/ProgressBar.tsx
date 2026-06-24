/**
 * Thin bottom bar that fills left→right over the current slide's duration.
 *
 * The fill is a GPU-only CSS transform animation (scaleX), keyed to the slide
 * so it restarts each time — no per-frame React renders, so it stays smooth on
 * a TV. The global reduced-motion media query collapses it to ~instant.
 */
export function ProgressBar({ slideId, durationMs }: { slideId: string; durationMs: number }) {
  return (
    <div className="h-[1vh] w-full bg-white/10">
      <div
        key={slideId}
        className="h-full w-full origin-left bg-[var(--accent)] [animation:progress-fill_linear_forwards]"
        style={{ animationDuration: `${durationMs}ms` }}
      />
    </div>
  )
}
