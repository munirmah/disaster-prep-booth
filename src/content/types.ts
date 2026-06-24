/**
 * Slide deck data model.
 *
 * The whole display is data-driven: `slides.ts` exports an ordered array of
 * `Slide` objects, and `SlideShow` renders + auto-advances through them on a
 * loop. To change what the booth shows, edit the content data — you should
 * rarely need to touch the slide components themselves.
 *
 * Adding a NEW kind of slide = add a variant to the `Slide` union here, then
 * register a component for it in `components/slides/registry.tsx`.
 */

/** Fields every slide shares. */
interface SlideBase {
  /** Stable unique id — used as the React key and for AnimatePresence. */
  id: string
  /** How long this slide stays on screen before auto-advancing, in ms. */
  durationMs: number
  /** Short label shown in the persistent header (the "chapter" name). */
  kicker?: string
  /** When explicitly false, the slide is kept but skipped on the booth (a quick
   *  mute toggle in the admin). Absent/true = shown. */
  enabled?: boolean
}

/** Opening / section title card. */
export interface TitleSlide extends SlideBase {
  type: 'title'
  title: string
  subtitle?: string
}

/** A preparedness checklist (e.g. go-bag contents, family plan steps). */
export interface ChecklistSlide extends SlideBase {
  type: 'checklist'
  title: string
  items: string[]
  /** Optional emoji/icon shown beside the title. */
  icon?: string
}

/** "What to do in a <hazard>" guidance card. */
export interface HazardSlide extends SlideBase {
  type: 'hazard'
  hazard: string
  icon?: string
  /** Ordered do-this-now steps. */
  steps: string[]
  /** Optional one-line headline above the steps. */
  headline?: string
}

/**
 * Passive quiz card. Because the booth takes no input, the answer auto-reveals
 * partway through the slide (after `revealAfterMs`) instead of waiting for a tap.
 */
export interface QuizSlide extends SlideBase {
  type: 'quiz'
  question: string
  options: string[]
  /** Index into `options` of the correct answer. */
  answerIndex: number
  /** Ms into the slide at which the answer is revealed. Must be < durationMs. */
  revealAfterMs: number
  /** Optional explanation shown with the revealed answer. */
  explanation?: string
}

export type Slide = TitleSlide | ChecklistSlide | HazardSlide | QuizSlide

/** Map of slide `type` -> the props the matching component receives. */
export type SlideOfType<T extends Slide['type']> = Extract<Slide, { type: T }>
