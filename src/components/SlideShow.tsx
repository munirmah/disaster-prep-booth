import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useContent } from '../content/store'
import { useAutoAdvance } from '../hooks/useAutoAdvance'
import { renderSlide } from './slides/registry'
import { Branding } from './Branding'
import { ProgressBar } from './ProgressBar'

/**
 * Looping awareness deck (used on the booth screen).
 *
 * Owns the loop (via useAutoAdvance) and crossfades between slides with
 * AnimatePresence. The persistent Branding header and ProgressBar live outside
 * the animated region so they don't re-mount on every slide change. The screen
 * wake lock is owned by BoothView, not here.
 */
export function SlideShow() {
  // Slides come from the shared content document (server → cache → built-in).
  const { content } = useContent()
  // Play only enabled slides; if every slide is muted, fall back to all so the
  // booth never goes blank.
  const deck = useMemo(() => {
    const on = content.slides.filter((s) => s.enabled !== false)
    return on.length ? on : content.slides
  }, [content.slides])
  const durations = useMemo(() => deck.map((s) => s.durationMs), [deck])
  const { index } = useAutoAdvance(durations)
  // Guard the index against deck length changing under us (edit/reorder/delete).
  const slide = deck[index % deck.length] ?? deck[0]

  return (
    <div className="flex h-full w-full flex-col">
      <Branding kicker={slide.kicker} />

      {/* Sized query container so slides scale to THIS column (cqh/cqw),
          not the full viewport — keeps type large and everything fitting
          regardless of the QR panel's width. */}
      <main className="relative flex-1 overflow-hidden [container-type:size]">
        <AnimatePresence mode="wait">
          <motion.section
            key={slide.id}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            {renderSlide(slide)}
          </motion.section>
        </AnimatePresence>
      </main>

      <ProgressBar slideId={slide.id} durationMs={slide.durationMs} />
    </div>
  )
}
