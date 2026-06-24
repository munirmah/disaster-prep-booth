/**
 * Booth-level configuration. These are the knobs a Humanity First organizer
 * tweaks per event — they are NOT asked on the visitor form.
 *
 * - PREP_DAYS / DEFAULT_HAZARDS drive how much the planner recommends.
 * - PLAN_URL is what the booth QR code encodes (where phones land).
 *
 * Email is configured server-side via EMAIL_WEBHOOK_URL (no rebuild needed).
 * See deploy/README.md.
 *
 * Env vars (optional, set in a .env file — see .env.example) override the
 * defaults so the same build can be re-pointed without code changes.
 */

export type Hazard =
  | 'earthquake'
  | 'wildfire'
  | 'flood'
  | 'hurricane'
  | 'winter'
  | 'shelter' // shelter-in-place: radiological / hazmat / national emergency

/** Recommended number of days of supplies. Default 7; presets are 7/15/30. */
export const PREP_DAYS: number = numberEnv(import.meta.env.VITE_PREP_DAYS, 7)

/**
 * Region hazards to tailor the list. Edit per booth location.
 * Default = DMV (DC/Maryland/Virginia): winter storms, flooding,
 * tropical/derecho wind damage, plus shelter-in-place readiness.
 * (Earthquake/wildfire are negligible here.)
 */
export const DEFAULT_HAZARDS: Hazard[] = parseHazards(
  import.meta.env.VITE_HAZARDS,
  ['winter', 'flood', 'hurricane', 'shelter'],
)

/**
 * Absolute URL the booth QR points to (the phone form). The planner is the
 * app's root route, so this is just the current origin + path — it "just works"
 * on whatever host we land on. Override with VITE_PLAN_URL if the booth and form
 * are served from different hosts.
 */
export function planUrl(): string {
  const override = import.meta.env.VITE_PLAN_URL
  if (override) return override
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${window.location.pathname}`
  }
  return '/'
}

/**
 * How the on-screen checklist behaves and what the PDF/email contain:
 *  - 'selection': items start checked; unchecking removes them; the total, PDF,
 *    and email reflect ONLY checked items (a tailored shopping list).
 *  - 'full': the PDF/email/total are always the complete recommended kit;
 *    on-screen checking is just a gathering aid that doesn't change the output.
 */

function numberEnv(v: string | undefined, fallback: number): number {
  const n = v ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

function parseHazards(v: string | undefined, fallback: Hazard[]): Hazard[] {
  if (!v) return fallback
  const valid: Hazard[] = [
    'earthquake',
    'wildfire',
    'flood',
    'hurricane',
    'winter',
    'shelter',
  ]
  const picked = v
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Hazard => (valid as string[]).includes(s))
  return picked.length ? picked : fallback
}
