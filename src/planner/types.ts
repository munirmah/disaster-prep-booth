import type { Hazard } from '../config'
import type { StoreColorKey } from './store-colors'

/**
 * Data-driven planner model.
 *
 * Everything the booth recommends — the questions asked, the stores, the items,
 * their prices, and HOW MUCH to buy — is DATA in `plan-config.ts`, interpreted
 * by `engine.ts`. No code changes needed to re-tune the plan; edit the config.
 */

/** A visitor's answers, keyed by question id. Booleans count as 1/0 in formulas. */
export type Responses = Record<string, number | boolean>

/** A numeric "−/+" question (e.g. how many adults). */
export interface CounterQuestion {
  id: string
  type: 'counter'
  label: string
  hint?: string
  default: number
  min?: number
  max?: number
}

/** A yes/no question (e.g. anyone with medical needs). */
export interface ToggleQuestion {
  id: string
  type: 'toggle'
  label: string
  hint?: string
  default: boolean
}

export type Question = CounterQuestion | ToggleQuestion

export interface StoreDef {
  id: string
  label: string
  /** Accent color key for shopping-list wayfinding (dot + left border). */
  color?: StoreColorKey
  /** When explicitly false, the store + its items are dropped from the plan
   *  (a quick mute toggle in the admin). Absent/true = active. */
  enabled?: boolean
}

/**
 * A declarative quantity formula. The engine computes a raw demand, then
 * converts it to whole packages to buy:
 *
 *   raw   = base
 *         + Σ per[k]        × count(k)
 *         + Σ perPerDay[k]  × count(k) × days
 *   packs = ceil(raw / packSize)        // then clamped to [min, max]
 *
 * `k` is a question id (e.g. "adults") or a derived aggregate (e.g. "people").
 * Examples:
 *   2 gallons per adult per day, sold in 5-gal cases:
 *     { perPerDay: { adults: 2 }, packSize: 5 }
 *   5 lbs of rice per person (whole period), 5-lb bag:
 *     { per: { people: 5 }, packSize: 5 }
 *   one per household, plus one more once you hit 5 people:
 *     { per: { people: 0.2 }, min: 1 }
 */
export interface Formula {
  /** Flat baseline demand, regardless of household size. */
  base?: number
  /** One-time demand per unit of a question/aggregate (not multiplied by days). */
  per?: Record<string, number>
  /** Demand per unit per day (multiplied by the prep window). */
  perPerDay?: Record<string, number>
  /** Demand units per purchasable package (default 1). */
  packSize?: number
  /** Floor on packages once the item is included. */
  min?: number
  /** Cap on packages. */
  max?: number
}

/** Gates whether an item appears at all. All present checks must pass. */
export interface Condition {
  /** Every listed question/aggregate must be > 0 (or a toggle = true). */
  whenPositive?: string[]
  /** Each listed question/aggregate must be >= the given value. */
  whenAtLeast?: Record<string, number>
  /** At least one of these hazards must be active for this booth. */
  whenHazardsAny?: Hazard[]
}

export interface Item {
  id: string
  name: string
  category: string // key into PlannerConfig.categoryLabels
  store: string // id of a StoreDef
  product: string
  /** Optional direct link to the store's product page. When set, the product
   *  name in the shopping list becomes a tappable link. */
  url?: string
  unitPrice: number
  unit: string
  /** A short practical tip shown inline under the product (e.g. "Ask your
   *  pharmacist about an emergency refill"). Always visible — keep it terse. */
  note?: string
  /** One or two sentences on WHY this item matters in an emergency. Surfaced on
   *  the phone behind a tappable "Why this?" disclosure so the list stays
   *  scannable. Educational, not instructional — distinct from `note`. */
  rationale?: string
  formula: Formula
  condition?: Condition
  /** When explicitly false, the item is kept but excluded from the plan (a
   *  quick mute toggle in the admin). Absent/true = active. */
  enabled?: boolean
}

/** The whole editable configuration. */
export interface PlannerConfig {
  /** Derived sums available to formulas/conditions, e.g. people = adults+children+infants. */
  aggregates?: Record<string, string[]>
  categoryLabels: Record<string, string>
  /** Display order for categories (ids); unlisted ones fall to the end. */
  categoryOrder?: string[]
  questions: Question[]
  stores: StoreDef[]
  items: Item[]
}

// ── Computed plan ────────────────────────────────────────────────────

export interface PlannedItem {
  item: Item
  qty: number
  lineTotal: number
}

export interface Plan {
  responses: Responses
  days: number
  hazards: Hazard[]
  /** Pre-rendered household summary, e.g. "2 adults, 1 child · 3-day supply". */
  summary: string
  /** Just the people part, e.g. "2 adults, 1 child" (no day window). */
  household: string
  /** Computed counts incl. aggregates (e.g. people), for display. */
  counts: Record<string, number>
  items: PlannedItem[]
  byStore: { store: StoreDef; items: PlannedItem[]; subtotal: number }[]
  byCategory: { category: string; label: string; items: PlannedItem[] }[]
  total: number
}
