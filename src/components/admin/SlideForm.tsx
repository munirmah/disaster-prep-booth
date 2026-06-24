import type { Slide } from '../../content/types'
import { sanitizeSlideForPreview } from '../../deck'
import { renderSlide } from '../slides/registry'

/** Controlled editor for a single slide, with a live preview. */
export function SlideForm({ slide, onChange }: { slide: Slide; onChange: (s: Slide) => void }) {
  const set = (patch: Partial<Slide>) => onChange({ ...slide, ...patch } as Slide)

  return (
    <div className="space-y-5">
      {/* Live preview — slides size to their container (cqh/cqw), so this small
          16:9 box renders an accurate, scaled version of the booth screen. */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-gradient-to-br from-[var(--primary)] via-[#004f87] to-[var(--ink)] shadow-inner [container-type:size]">
        {renderSlide(sanitizeSlideForPreview(slide))}
      </div>

      {/* Type-specific fields */}
      {slide.type === 'title' && (
        <>
          <Field label="Title">
            <TextInput value={slide.title} onChange={(v) => set({ title: v })} />
          </Field>
          <Field label="Subtitle">
            <TextInput value={slide.subtitle ?? ''} onChange={(v) => set({ subtitle: v })} />
          </Field>
        </>
      )}

      {slide.type === 'checklist' && (
        <>
          <div className="flex gap-3">
            <Field label="Icon" className="w-20 flex-none">
              <TextInput value={slide.icon ?? ''} onChange={(v) => set({ icon: v })} center />
            </Field>
            <Field label="Title" className="flex-1">
              <TextInput value={slide.title} onChange={(v) => set({ title: v })} />
            </Field>
          </div>
          <ListField
            label="Items"
            values={slide.items}
            onChange={(items) => set({ items })}
            addLabel="Add item"
          />
        </>
      )}

      {slide.type === 'hazard' && (
        <>
          <div className="flex gap-3">
            <Field label="Icon" className="w-20 flex-none">
              <TextInput value={slide.icon ?? ''} onChange={(v) => set({ icon: v })} center />
            </Field>
            <Field label="Hazard label" className="flex-1">
              <TextInput value={slide.hazard} onChange={(v) => set({ hazard: v })} />
            </Field>
          </div>
          <Field label="Headline">
            <TextInput value={slide.headline ?? ''} onChange={(v) => set({ headline: v })} />
          </Field>
          <ListField
            label="Steps"
            values={slide.steps}
            onChange={(steps) => set({ steps })}
            addLabel="Add step"
          />
        </>
      )}

      {slide.type === 'quiz' && (
        <>
          <Field label="Question">
            <TextInput value={slide.question} onChange={(v) => set({ question: v })} />
          </Field>
          <div>
            <Label>Options — tap the circle to mark the correct answer</Label>
            <div className="mt-2 space-y-2">
              {slide.options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Mark option ${i + 1} correct`}
                    onClick={() => set({ answerIndex: i })}
                    className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border-2 text-sm font-black ${
                      slide.answerIndex === i
                        ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                        : 'border-slate-300 text-transparent'
                    }`}
                  >
                    ✓
                  </button>
                  <input
                    value={opt}
                    onChange={(e) => {
                      const options = [...slide.options]
                      options[i] = e.target.value
                      set({ options })
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
                  />
                  {slide.options.length > 2 && (
                    <RemoveButton
                      onClick={() => {
                        const options = slide.options.filter((_, j) => j !== i)
                        const answerIndex = Math.min(slide.answerIndex, options.length - 1)
                        set({ options, answerIndex })
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
            {slide.options.length < 6 && (
              <AddButton
                label="Add option"
                onClick={() => set({ options: [...slide.options, ''] })}
              />
            )}
          </div>
          <div className="flex gap-3">
            <Field label="Reveal answer after (sec)" className="flex-1">
              <NumberInput
                value={Math.round(slide.revealAfterMs / 1000)}
                min={1}
                onChange={(n) => set({ revealAfterMs: n * 1000 })}
              />
            </Field>
          </div>
          <Field label="Explanation (shown with the answer)">
            <TextInput value={slide.explanation ?? ''} onChange={(v) => set({ explanation: v })} />
          </Field>
        </>
      )}

      {/* Common fields */}
      <div className="flex gap-3 border-t border-slate-200 pt-4">
        <Field label="Display time (sec)" className="flex-1">
          <NumberInput
            value={Math.round(slide.durationMs / 1000)}
            min={2}
            onChange={(n) => set({ durationMs: n * 1000 })}
          />
        </Field>
        <Field label="Corner label (optional)" className="flex-1">
          <TextInput value={slide.kicker ?? ''} onChange={(v) => set({ kicker: v })} />
        </Field>
      </div>
    </div>
  )
}

// ── Small field primitives ───────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-bold uppercase tracking-widest text-slate-400">{children}</span>
}

function Field({
  label,
  className = '',
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className}`}>
      <Label>{label}</Label>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function TextInput({
  value,
  onChange,
  center,
}: {
  value: string
  onChange: (v: string) => void
  center?: boolean
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border border-slate-300 px-3 py-2 ${center ? 'text-center' : ''}`}
    />
  )
}

function NumberInput({
  value,
  onChange,
  min = 0,
}: {
  value: number
  onChange: (n: number) => void
  min?: number
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      value={value}
      onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
      className="w-full rounded-lg border border-slate-300 px-3 py-2"
    />
  )
}

function ListField({
  label,
  values,
  onChange,
  addLabel,
}: {
  label: string
  values: string[]
  onChange: (v: string[]) => void
  addLabel: string
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2 space-y-2">
        {values.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 flex-none text-center text-sm text-slate-400">{i + 1}</span>
            <input
              value={v}
              onChange={(e) => {
                const next = [...values]
                next[i] = e.target.value
                onChange(next)
              }}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
            />
            {values.length > 1 && (
              <RemoveButton onClick={() => onChange(values.filter((_, j) => j !== i))} />
            )}
          </div>
        ))}
      </div>
      <AddButton label={addLabel} onClick={() => onChange([...values, ''])} />
    </div>
  )
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-500 active:bg-slate-50"
    >
      + {label}
    </button>
  )
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Remove"
      onClick={onClick}
      className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-lg text-slate-400 active:bg-slate-100"
    >
      ×
    </button>
  )
}
