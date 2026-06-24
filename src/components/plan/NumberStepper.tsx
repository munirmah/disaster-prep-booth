/** Big touch-friendly −/+ counter for phone use. */
export function NumberStepper({
  label,
  hint,
  value,
  min = 0,
  max = 20,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min?: number
  max?: number
  onChange: (v: number) => void
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)))
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-200 py-4">
      <div>
        <p className="text-lg font-semibold text-slate-900">{label}</p>
        {hint && <p className="text-sm text-slate-500">{hint}</p>}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => set(value - 1)}
          disabled={value <= min}
          className="h-12 w-12 rounded-full bg-slate-100 text-2xl font-bold text-slate-700 active:bg-slate-200 disabled:opacity-30"
        >
          −
        </button>
        <span className="w-8 text-center text-2xl font-bold tabular-nums text-slate-900">
          {value}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => set(value + 1)}
          disabled={value >= max}
          className="h-12 w-12 rounded-full bg-[var(--primary)] text-2xl font-bold text-white active:opacity-80 disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  )
}
