import { ALL_HAZARDS } from '../../settings'
import type { Hazard } from '../../config'
import type { PlannerConfig } from '../../planner/types'

/**
 * Top-level "Hazards" editor. Hazards gate the phone shopping list — turning one
 * on adds its gear (engine.ts `whenHazardsAny`). Promoted out of the cramped rail
 * into its own tab so each toggle can show exactly which items it controls.
 *
 * Scope note: hazards do NOT gate the booth slideshow today — the deck plays in
 * full regardless. (Wiring that up is a separate, deliberate change.)
 */
export function HazardsManager({
  hazards,
  planner,
  onToggle,
}: {
  hazards: Hazard[]
  planner: PlannerConfig
  onToggle: (h: Hazard) => void
}) {
  const itemsFor = (h: Hazard) =>
    planner.items.filter((it) => it.condition?.whenHazardsAny?.includes(h))

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h3 className="text-lg font-black text-slate-900">Hazards</h3>
        <p className="text-xs text-slate-500">
          Turning a hazard on adds its gear to the phone shopping list. The booth
          slideshow plays its full deck regardless.
        </p>
      </div>

      <ul className="space-y-2">
        {ALL_HAZARDS.map((h) => {
          const on = hazards.includes(h.id)
          const items = itemsFor(h.id)
          return (
            <li
              key={h.id}
              className={`rounded-2xl bg-white p-3 ring-1 transition-shadow ${
                on ? 'ring-[var(--primary)]' : 'ring-slate-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${h.label} hazard`}
                  onClick={() => onToggle(h.id)}
                  className={`flex h-6 w-11 flex-none items-center rounded-full px-0.5 transition-colors ${
                    on ? 'bg-[var(--primary)]' : 'bg-slate-300'
                  }`}
                >
                  <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
                </button>
                <span className="flex-1 font-semibold text-slate-800">{h.label}</span>
                <span className={`text-xs font-bold uppercase tracking-wide ${on ? 'text-[var(--primary)]' : 'text-slate-400'}`}>
                  {on ? 'On' : 'Off'}
                </span>
              </div>
              <div className="mt-2 pl-14">
                {items.length ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-slate-400">{on ? 'adds:' : 'would add:'}</span>
                    {items.map((it) => (
                      <span
                        key={it.id}
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          on ? 'bg-blue-50 text-[var(--primary)]' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {it.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No shopping-list items are gated by this hazard yet.</p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
