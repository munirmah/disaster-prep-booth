import { DEFAULT_HAZARDS, PREP_DAYS, type Hazard } from '../config'
import { planConfig } from './plan-config'
import type { Item, Plan, PlannedItem, PlannerConfig, Question, Responses } from './types'

/** Default answers built from each question's `default`. */
export function defaultResponses(config: PlannerConfig = planConfig): Responses {
  const r: Responses = {}
  for (const q of config.questions) r[q.id] = q.default
  return r
}

/** Resolve responses (+ aggregates) to a flat numeric count map for formulas. */
function toCounts(responses: Responses, config: PlannerConfig): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const q of config.questions) {
    const v = responses[q.id] ?? q.default
    counts[q.id] = typeof v === 'boolean' ? (v ? 1 : 0) : v
  }
  for (const [name, members] of Object.entries(config.aggregates ?? {})) {
    counts[name] = members.reduce((sum, m) => sum + (counts[m] ?? 0), 0)
  }
  return counts
}

/** Whether an item's condition passes for the given counts/hazards. */
function isIncluded(item: Item, counts: Record<string, number>, hazards: Hazard[]): boolean {
  const c = item.condition
  if (!c) return true
  if (c.whenPositive?.some((id) => (counts[id] ?? 0) <= 0)) return false
  if (c.whenAtLeast && Object.entries(c.whenAtLeast).some(([id, v]) => (counts[id] ?? 0) < v))
    return false
  if (c.whenHazardsAny && !c.whenHazardsAny.some((h) => hazards.includes(h))) return false
  return true
}

/** Evaluate a declarative formula into a whole number of packages to buy. */
function packagesFor(item: Item, counts: Record<string, number>, days: number): number {
  const f = item.formula
  let raw = f.base ?? 0
  for (const [k, rate] of Object.entries(f.per ?? {})) raw += rate * (counts[k] ?? 0)
  for (const [k, rate] of Object.entries(f.perPerDay ?? {})) raw += rate * (counts[k] ?? 0) * days
  let packs = Math.ceil(raw / (f.packSize ?? 1))
  if (f.min !== undefined) packs = Math.max(packs, f.min)
  if (f.max !== undefined) packs = Math.min(packs, f.max)
  return Math.max(0, packs)
}

export interface PlanContext {
  days: number
  hazards: Hazard[]
}

/**
 * Pure: responses (+ booth context) -> a complete, grouped Plan.
 *
 * Walks the configured items, gates by condition, evaluates each formula, drops
 * zero-quantity items, then groups by store (shopping list) and category
 * (checklist). Everything downstream consumes this one Plan.
 */
export function generatePlan(
  responses: Responses,
  ctx: PlanContext = { days: PREP_DAYS, hazards: DEFAULT_HAZARDS },
  config: PlannerConfig = planConfig,
): Plan {
  const counts = toCounts(responses, config)

  // Stores can be muted in the admin; their items drop out of the plan.
  const disabledStores = new Set(
    config.stores.filter((s) => s.enabled === false).map((s) => s.id),
  )

  const items: PlannedItem[] = config.items
    .filter(
      (item) =>
        item.enabled !== false &&
        !disabledStores.has(item.store) &&
        isIncluded(item, counts, ctx.hazards),
    )
    .map((item) => {
      const qty = packagesFor(item, counts, ctx.days)
      return { item, qty, lineTotal: qty * item.unitPrice }
    })
    .filter((p) => p.qty > 0)

  const byStore = config.stores
    .map((store) => {
      const storeItems = items.filter((p) => p.item.store === store.id)
      return {
        store,
        items: storeItems,
        subtotal: storeItems.reduce((sum, p) => sum + p.lineTotal, 0),
      }
    })
    .filter((g) => g.items.length > 0)

  const order = config.categoryOrder ?? Object.keys(config.categoryLabels)
  const seen = [...new Set(items.map((p) => p.item.category))]
  const byCategory = [...seen]
    .sort((a, b) => indexOr(order, a) - indexOr(order, b))
    .map((category) => ({
      category,
      label: config.categoryLabels[category] ?? category,
      items: items.filter((p) => p.item.category === category),
    }))

  return {
    responses,
    days: ctx.days,
    hazards: ctx.hazards,
    summary: buildSummary(counts, ctx.days, config),
    household: householdSummary(counts, config),
    counts,
    items,
    byStore,
    byCategory,
    total: items.reduce((sum, p) => sum + p.lineTotal, 0),
  }
}

const indexOr = (arr: string[], v: string) => {
  const i = arr.indexOf(v)
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

export const formatUsd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/**
 * Narrow a plan to only the items whose ids are in `keep`, recomputing the
 * store/category groupings and totals. Used so the PDF/email contain exactly
 * what the visitor selected on screen.
 */
export function selectItems(plan: Plan, keep: Set<string>): Plan {
  const items = plan.items.filter((p) => keep.has(p.item.id))
  const byStore = plan.byStore
    .map((g) => {
      const kept = g.items.filter((p) => keep.has(p.item.id))
      return { store: g.store, items: kept, subtotal: sum(kept) }
    })
    .filter((g) => g.items.length > 0)
  const byCategory = plan.byCategory
    .map((g) => ({ ...g, items: g.items.filter((p) => keep.has(p.item.id)) }))
    .filter((g) => g.items.length > 0)
  return { ...plan, items, byStore, byCategory, total: sum(items) }
}

const sum = (items: { lineTotal: number }[]) => items.reduce((s, p) => s + p.lineTotal, 0)

/** Just the people part, e.g. "2 adults, 1 child" (no day window). */
export function householdSummary(counts: Record<string, number>, config: PlannerConfig): string {
  const parts = config.questions
    .filter((q): q is Extract<Question, { type: 'counter' }> => q.type === 'counter')
    .map((q) => {
      const n = counts[q.id] ?? 0
      if (n <= 0) return null
      return `${n} ${pluralize(q.label, n)}`
    })
    .filter((s): s is string => s !== null)
  return parts.join(', ')
}

/** Build the full summary, e.g. "2 adults, 1 child · 3-day supply". */
function buildSummary(counts: Record<string, number>, days: number, config: PlannerConfig): string {
  return `${householdSummary(counts, config)} · ${days}-day supply`
}

/** Total people across the people aggregate (falls back to summing counters). */
export function peopleCount(plan: Plan): number {
  return plan.counts.people ?? 0
}

export const storeLabel = (id: string, config: PlannerConfig = planConfig): string =>
  config.stores.find((s) => s.id === id)?.label ?? id

// Counter labels in plan-config are written plural ("Adults", "Children").
// Use them as-is for n != 1, and singularize for exactly one.
function pluralize(label: string, n: number): string {
  const word = label.toLowerCase()
  if (n === 1) return word === 'children' ? 'child' : word.replace(/s$/, '')
  return word === 'child' ? 'children' : word
}
