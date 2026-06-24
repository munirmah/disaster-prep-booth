import type { Hazard } from '../config'
import { ALL_HAZARDS } from '../settings'
import type { Formula, Item, PlannerConfig } from './types'

/**
 * Parse a free-text item description into a structured Item patch — no AI, just
 * the same rule-based technique natural-language date pickers use: normalize
 * the string, run an ordered set of regex/keyword rules, and emit a structured
 * result. Whatever isn't recognized is simply left for the form to fill in.
 *
 * Understood today, e.g.:
 *   "1 gallon of water per person per day from Costco, $4.99 per 5-gal case"
 *   "first-aid kit, one per household, $24.99 from Target"
 *   "diapers 1 per infant per day, $39.99 box from Target"
 *   "tarp for floods and hurricanes from Lowe's, $19.97"
 *
 * Returns the metadata patch, plus `formula` (present only when a quantity
 * pattern was understood — it replaces base/per/perPerDay) and `packSize`
 * (merged into the formula), and an `understood` list for UI feedback.
 *
 * Hardened against malformed input: the string is length-capped (so the regex
 * rules stay linear-time), and every parsed number is range-checked, so junk
 * like negatives, zeros, thousands-commas, or overflowing values never reach
 * the published Item.
 */
export interface ParsedItem {
  patch: Partial<Item>
  formula?: Formula
  packSize?: number
  understood: string[]
}

/** Longest input we'll parse — admin item descriptions are short, and this
 *  keeps the regex rules from backtracking on pathological long inputs. */
const MAX_LEN = 200

/** Common words → a canonical driver key (resolved against the config's drivers). */
const DRIVER_SYNONYMS: { re: RegExp; key: string }[] = [
  { re: /^(?:persons?|people|heads?|members?)$/, key: 'people' },
  { re: /^adults?$/, key: 'adults' },
  { re: /^(?:child|children|kids?)$/, key: 'children' },
  { re: /^(?:infants?|bab(?:y|ies)|newborns?)$/, key: 'infants' },
  { re: /^pets?$/, key: 'pets' },
]

/** Words that name a purchasable package/unit. */
const CONTAINER =
  'cases?|bags?|box(?:es)?|packs?|cartons?|bundles?|bottles?|jugs?|sets?|kits?|rolls?|pairs?|tubes?|canisters?|jars?|cans?'

/** Measure-of-quantity words to drop from a parsed name (NOT container nouns,
 *  which are often part of a name like "first-aid kit" or "tool set"). */
const MEASURE_WORDS = new Set([
  'gallon', 'gallons', 'gal', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds',
  'liter', 'liters', 'litre', 'litres', 'ml', 'cup', 'cups', 'quart', 'quarts', 'qt',
  'count', 'ct', 'of',
])
/** Structural / filler words to drop from a parsed name. */
const FILLER_WORDS = new Set([
  'for', 'from', 'at', 'during', 'in', 'a', 'an', 'the', 'each', 'and', 'with',
  'only', 'sold', 'per', 'day', 'daily', 'plus', 'or',
])

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const singular = (s: string) => (s === 'boxes' ? 'box' : s.endsWith('s') ? s.slice(0, -1) : s)
const normWord = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Parse a numeric token (tolerating thousands commas) into a sane finite number,
 *  or undefined if it's negative, NaN, zero (when disallowed), or out of range. */
function num(
  token: string,
  { allowZero = true, max = 1_000_000 }: { allowZero?: boolean; max?: number } = {},
): number | undefined {
  const n = parseFloat(token.replace(/,/g, ''))
  if (!Number.isFinite(n) || n < 0 || n > max) return undefined
  if (!allowZero && n === 0) return undefined
  return n
}

export function parseItem(rawInput: string, planner: PlannerConfig): ParsedItem {
  const src = (rawInput ?? '').slice(0, MAX_LEN)
  const lower = src.toLowerCase()
  const understood: string[] = []
  const patch: Partial<Item> = {}
  // All rules match against `work`; each hit is blanked so later rules can't
  // re-read it (e.g. so a price's digits aren't mistaken for a pack size).
  let work = lower
  const mark = (m: RegExpMatchArray | null) => {
    if (m && m.index != null) {
      work = work.slice(0, m.index) + ' '.repeat(m[0].length) + work.slice(m.index + m[0].length)
    }
  }

  // ── price (take the first, but blank ALL so stray digits aren't reused) ──
  const prices = [...work.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g)]
  if (prices.length) {
    const p = num(prices[0][1])
    if (p != null) {
      patch.unitPrice = p
      understood.push(`$${p}`)
    }
    for (const pm of prices) mark(pm)
  }

  // ── store (match a configured label) ──
  for (const s of planner.stores) {
    const sm = new RegExp(`\\b${esc(s.label.toLowerCase())}\\b`).exec(work)
    if (sm) {
      patch.store = s.id
      understood.push(s.label)
      mark(sm)
      break
    }
  }

  // ── pack size + unit ──
  let packSize: number | undefined
  let unit: string | undefined
  let m = new RegExp(`\\b(${CONTAINER})\\s+of\\s+([\\d,]+)`).exec(work) // "case of 5"
  if (m) {
    unit = singular(m[1])
    packSize = num(m[2], { allowZero: false, max: 100_000 })
    mark(m)
  }
  if (!unit) {
    // "5-gallon case", "24 pack", "5 lb bag"
    m = new RegExp(
      `([\\d,]+)\\s*-?\\s*(?:gallon|gal|oz|ounce|lb|pound|liter|litre|l|ml|ct|count)?\\s*-?\\s*(${CONTAINER})\\b`,
    ).exec(work)
    if (m) {
      packSize = num(m[1], { allowZero: false, max: 100_000 })
      unit = singular(m[2])
      mark(m)
    }
  }
  if (!unit) {
    m = new RegExp(`([\\d,]+)\\s*per\\s+(${CONTAINER})\\b`).exec(work) // "5 per case"
    if (m) {
      packSize = num(m[1], { allowZero: false, max: 100_000 })
      unit = singular(m[2])
      mark(m)
    }
  }
  if (!unit) {
    m = new RegExp(`\\b(${CONTAINER}|each)\\b`).exec(work) // bare "bag"
    if (m) {
      unit = singular(m[1])
      mark(m)
    }
  }
  // Pack sizes of 1 (or invalid) don't change anything — treat as "no pack".
  if (packSize != null && packSize <= 1) packSize = undefined
  if (unit) {
    patch.unit = unit
    understood.push(packSize ? `${unit} of ${packSize}` : unit)
  }

  // ── quantity formula ──
  const perDay = /\b(?:per day|daily|each day|a day)\b|\/\s*day/.test(work)
  const drivers = [...Object.keys(planner.aggregates ?? {}), ...planner.questions.map((q) => q.id)]
  const mapDriver = (word: string): string | null => {
    for (const c of [word, word.replace(/s$/, ''), word + 's']) if (drivers.includes(c)) return c
    for (const s of DRIVER_SYNONYMS) if (s.re.test(word) && drivers.includes(s.key)) return s.key
    return null
  }

  let formula: Formula | undefined
  m = /(?:(-?\d[\d,]*)\s+)?(?:per|each|for(?: the)?|a)\s+(?:household|home|family)\b/.exec(work)
  if (m) {
    const base = m[1] == null ? 1 : num(m[1], { allowZero: false })
    if (base != null) {
      formula = { base }
      understood.push(`${base} per household`)
      mark(m)
    }
  } else {
    // [rate] [up to 3 filler words] per <driver>
    m = /(?:(-?\d[\d,]*(?:\.\d+)?)\s+(?:(?!per\b)[a-z-]+\s+){0,3})?per\s+(?!day\b)([a-z]+)/.exec(work)
    if (m) {
      const driver = mapDriver(m[2])
      const rate = m[1] == null ? 1 : num(m[1], { allowZero: false })
      if (driver && rate != null) {
        formula = perDay ? { perPerDay: { [driver]: rate } } : { per: { [driver]: rate } }
        understood.push(`${rate} per ${m[2]}${perDay ? ' per day' : ''}`)
        mark(m)
      }
    }
  }

  // ── condition: hazards, gated on "for / during / in case of" ──
  if (/\b(?:for|during|in case of)\b/.test(work)) {
    const hz: Hazard[] = []
    for (const h of ALL_HAZARDS) {
      const word = h.label.toLowerCase().split(/[^a-z]+/)[0]
      if (new RegExp(`\\b(?:${esc(h.id)}|${esc(word)})s?\\b`).test(work)) hz.push(h.id)
    }
    if (hz.length) {
      patch.condition = { whenHazardsAny: hz }
      understood.push(`for ${hz.join(', ')}`)
    }
  }

  // ── name / product: text before the first structural keyword, with the
  //    measure / store / hazard / filler words removed (keeps accented letters). ──
  const stop = new Set<string>()
  for (const w of MEASURE_WORDS) stop.add(w)
  for (const w of FILLER_WORDS) stop.add(w)
  if (patch.store) {
    const label = planner.stores.find((s) => s.id === patch.store)?.label ?? ''
    for (const w of label.split(/\s+/)) stop.add(normWord(w))
  }
  for (const id of patch.condition?.whenHazardsAny ?? []) {
    stop.add(normWord(id))
    const label = ALL_HAZARDS.find((h) => h.id === id)?.label ?? ''
    for (const w of label.split(/[^a-z]+/i)) if (w) stop.add(normWord(w))
  }
  const cleanName = (s: string) =>
    s
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
      .split(/\s+/)
      .filter((w) => {
        const n = normWord(w)
        return n !== '' && !/^\d+$/.test(n) && !stop.has(n)
      })
      .join(' ')
      .trim()

  // Cut at the earliest strong delimiter; rely on stop-word removal for the rest.
  let cut = src.length
  for (const re of [/,/, /\$/, /\sper\s/i, /\ssold\s/i]) {
    const mm = re.exec(src)
    if (mm && mm.index < cut) cut = mm.index
  }
  let name = cleanName(src.slice(0, cut))
  if (!name) {
    // Fallback: whatever's left after blanking the matched spans.
    name = cleanName(work)
  }
  if (name) {
    patch.name = cap(name)
    patch.product = name
    understood.unshift(`“${cap(name)}”`)
  }

  return { patch, formula, packSize, understood }
}
