import { useState } from 'react'
import { defaultResponses } from '../../planner/engine'
import type { PlannerConfig, Responses } from '../../planner/types'
import { NumberStepper } from './NumberStepper'

/**
 * Step 1: the household questionnaire — rendered entirely from the active
 * planner's `questions`. Add/remove/reorder questions and the form follows.
 */
export function FamilyForm({
  planner,
  onSubmit,
}: {
  planner: PlannerConfig
  onSubmit: (r: Responses) => void
}) {
  const [responses, setResponses] = useState<Responses>(() => defaultResponses(planner))
  const set = (id: string, v: number | boolean) =>
    setResponses((prev) => ({ ...prev, [id]: v }))

  return (
    <form
      className="mx-auto w-full max-w-md sm:rounded-3xl sm:bg-white sm:p-8 sm:shadow-sm sm:ring-1 sm:ring-slate-100"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(responses)
      }}
    >
      <h1 className="text-2xl font-black tracking-tight text-slate-900">Who are we planning for?</h1>
      <p className="mt-1 text-slate-500">We’ll size your emergency kit to your household.</p>

      <div className="mt-6 divide-y divide-slate-100">
        {planner.questions.map((q) => {
          if (q.type === 'counter') {
            return (
              <NumberStepper
                key={q.id}
                label={q.label}
                hint={q.hint}
                value={Number(responses[q.id] ?? q.default)}
                min={q.min ?? 0}
                max={q.max ?? 20}
                onChange={(v) => set(q.id, v)}
              />
            )
          }
          return (
            <label key={q.id} className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="text-lg font-semibold text-slate-900">{q.label}</p>
                {q.hint && <p className="text-sm text-slate-500">{q.hint}</p>}
              </div>
              <input
                type="checkbox"
                checked={Boolean(responses[q.id] ?? q.default)}
                onChange={(e) => set(q.id, e.target.checked)}
                className="h-7 w-7 accent-[var(--primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              />
            </label>
          )
        })}
      </div>

      <button
        type="submit"
        className="mt-6 w-full rounded-2xl bg-[var(--primary)] py-4 text-xl font-bold text-white shadow-lg active:opacity-90"
      >
        Build my plan →
      </button>
    </form>
  )
}
