import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Right-side slide-over panel for a focused admin subtask (e.g. editing one
 * shopping-list item) without losing the list behind it. Full-width sheet on
 * phones, a fixed-width panel on desktop. Dimmed backdrop; Escape or a backdrop
 * click closes it; body scroll is locked while open. A sticky header + footer
 * frame a scrollable body so a tall form stays usable.
 *
 * The body keeps rendering its last content through the close animation (so the
 * form doesn't blank out mid-slide), and the slide collapses to a plain fade
 * under prefers-reduced-motion.
 */
export function Drawer({
  open,
  title,
  onClose,
  footer,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
}) {
  const reduce = useReducedMotion()
  // Retain the last content so the panel doesn't empty out while sliding closed.
  const [retained, setRetained] = useState<ReactNode>(null)
  useEffect(() => {
    if (open) setRetained(children)
  }, [open, children])

  // Escape to close + lock background scroll while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  const panelMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '100%' } }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <button
            type="button"
            aria-label="Close"
            tabIndex={-1}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            {...panelMotion}
            transition={{ duration: 0.32, ease: EASE }}
            className="relative flex h-full w-full max-w-md flex-col bg-[var(--paper)] shadow-2xl"
          >
            <header className="flex flex-none items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
              <h3 className="font-black text-slate-900">{title}</h3>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="-mr-1 rounded-lg px-2 py-0.5 text-2xl leading-none text-slate-400 transition-colors hover:text-slate-700"
              >
                ×
              </button>
            </header>
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">{open ? children : retained}</div>
            {footer && (
              <div className="flex-none border-t border-slate-200 bg-white px-4 py-3">{footer}</div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
