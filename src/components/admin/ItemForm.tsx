import { useState } from 'react'
import type { Hazard } from '../../config'
import { ALL_HAZARDS } from '../../settings'
import type { Formula, Item, PlannerConfig } from '../../planner/types'
import { parseItem } from '../../planner/parse-item'

/** A per-driver rate row in the (advanced) custom formula editor. */
type Row = { key: string; rate: number; perDay: boolean }

/** Which quantity pattern an item uses — drives the friendly editor. */
type Mode = 'household' | 'per' | 'perDay' | 'custom'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function toRows(f: Formula): Row[] {
  const rows: Row[] = []
  for (const [key, rate] of Object.entries(f.per ?? {})) rows.push({ key, rate, perDay: false })
  for (const [key, rate] of Object.entries(f.perPerDay ?? {})) rows.push({ key, rate, perDay: true })
  return rows
}

/** Replace only per/perPerDay on a formula from the editor rows. */
function withRows(f: Formula, rows: Row[]): Formula {
  const per: Record<string, number> = {}
  const perPerDay: Record<string, number> = {}
  for (const r of rows) {
    if (!r.key) continue
    ;(r.perDay ? perPerDay : per)[r.key] = r.rate
  }
  const next: Formula = { ...f }
  delete next.per
  delete next.perPerDay
  if (Object.keys(per).length) next.per = per
  if (Object.keys(perPerDay).length) next.perPerDay = perPerDay
  return next
}

/**
 * Detect which simple pattern a formula matches so the editor opens on it.
 * Anything that isn't "one baseline", "one per-X rule", or "one per-X-per-day
 * rule" (e.g. several rules, or a baseline plus a rule) falls back to Custom.
 */
function detectMode(f: Formula): Mode {
  const per = Object.keys(f.per ?? {})
  const ppd = Object.keys(f.perPerDay ?? {})
  const hasBase = (f.base ?? 0) > 0
  if (!per.length && !ppd.length) return 'household'
  if (per.length === 1 && !ppd.length && !hasBase) return 'per'
  if (ppd.length === 1 && !per.length && !hasBase) return 'perDay'
  return 'custom'
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'household', label: 'Per household' },
  { id: 'per', label: 'Per person' },
  { id: 'perDay', label: 'Per person, daily' },
  { id: 'custom', label: 'Custom' },
]

/**
 * Edit one planner item: store/product/price + a friendly "how much to buy"
 * section (quantity presets, with pack size / limits and an include-condition
 * tucked away) and a live readout. Controlled — reports updates via onChange.
 */
export function ItemForm({
  item,
  planner,
  onChange,
}: {
  item: Item
  planner: PlannerConfig
  onChange: (item: Item) => void
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(item.formula))
  // Lets the user pin "Custom" even when the formula currently looks simple
  // (so they can add a second rule); cleared when a simple preset is picked.
  const [forceCustom, setForceCustom] = useState(() => detectMode(item.formula) === 'custom')
  const [quick, setQuick] = useState('')
  const [understood, setUnderstood] = useState<string[]>([])

  const set = (patch: Partial<Item>) => onChange({ ...item, ...patch })
  const setFormula = (patch: Partial<Formula>) => set({ formula: { ...item.formula, ...patch } })
  const applyRows = (next: Row[]) => {
    setRows(next)
    set({ formula: withRows(item.formula, next) })
  }

  // Drivers a rate can scale by: derived aggregates (people) + each question.
  const drivers = [
    ...Object.keys(planner.aggregates ?? {}).map((k) => ({ key: k, label: cap(k) })),
    ...planner.questions.map((q) => ({ key: q.id, label: q.label })),
  ]
  const driverLabel = (key: string) => drivers.find((d) => d.key === key)?.label ?? key
  const defaultDriver = planner.aggregates && 'people' in planner.aggregates ? 'people' : (drivers[0]?.key ?? '')

  const mode: Mode = forceCustom ? 'custom' : detectMode(item.formula)

  // The single per/per-day rule that the simple modes edit (if any).
  const singleEntry =
    Object.entries(item.formula.per ?? {})[0] ?? Object.entries(item.formula.perPerDay ?? {})[0]
  const ruleDriver = singleEntry?.[0] ?? defaultDriver
  const ruleRate = singleEntry?.[1] ?? 1

  const setMode = (next: Mode) => {
    if (next === 'custom') {
      setForceCustom(true)
      setRows(toRows(item.formula)) // keep the formula, sync the row editor
      return
    }
    setForceCustom(false)
    const keep = { packSize: item.formula.packSize, min: item.formula.min, max: item.formula.max }
    if (next === 'household') set({ formula: { ...keep, base: item.formula.base || 1 } })
    else if (next === 'per') set({ formula: { ...keep, per: { [ruleDriver]: ruleRate } } })
    else set({ formula: { ...keep, perPerDay: { [ruleDriver]: ruleRate } } })
  }

  /** Parse the free-text quick-add box and fill the structured fields. */
  const quickFill = () => {
    if (!quick.trim()) return
    const r = parseItem(quick, planner)
    let formula = r.formula ?? item.formula
    if (r.packSize != null) formula = { ...formula, packSize: r.packSize }
    setForceCustom(false)
    setRows(toRows(formula))
    onChange({ ...item, ...r.patch, formula })
    setUnderstood(r.understood)
  }

  /** Write the one rule that per/per-day modes manage (clears base + the other). */
  const setSingleRule = (driver: string, rate: number, perDay: boolean) => {
    const f: Formula = { ...item.formula }
    delete f.base
    delete f.per
    delete f.perPerDay
    if (perDay) f.perPerDay = { [driver]: rate }
    else f.per = { [driver]: rate }
    set({ formula: f })
  }

  // Condition (collapsed unless one already exists).
  const cond = item.condition ?? {}
  const always = !cond.whenPositive?.length && !cond.whenHazardsAny?.length
  const setCond = (patch: Partial<NonNullable<Item['condition']>>) => {
    const next = { ...cond, ...patch }
    if (!next.whenPositive?.length) delete next.whenPositive
    if (!next.whenHazardsAny?.length) delete next.whenHazardsAny
    set({ condition: Object.keys(next).length ? next : undefined })
  }

  // Collapsed-section summaries (shown on the right when a section is closed).
  const detailBits = [item.url && 'link', item.note && 'tip', item.rationale && 'why'].filter(
    Boolean,
  ) as string[]
  const condSummary = always
    ? 'Always included'
    : [
        cond.whenPositive?.length
          ? 'if ' +
            cond.whenPositive.map((id) => planner.questions.find((q) => q.id === id)?.label ?? id).join(', ')
          : null,
        cond.whenHazardsAny?.length
          ? 'for ' + cond.whenHazardsAny.map((h) => ALL_HAZARDS.find((x) => x.id === h)?.label ?? h).join(', ')
          : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Conditional'

  return (
    <div className="space-y-4 text-sm">
      {/* Quick add — type a plain description, parse it into the fields below. */}
      <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
          ✨ Quick add — describe it
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                quickFill()
              }
            }}
            placeholder="1 gallon water per person per day from Costco, $4.99 per 5-gal case"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
          />
          <button
            type="button"
            onClick={quickFill}
            className="flex-none rounded-lg bg-[var(--primary)] px-4 py-2 font-bold text-white active:opacity-90"
          >
            Fill
          </button>
        </div>
        {understood.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">Understood: {understood.join(' · ')}</p>
        )}
      </div>

      <Field label="Item name">
        <Text value={item.name} onChange={(v) => set({ name: v })} placeholder="e.g. Drinking water" />
      </Field>
      <div className="flex gap-3">
        <Field label="Store" className="flex-1">
          <Select
            value={item.store}
            onChange={(v) => set({ store: v })}
            options={planner.stores.map((s) => ({ value: s.id, label: s.label }))}
          />
        </Field>
        <Field label="Category" className="flex-1">
          <Select
            value={item.category}
            onChange={(v) => set({ category: v })}
            options={Object.entries(planner.categoryLabels).map(([value, label]) => ({ value, label }))}
          />
        </Field>
      </div>
      <Field label="Product (example to buy)">
        <Text value={item.product} onChange={(v) => set({ product: v })} placeholder="e.g. Kirkland 40-pack 16.9oz bottled water" />
      </Field>
      <div className="flex gap-3">
        <Field label="Price ($ per unit)" className="flex-1">
          <Num value={item.unitPrice} step={0.01} onChange={(n) => set({ unitPrice: n })} />
        </Field>
        <Field label="Unit (case, bag…)" className="flex-1">
          <Text value={item.unit} onChange={(v) => set({ unit: v })} />
        </Field>
      </div>
      <Disclosure
        title="Details — link, tip & why"
        summary={detailBits.length ? detailBits.join(', ') : 'none yet'}
        defaultOpen={detailBits.length > 0}
      >
        <div className="space-y-4">
          <Field label="Store product page URL">
            <Text value={item.url ?? ''} onChange={(v) => set({ url: v || undefined })} placeholder="https://www.costco.com/…" />
          </Field>
          <Field label="Note — a practical tip">
            <Text value={item.note ?? ''} onChange={(v) => set({ note: v || undefined })} placeholder="e.g. Ask your pharmacist about an emergency refill" />
          </Field>
          <Field label="Why this? — the reason it matters">
            <Textarea
              value={item.rationale ?? ''}
              onChange={(v) => set({ rationale: v || undefined })}
              placeholder="e.g. Tap water can be unsafe after a disaster — one gallon per person covers drinking and hygiene."
            />
          </Field>
        </div>
      </Disclosure>

      {/* How much to buy */}
      <Disclosure title="How much to buy" summary={describe(item, driverLabel)}>
        {/* Quantity pattern */}
        <div className="grid grid-cols-2 gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${
                mode === m.id
                  ? 'bg-[var(--primary)] text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Pattern body */}
        <div className="mt-3">
          {mode === 'household' && (
            <Field label="How many to buy">
              <Num
                value={item.formula.base ?? 1}
                className="w-24"
                onChange={(n) => setFormula({ base: n || undefined })}
              />
            </Field>
          )}

          {(mode === 'per' || mode === 'perDay') && (
            <div className="flex items-center gap-2">
              <Num
                value={ruleRate}
                step={0.05}
                className="w-20"
                onChange={(n) => setSingleRule(ruleDriver, n, mode === 'perDay')}
              />
              <span className="flex-none text-slate-400">per</span>
              <Select
                className="min-w-0 flex-1"
                value={ruleDriver}
                onChange={(d) => setSingleRule(d, ruleRate, mode === 'perDay')}
                options={drivers.map((d) => ({ value: d.key, label: d.label }))}
              />
              {mode === 'perDay' && <span className="flex-none text-slate-400">/ day</span>}
            </div>
          )}

          {mode === 'custom' && (
            <div className="space-y-2">
              <Field label="Flat amount (per household)">
                <Num
                  value={item.formula.base ?? 0}
                  className="w-24"
                  onChange={(n) => setFormula({ base: n || undefined })}
                />
              </Field>
              <p className="text-xs font-semibold text-slate-500">Plus, for each:</p>
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Num
                    value={r.rate}
                    step={0.05}
                    className="w-20"
                    onChange={(n) => applyRows(rows.map((x, j) => (j === i ? { ...x, rate: n } : x)))}
                  />
                  <span className="flex-none text-slate-400">per</span>
                  <select
                    value={r.key}
                    onChange={(e) =>
                      applyRows(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))
                    }
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2"
                  >
                    <option value="">— choose —</option>
                    {drivers.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  <label className="flex flex-none items-center gap-1 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      checked={r.perDay}
                      onChange={(e) =>
                        applyRows(rows.map((x, j) => (j === i ? { ...x, perDay: e.target.checked } : x)))
                      }
                    />
                    /day
                  </label>
                  <button
                    type="button"
                    aria-label="Remove rule"
                    onClick={() => applyRows(rows.filter((_, j) => j !== i))}
                    className="flex-none px-1 text-lg text-slate-400"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => applyRows([...rows, { key: '', rate: 1, perDay: false }])}
                className="rounded-lg border border-dashed border-slate-300 px-3 py-1 text-xs font-semibold text-slate-500 transition-colors hover:border-[var(--primary)] hover:bg-slate-50 hover:text-[var(--primary)]"
              >
                + Add rule
              </button>
            </div>
          )}
        </div>

        {/* Live readout */}
        <div className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
          {describe(item, driverLabel)}
        </div>

        {/* Pack size + limits */}
        <p className="mt-3 text-xs font-bold uppercase tracking-widest text-slate-400">
          Pack size &amp; limits
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Field label="Sold in packs of" className="flex-1">
            <Num
              value={item.formula.packSize ?? 1}
              min={1}
              onChange={(n) => setFormula({ packSize: n > 1 ? n : undefined })}
            />
          </Field>
          <Field label="Min packs" className="flex-1">
            <Num value={item.formula.min ?? 0} onChange={(n) => setFormula({ min: n > 0 ? n : undefined })} />
          </Field>
          <Field label="Max packs (0 = none)" className="flex-1">
            <Num value={item.formula.max ?? 0} onChange={(n) => setFormula({ max: n > 0 ? n : undefined })} />
          </Field>
        </div>
      </Disclosure>

      {/* When to include */}
      <Disclosure title="When to include" summary={condSummary} defaultOpen={!always}>
        <p className="text-xs font-semibold text-slate-500">Only if any of these is more than 0:</p>
        <ChipMulti
          options={planner.questions.map((q) => ({ value: q.id, label: q.label }))}
          selected={cond.whenPositive ?? []}
          onToggle={(v) => {
            const cur = cond.whenPositive ?? []
            setCond({ whenPositive: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] })
          }}
        />
        <p className="mt-3 text-xs font-semibold text-slate-500">Only for these hazards:</p>
        <ChipMulti
          options={ALL_HAZARDS.map((h) => ({ value: h.id, label: h.label }))}
          selected={cond.whenHazardsAny ?? []}
          onToggle={(v) => {
            const cur = cond.whenHazardsAny ?? []
            const next = cur.includes(v as Hazard) ? cur.filter((x) => x !== v) : [...cur, v as Hazard]
            setCond({ whenHazardsAny: next })
          }}
        />
        {!always && (
          <button
            type="button"
            onClick={() => set({ condition: undefined })}
            className="mt-3 text-xs font-semibold text-slate-400 underline"
          >
            Clear — always include
          </button>
        )}
      </Disclosure>
    </div>
  )
}

/**
 * A titled, collapsible section. Shows a one-line summary on the right while
 * collapsed so the form stays scannable; the advanced controls live inside,
 * one tap away. Manages its own open state (seeded from `defaultOpen`).
 */
function Disclosure({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string
  summary?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex-none text-xs font-bold uppercase tracking-widest text-slate-400">{title}</span>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-slate-500">
          {open ? '' : summary}
        </span>
        <span className={`flex-none text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
      </button>
      {open && <div className="border-t border-slate-100 p-3">{children}</div>}
    </div>
  )
}

/** Plain-language description of an item's formula. */
function describe(item: Item, driverLabel: (k: string) => string): string {
  const f = item.formula
  const parts: string[] = []
  if (f.base) parts.push(`${f.base}`)
  for (const [k, r] of Object.entries(f.per ?? {})) parts.push(`${r} per ${driverLabel(k).toLowerCase()}`)
  for (const [k, r] of Object.entries(f.perPerDay ?? {}))
    parts.push(`${r} per ${driverLabel(k).toLowerCase()} per day`)
  let s = parts.length ? parts.join(' + ') : '0'
  if (f.packSize && f.packSize > 1) s = `(${s}) ÷ ${f.packSize}, rounded up`
  if (f.min) s += `, at least ${f.min}`
  if (f.max) s += `, at most ${f.max}`
  return `Buys: ${s} ${item.unit}(s)`
}

// ── field primitives ─────────────────────────────────────────────────
function Field({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-bold uppercase tracking-widest text-slate-400">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
function Text({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-slate-300 px-3 py-2"
    />
  )
}
function Textarea({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={2}
      className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 leading-relaxed"
    />
  )
}
function Num({
  value,
  onChange,
  step = 1,
  min = 0,
  className = 'w-full',
}: {
  value: number
  onChange: (n: number) => void
  step?: number
  min?: number
  className?: string
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      value={value}
      onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
      className={`${className} rounded-lg border border-slate-300 px-3 py-2`}
    />
  )
}
function Select({
  value,
  onChange,
  options,
  className = 'w-full',
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${className} rounded-lg border border-slate-300 px-3 py-2`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
function ChipMulti({
  options,
  selected,
  onToggle,
}: {
  options: { value: string; label: string }[]
  selected: string[]
  onToggle: (v: string) => void
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onToggle(o.value)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              on ? 'bg-[var(--primary)] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
