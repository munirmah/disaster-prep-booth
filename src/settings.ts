import { DEFAULT_HAZARDS, PREP_DAYS, type Hazard } from './config'

/**
 * Booth settings (prep window + active hazards). These live inside the single
 * content document (see content/store.tsx) and are edited in the admin. The
 * built-in defaults come from src/config.ts (env-overridable at build).
 */
export type PlanMode = 'shopping' | 'prep'

export interface Settings {
  prepDays: number
  hazards: Hazard[]
  /** How the phone's result list is organised and framed. */
  planMode: PlanMode
}

export const DEFAULT_SETTINGS: Settings = {
  prepDays: PREP_DAYS,
  hazards: DEFAULT_HAZARDS,
  planMode: 'shopping',
}

export const ALL_HAZARDS: { id: Hazard; label: string }[] = [
  { id: 'winter', label: 'Winter storm' },
  { id: 'flood', label: 'Flood' },
  { id: 'hurricane', label: 'Hurricane / wind' },
  { id: 'shelter', label: 'Shelter-in-place' },
  { id: 'earthquake', label: 'Earthquake' },
  { id: 'wildfire', label: 'Wildfire' },
]

const VALID_HAZARDS = ALL_HAZARDS.map((h) => h.id)

/** Coerce arbitrary parsed input into valid Settings, falling back to defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    if (typeof r.prepDays === 'number' && Number.isFinite(r.prepDays)) {
      s.prepDays = Math.min(60, Math.max(1, Math.round(r.prepDays)))
    }
    if (Array.isArray(r.hazards)) {
      const hz = r.hazards.filter((h): h is Hazard => VALID_HAZARDS.includes(h as Hazard))
      if (hz.length) s.hazards = [...new Set(hz)]
    }
    if (r.planMode === 'shopping' || r.planMode === 'prep') s.planMode = r.planMode
  }
  return s
}
