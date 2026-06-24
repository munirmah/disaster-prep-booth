import { slides as defaultSlides } from './content/slides'
import type { Slide } from './content/types'

/**
 * Slide-deck helpers used by the admin editor and the content store:
 * `sanitizeDeck` (a hand-imported or partially-filled deck can never crash the
 * render), `newSlide`, `sanitizeSlideForPreview`, and the built-in default.
 * The deck itself now lives in the shared content document (content/store.tsx),
 * not localStorage.
 */
const SLIDE_TYPES: Slide['type'][] = ['title', 'checklist', 'hazard', 'quiz']

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []

let idCounter = 0
export function genId(type: string): string {
  idCounter += 1
  // Math.random is fine in the browser (only workflow scripts forbid it).
  return `${type}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}-${idCounter}`
}

/** Coerce one arbitrary object into a valid Slide, or null if unrecoverable. */
function sanitizeSlide(raw: unknown): Slide | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const type = r.type as Slide['type']
  if (!SLIDE_TYPES.includes(type)) return null

  const base = {
    id: str(r.id) || genId(type),
    durationMs: Math.max(2000, num(r.durationMs, 12000)),
    kicker: str(r.kicker) || undefined,
    enabled: r.enabled === false ? false : undefined,
  }

  switch (type) {
    case 'title':
      return { ...base, type, title: str(r.title), subtitle: str(r.subtitle) || undefined }
    case 'checklist':
      return {
        ...base,
        type,
        title: str(r.title),
        icon: str(r.icon) || undefined,
        items: strList(r.items),
      }
    case 'hazard':
      return {
        ...base,
        type,
        hazard: str(r.hazard),
        headline: str(r.headline) || undefined,
        icon: str(r.icon) || undefined,
        steps: strList(r.steps),
      }
    case 'quiz': {
      const options = strList(r.options)
      const opts = options.length >= 2 ? options : ['Option A', 'Option B']
      const answerIndex = Math.min(Math.max(0, num(r.answerIndex, 0)), opts.length - 1)
      const revealAfterMs = Math.min(num(r.revealAfterMs, 6500), base.durationMs - 1000)
      return {
        ...base,
        type,
        question: str(r.question),
        options: opts,
        answerIndex,
        revealAfterMs: Math.max(1000, revealAfterMs),
        explanation: str(r.explanation) || undefined,
      }
    }
    default:
      return null
  }
}

/** Sanitize a whole deck and guarantee unique ids. */
export function sanitizeDeck(raw: unknown): Slide[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Slide[] = []
  for (const item of raw) {
    const slide = sanitizeSlide(item)
    if (!slide) continue
    while (seen.has(slide.id)) slide.id = genId(slide.type)
    seen.add(slide.id)
    out.push(slide)
  }
  return out
}

/** Always-renderable version of a (possibly half-edited) slide, for previews. */
export function sanitizeSlideForPreview(slide: Slide): Slide {
  return sanitizeSlide(slide) ?? slide
}

/**
 * What a slide is missing to be publishable, as a human phrase (or null if
 * complete). Used to guard the slide editor's Save and the pre-publish check, so
 * a blank slide never reaches the booth screen.
 */
export function slideMissing(s: Slide): string | null {
  switch (s.type) {
    case 'title':
      return s.title.trim() ? null : 'a title'
    case 'checklist':
      if (!s.title.trim()) return 'a title'
      if (!s.items.some((i) => i.trim())) return 'at least one item'
      return null
    case 'hazard':
      if (!s.hazard.trim()) return 'a hazard label'
      if (!s.steps.some((i) => i.trim())) return 'at least one step'
      return null
    case 'quiz':
      if (!s.question.trim()) return 'a question'
      if (s.options.filter((o) => o.trim()).length < 2) return 'at least two options'
      return null
  }
}

/** A fresh blank slide of the given type, for the "Add" action. */
export function newSlide(type: Slide['type']): Slide {
  const id = genId(type)
  switch (type) {
    case 'title':
      return { id, type, durationMs: 8000, title: 'New title slide', subtitle: '' }
    case 'checklist':
      return {
        id,
        type,
        durationMs: 14000,
        kicker: 'Build Your Kit',
        icon: '✅',
        title: 'New checklist',
        items: ['First item', 'Second item'],
      }
    case 'hazard':
      return {
        id,
        type,
        durationMs: 13000,
        kicker: 'Hazard',
        icon: '⚠️',
        hazard: 'Hazard name',
        headline: 'What to do.',
        steps: ['First step', 'Second step'],
      }
    case 'quiz':
      return {
        id,
        type,
        durationMs: 12000,
        kicker: 'Quick Quiz',
        revealAfterMs: 6500,
        question: 'Your question?',
        options: ['Option A', 'Option B', 'Option C'],
        answerIndex: 0,
        explanation: '',
      }
  }
}

/** The built-in default deck (for "reset" and editor seeding). */
export const builtInDeck = defaultSlides
