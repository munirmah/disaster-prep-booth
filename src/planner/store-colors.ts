/**
 * Controlled per-store accent palette. Stores carry a `color` KEY (not raw hex)
 * so the choice stays a small, fixed set — it can never drift into rainbow, and
 * a non-coder picks from swatches in the admin. Rendered only as a small dot +
 * a thin left border on the shopping list; store heading text stays uniform.
 *
 * Values are tuned for the white phone/admin surface (mid for the dot, pale for
 * the left border).
 */
export type StoreColorKey = 'blue' | 'teal' | 'amber' | 'rose' | 'violet' | 'green' | 'slate'

export const STORE_COLORS: Record<StoreColorKey, { dot: string; border: string }> = {
  blue: { dot: '#0069b4', border: '#bfdcee' }, // HF blue (default)
  teal: { dot: '#0f766e', border: '#bfe0db' },
  amber: { dot: '#b45309', border: '#f0d9b5' },
  rose: { dot: '#be123c', border: '#f3c2cd' },
  violet: { dot: '#6d28d9', border: '#d8c8f3' },
  green: { dot: '#15803d', border: '#c2e0cc' },
  slate: { dot: '#475569', border: '#cdd5df' },
}

export const STORE_COLOR_KEYS = Object.keys(STORE_COLORS) as StoreColorKey[]

const DEFAULT_KEY: StoreColorKey = 'blue'

/** True if `v` is a known store-color key (used by sanitization + resolve). */
export function isStoreColorKey(v: unknown): v is StoreColorKey {
  return typeof v === 'string' && v in STORE_COLORS
}

/** Resolve a store's (possibly missing/invalid) color to a concrete swatch. */
export function storeColor(key: string | undefined): { dot: string; border: string } {
  return STORE_COLORS[isStoreColorKey(key) ? key : DEFAULT_KEY]
}
