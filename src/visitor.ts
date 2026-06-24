import type { Responses } from './planner/types'

/**
 * Persists a VISITOR's progress on their own phone (the /#/plan surface) so a
 * refresh or screen-lock doesn't drop their household answers and their
 * "Have it" marks. Stored in localStorage with a TTL so an old session doesn't
 * resurrect days later. Cleared on "Start over".
 *
 * This is the visitor's device — separate from the booth laptop's settings
 * (see settings.ts).
 */
const KEY = 'dpb.visitor'
const TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

interface StoredSession {
  responses: Responses
  have: string[]
  days?: number
  ts: number
}

export interface VisitorSession {
  responses: Responses | null
  have: Set<string>
  /** The visitor's chosen prep window, if they changed it; null = use booth default. */
  days: number | null
}

export function loadSession(): VisitorSession {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { responses: null, have: new Set(), days: null }
    const s = JSON.parse(raw) as StoredSession
    if (!s || typeof s !== 'object' || Date.now() - (s.ts ?? 0) > TTL_MS) {
      localStorage.removeItem(KEY)
      return { responses: null, have: new Set(), days: null }
    }
    const days = typeof s.days === 'number' && Number.isFinite(s.days) ? s.days : null
    return { responses: s.responses ?? null, have: new Set(s.have ?? []), days }
  } catch {
    return { responses: null, have: new Set(), days: null }
  }
}

export function saveSession(responses: Responses, have: Set<string>, days: number): void {
  try {
    const payload: StoredSession = { responses, have: [...have], days, ts: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    // ignore quota / private-mode failures
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
