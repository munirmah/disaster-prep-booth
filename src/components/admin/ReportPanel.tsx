import { useCallback, useEffect, useState } from 'react'
import { ALL_HAZARDS } from '../../settings'
import type { PlannerConfig } from '../../planner/types'

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')
const STATS_URL = `${API_BASE}/api/stats`

interface Totals {
  planOpens?: number
  plansGenerated?: number
  pdfDownloads?: number
  emailsSent?: number
  takeaways?: number
  takeawayRate?: number
  peopleCovered?: number
  families?: number
  familiesWithKids?: number
  familiesWithInfants?: number
  familiesWithPets?: number
  familiesWithMedical?: number
}
interface DayRow {
  date: string
  planOpens: number
  plansGenerated: number
  takeaways: number
  peopleCovered: number
}
interface HourRow {
  hour: string
  planOpens: number
  plansGenerated: number
}
export interface ItemNeed {
  id: string
  appeared: number
  have: number
}
interface HazardRow {
  id: string
  count: number
}
export interface Stats {
  event: string
  events?: string[]
  range?: { from?: string; to?: string }
  totals: Totals
  byDay: DayRow[]
  byHour?: HourRow[]
  items?: ItemNeed[]
  hazards?: HazardRow[]
}

interface Filter {
  event: string // '' = all
  from: string // '' = all (YYYY-MM-DD)
  to: string
}

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; msg: string }
  | { kind: 'ready'; stats: Stats }

/**
 * Admin "Report" tab — anonymous funnel aggregates from /api/stats (same Bearer
 * credential as publishing). Beyond reach → engagement → takeaway and the
 * "people covered" impact line, it surfaces what the community already has vs.
 * needs (per item), peak hours, active hazards, and supports per-event / date
 * scoping. Exports CSV, a copyable summary, and a branded PDF.
 */
export function ReportPanel({
  getCredential,
  planner,
}: {
  getCredential: () => Promise<string>
  planner: PlannerConfig
}) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [clearing, setClearing] = useState<'idle' | 'confirm' | 'working'>('idle')
  const [filter, setFilter] = useState<Filter>({ event: '', from: '', to: '' })
  const [auto, setAuto] = useState(false)

  const itemName = useCallback(
    (id: string) => planner.items.find((it) => it.id === id)?.name ?? id,
    [planner],
  )
  const hazardLabel = (id: string) => ALL_HAZARDS.find((h) => h.id === id)?.label ?? id

  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoad({ kind: 'loading' })
      try {
        const cred = await getCredential()
        const qs = new URLSearchParams()
        if (filter.event) qs.set('event', filter.event)
        if (filter.from) qs.set('from', filter.from)
        if (filter.to) qs.set('to', filter.to)
        const url = qs.toString() ? `${STATS_URL}?${qs}` : STATS_URL
        const res = await fetch(url, { headers: { Authorization: `Bearer ${cred}` } })
        if (res.status === 401) {
          setLoad({ kind: 'error', msg: 'Not authorized — sign in / enter the passphrase to view the report.' })
          return
        }
        if (!res.ok) {
          setLoad({ kind: 'error', msg: `Couldn’t load the report (server ${res.status}).` })
          return
        }
        setLoad({ kind: 'ready', stats: (await res.json()) as Stats })
      } catch {
        setLoad({ kind: 'error', msg: 'Couldn’t reach the server. Reports need the booth binary running.' })
      }
    },
    [getCredential, filter],
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  // Live mode — poll quietly so the booth can watch numbers climb during an event.
  useEffect(() => {
    if (!auto) return
    const id = window.setInterval(() => refresh(true), 15000)
    return () => window.clearInterval(id)
  }, [auto, refresh])

  const handleClear = useCallback(async () => {
    setClearing('working')
    try {
      const cred = await getCredential()
      await fetch(STATS_URL, { method: 'DELETE', headers: { Authorization: `Bearer ${cred}` } })
    } finally {
      setClearing('idle')
      refresh()
    }
  }, [getCredential, refresh])

  if (load.kind === 'loading') {
    return <p className="py-10 text-center text-sm text-slate-400">Loading report…</p>
  }
  if (load.kind === 'error') {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-[var(--accent)]">{load.msg}</p>
        <button
          type="button"
          onClick={() => refresh()}
          className="mt-3 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-bold text-white active:opacity-90"
        >
          Try again
        </button>
      </div>
    )
  }

  const { stats } = load
  const t = stats.totals
  const opens = t.planOpens ?? 0
  const plans = t.plansGenerated ?? 0
  const takeaways = t.takeaways ?? 0
  const ratePct = Math.round((t.takeawayRate ?? 0) * 100)
  const empty = opens === 0 && plans === 0
  const events = stats.events ?? []

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-lg font-black text-slate-900">Booth report</h3>
          <p className="text-xs text-slate-500">
            {stats.event}
            {stats.range?.from ? ` · ${dateRange(stats.range.from, stats.range.to)}` : ''}
            {' · anonymous, no personal data'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            Live
          </label>
          <button
            type="button"
            onClick={() => refresh()}
            className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 active:bg-slate-50"
          >
            ↻ Refresh
          </button>
          {!empty && (
            <>
              <button
                type="button"
                onClick={() => copySummary(stats, itemName)}
                className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 active:bg-slate-50"
              >
                Copy summary
              </button>
              <button
                type="button"
                onClick={() => downloadCsv(stats)}
                className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 active:bg-slate-50"
              >
                ⬇ CSV
              </button>
              <button
                type="button"
                onClick={async () => {
                  const { saveReportPdf } = await import('./report-pdf')
                  await saveReportPdf(stats, itemName)
                }}
                className="rounded-xl bg-[var(--primary)] px-3 py-2 text-sm font-bold text-white active:opacity-90"
              >
                ⬇ PDF report
              </button>
              {clearing === 'idle' && (
                <button
                  type="button"
                  onClick={() => setClearing('confirm')}
                  className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--accent)] ring-1 ring-slate-200 active:bg-slate-50"
                >
                  Clear data
                </button>
              )}
              {clearing === 'confirm' && (
                <span className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-[var(--accent)]">
                  <span className="text-sm font-semibold text-slate-700">Erase all event data?</span>
                  <button type="button" onClick={handleClear} className="rounded-lg bg-[var(--accent)] px-2 py-0.5 text-sm font-bold text-white active:opacity-90">
                    Yes, clear
                  </button>
                  <button type="button" onClick={() => setClearing('idle')} className="text-sm font-semibold text-slate-500">
                    Cancel
                  </button>
                </span>
              )}
              {clearing === 'working' && (
                <span className="flex items-center rounded-xl bg-white px-3 py-2 text-sm text-slate-400 ring-1 ring-slate-200">Clearing…</span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Scope: which event + date window. */}
      {(events.length > 1 || !empty) && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-100">
          <Labeled label="Event">
            <select
              value={filter.event}
              onChange={(e) => setFilter((f) => ({ ...f, event: e.target.value }))}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">All events</option>
              {events.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="From">
            <input type="date" value={filter.from} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </Labeled>
          <Labeled label="To">
            <input type="date" value={filter.to} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </Labeled>
          {(filter.event || filter.from || filter.to) && (
            <button type="button" onClick={() => setFilter({ event: '', from: '', to: '' })} className="pb-1.5 text-xs font-semibold text-[var(--primary)]">
              Clear filters
            </button>
          )}
        </div>
      )}

      {empty ? (
        <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-100">
          No visits recorded in this view yet. Numbers appear as visitors scan the QR and build their plans.
        </p>
      ) : (
        <>
          {/* Headline metrics. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Phones reached" value={opens} hint="QR scans that opened the planner" />
            <Metric label="Plans built" value={plans} hint={`${pct(plans, opens)}% of phones reached`} />
            <Metric label="Left with a plan" value={takeaways} hint={`${ratePct}% of plans · 📄 ${t.pdfDownloads ?? 0} · ✉ ${t.emailsSent ?? 0}`} accent="secondary" />
            <Metric label="People covered" value={t.peopleCovered ?? 0} hint={`across ${t.families ?? 0} families`} accent="primary" />
          </div>

          <Funnel opens={opens} plans={plans} takeaways={takeaways} />

          {/* Community needs — what families already have vs. need. */}
          {(stats.items?.length ?? 0) > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <h4 className="mb-1 text-xs font-bold uppercase tracking-widest text-slate-400">What the community needs</h4>
              <p className="mb-2 text-xs text-slate-400">Share of families (who left with a list) that already had each item — biggest gaps first.</p>
              <div className="space-y-1.5 rounded-2xl bg-white p-4 ring-1 ring-slate-100">
                {[...(stats.items ?? [])]
                  .filter((it) => it.appeared > 0)
                  .sort((a, b) => a.have / a.appeared - b.have / b.appeared)
                  .map((it) => (
                    <NeedBar key={it.id} label={itemName(it.id)} have={it.have} appeared={it.appeared} />
                  ))}
              </div>
            </div>
          )}

          {/* Who we served. */}
          <div className="border-t border-slate-100 pt-3">
            <h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Who we served</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Mini label="With children" value={t.familiesWithKids ?? 0} of={t.families ?? 0} />
              <Mini label="With infants" value={t.familiesWithInfants ?? 0} of={t.families ?? 0} />
              <Mini label="With pets" value={t.familiesWithPets ?? 0} of={t.families ?? 0} />
              <Mini label="Medical needs" value={t.familiesWithMedical ?? 0} of={t.families ?? 0} />
            </div>
          </div>

          {/* Active hazards (what the booth was configured for). */}
          {(stats.hazards?.length ?? 0) > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Active hazards</h4>
              <div className="flex flex-wrap gap-2">
                {stats.hazards!.map((h) => (
                  <span key={h.id} className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
                    {hazardLabel(h.id)} · {h.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Peak hours. */}
          {(stats.byHour?.length ?? 0) > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Busiest hours</h4>
              <HourBars rows={stats.byHour ?? []} />
            </div>
          )}

          {/* Per-day breakdown + trend. */}
          <div className="border-t border-slate-100 pt-3">
            <h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">By day</h4>
            {stats.byDay.length > 1 && <Trend rows={stats.byDay} />}
            <div className="mt-2 overflow-hidden rounded-2xl ring-1 ring-slate-200">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 text-right font-semibold">Reached</th>
                    <th className="px-3 py-2 text-right font-semibold">Plans</th>
                    <th className="px-3 py-2 text-right font-semibold">Takeaways</th>
                    <th className="px-3 py-2 text-right font-semibold">People</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.byDay.map((d) => (
                    <tr key={d.date} className="bg-white">
                      <td className="px-3 py-2 font-medium text-slate-700">{d.date}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{d.planOpens}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{d.plansGenerated}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{d.takeaways}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{d.peopleCovered}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-bold uppercase tracking-widest text-slate-400">{label}</span>
      {children}
    </label>
  )
}

function Metric({ label, value, hint, accent }: { label: string; value: number; hint?: string; accent?: 'primary' | 'secondary' }) {
  const color = accent === 'primary' ? 'text-[var(--primary)]' : accent === 'secondary' ? 'text-[var(--secondary)]' : 'text-slate-900'
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-100">
      <div className={`text-3xl font-black tabular-nums ${color}`}>{value.toLocaleString()}</div>
      <div className="mt-1 text-sm font-semibold text-slate-700">{label}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

function Mini({ label, value, of }: { label: string; value: number; of: number }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100">
      <div className="text-xl font-black tabular-nums text-slate-900">{value}</div>
      <div className="text-xs font-semibold text-slate-600">{label}</div>
      <div className="text-xs text-slate-400">{pct(value, of)}% of families</div>
    </div>
  )
}

/** One item's "already have" share. Lower = a bigger community need. */
function NeedBar({ label, have, appeared }: { label: string; have: number; appeared: number }) {
  const p = pct(have, appeared)
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 flex-none truncate text-sm text-slate-700" title={label}>
        {label}
      </span>
      <div className="h-5 flex-1 overflow-hidden rounded-md bg-slate-100">
        <div
          className="h-full rounded-md"
          style={{ width: `${Math.max(p, p > 0 ? 4 : 0)}%`, backgroundColor: p < 40 ? 'var(--accent)' : 'var(--secondary)' }}
        />
      </div>
      <span className="w-28 flex-none text-right text-xs text-slate-500">{p}% already have</span>
    </div>
  )
}

function Funnel({ opens, plans, takeaways }: { opens: number; plans: number; takeaways: number }) {
  const max = Math.max(opens, 1)
  const rows = [
    { label: 'Reached', n: opens, color: 'var(--primary)' },
    { label: 'Built a plan', n: plans, color: 'var(--primary)' },
    { label: 'Left with it', n: takeaways, color: 'var(--secondary)' },
  ]
  return (
    <div className="space-y-2 rounded-2xl bg-white p-4 ring-1 ring-slate-100">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="w-24 flex-none text-xs font-semibold text-slate-600">{r.label}</span>
          <div className="h-6 flex-1 overflow-hidden rounded-md bg-slate-100">
            <div
              className="flex h-full items-center justify-end rounded-md px-2 text-xs font-bold text-white"
              style={{ width: `${Math.max((r.n / max) * 100, r.n > 0 ? 8 : 0)}%`, backgroundColor: r.color }}
            >
              {r.n > 0 ? r.n : ''}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Compact per-hour bar chart of phones reached (00–23, only hours with data). */
function HourBars({ rows }: { rows: HourRow[] }) {
  const max = Math.max(...rows.map((r) => r.planOpens), 1)
  return (
    <div className="flex items-end gap-1 rounded-2xl bg-white p-4 ring-1 ring-slate-100">
      {rows.map((r) => (
        <div key={r.hour} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${r.hour}:00 — ${r.planOpens} reached, ${r.plansGenerated} plans`}>
          <div className="flex h-20 w-full items-end">
            <div className="w-full rounded-t bg-[var(--primary)]" style={{ height: `${Math.max((r.planOpens / max) * 100, r.planOpens > 0 ? 6 : 0)}%` }} />
          </div>
          <span className="text-[10px] text-slate-400">{r.hour}</span>
        </div>
      ))}
    </div>
  )
}

/** A small SVG line of plans-per-day across the range. */
function Trend({ rows }: { rows: DayRow[] }) {
  const w = 600
  const h = 60
  const max = Math.max(...rows.map((r) => r.plansGenerated), 1)
  const step = rows.length > 1 ? w / (rows.length - 1) : 0
  const pts = rows.map((r, i) => `${(i * step).toFixed(1)},${(h - (r.plansGenerated / max) * (h - 8) - 4).toFixed(1)}`).join(' ')
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-100">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-16 w-full" aria-label="Plans per day trend">
        <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="mt-1 text-center text-[10px] text-slate-400">Plans per day</p>
    </div>
  )
}

function dateRange(from?: string, to?: string): string {
  const d = (s?: string) => (s ? s.slice(0, 10) : '')
  const a = d(from)
  const b = d(to)
  return a === b || !b ? a : `${a} → ${b}`
}

function summaryText(s: Stats, itemName: (id: string) => string): string {
  const t = s.totals
  const ratePct = Math.round((t.takeawayRate ?? 0) * 100)
  const needs = [...(s.items ?? [])]
    .filter((it) => it.appeared > 0)
    .sort((a, b) => a.have / a.appeared - b.have / b.appeared)
    .slice(0, 5)
    .map((it) => `  • ${itemName(it.id)}: ${pct(it.have, it.appeared)}% already have`)
  return [
    `Humanity First Disaster-Prep Booth — ${s.event}`,
    s.range?.from ? `Dates: ${dateRange(s.range.from, s.range.to)}` : '',
    '',
    `Phones reached: ${t.planOpens ?? 0}`,
    `Plans built: ${t.plansGenerated ?? 0}`,
    `Left with a plan (PDF/email): ${t.takeaways ?? 0} (${ratePct}% of plans) — PDF ${t.pdfDownloads ?? 0}, email ${t.emailsSent ?? 0}`,
    `People covered: ${t.peopleCovered ?? 0} across ${t.families ?? 0} families`,
    `  • with children: ${t.familiesWithKids ?? 0}`,
    `  • with infants: ${t.familiesWithInfants ?? 0}`,
    `  • with pets: ${t.familiesWithPets ?? 0}`,
    `  • with medical needs: ${t.familiesWithMedical ?? 0}`,
    needs.length ? '' : '',
    needs.length ? 'Biggest community needs (least already owned):' : '',
    ...needs,
  ]
    .filter((l) => l !== '')
    .join('\n')
}

function copySummary(s: Stats, itemName: (id: string) => string) {
  navigator.clipboard?.writeText(summaryText(s, itemName)).catch(() => {})
}

function downloadCsv(s: Stats) {
  const header = 'date,reached,plans,takeaways,people\n'
  const rows = s.byDay.map((d) => `${d.date},${d.planOpens},${d.plansGenerated},${d.takeaways},${d.peopleCovered}`)
  const csv = header + rows.join('\n') + '\n'
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `booth-report-${s.event}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
