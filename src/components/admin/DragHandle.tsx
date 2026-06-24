import type { DragControls } from 'motion/react'

/**
 * A grip control that starts a drag on its enclosing Reorder.Item. `touch-none`
 * lets a touch-drag reorder instead of scrolling the page. Shared by the admin's
 * reorderable lists (planner facets + booth slides).
 */
export function DragHandle({ controls }: { controls: DragControls }) {
  return (
    <button
      type="button"
      aria-label="Drag to reorder"
      onPointerDown={(e) => controls.start(e)}
      className="flex-none cursor-grab touch-none select-none px-1 text-lg leading-none text-slate-300 transition-colors hover:text-slate-500 active:cursor-grabbing"
    >
      ⠿
    </button>
  )
}
