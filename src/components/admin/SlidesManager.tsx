import { useRef, useState } from 'react'
import { AnimatePresence, Reorder, useDragControls } from 'motion/react'
import type { Slide } from '../../content/types'
import { builtInDeck, newSlide, sanitizeDeck, slideMissing } from '../../deck'
import { SlideForm } from './SlideForm'
import { DragHandle } from './DragHandle'
import type { PlannerConfig } from '../../planner/types'
import { planConfig as builtInPlanner } from '../../planner/plan-config'

const TYPE_LABELS: Record<Slide['type'], string> = {
  title: 'Title',
  checklist: 'Checklist',
  hazard: 'Hazard',
  quiz: 'Quiz',
}

const TYPE_DESCRIPTIONS: Record<Slide['type'], string> = {
  title: 'A title or section card — a big headline with an optional subtitle. Use for intros, transitions, and closing messages.',
  checklist:
    'A titled list of items, each with a checkmark. Use for things to gather or do — like a go-bag or a family plan.',
  hazard:
    'What-to-do guidance for one hazard — a small label, a headline, and numbered steps (e.g. flooding, winter storm).',
  quiz: 'A question with answer choices. The correct one highlights on its own after a few seconds — no tapping needed.',
}

/** One-line summary of a slide for the list view. */
function summarize(s: Slide): string {
  switch (s.type) {
    case 'title':
      return s.title
    case 'checklist':
      return s.title
    case 'hazard':
      return s.headline || s.hazard
    case 'quiz':
      return s.question
  }
}

/** One reorderable slide row in the deck list. Drag by the grip handle. */
function SlideRow({
  slide,
  canDelete,
  onToggle,
  onEdit,
  onRemove,
}: {
  slide: Slide
  canDelete: boolean
  onToggle: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  const controls = useDragControls()
  const off = slide.enabled === false
  return (
    <Reorder.Item
      value={slide.id}
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0 }}
      animate={{ opacity: off ? 0.5 : 1 }}
      exit={{ opacity: 0 }}
      transition={{ layout: { duration: 0.28, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 0.18 } }}
      className="flex items-center gap-2 rounded-xl bg-white p-2 pl-3 ring-1 ring-slate-100"
    >
      <DragHandle controls={controls} />
      <span className="w-20 flex-none rounded-md bg-slate-100 px-2 py-0.5 text-center text-xs font-bold text-slate-500">
        {TYPE_LABELS[slide.type]}
      </span>
      {off && (
        <span className="flex-none rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Off
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
        {summarize(slide) || <span className="text-slate-400">(empty)</span>}
      </span>
      <button
        type="button"
        onClick={onToggle}
        title={off ? 'Hidden from the booth — click to show' : 'Showing on the booth — click to hide'}
        className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-400 transition-colors hover:text-slate-700"
      >
        {off ? 'Show' : 'Hide'}
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="rounded-lg px-2 py-1 text-sm font-bold text-[var(--primary)] active:bg-slate-50"
      >
        Edit
      </button>
      <button
        type="button"
        aria-label="Delete slide"
        disabled={!canDelete}
        onClick={onRemove}
        className="rounded-lg px-2 py-1 text-lg text-slate-400 active:bg-slate-100 disabled:opacity-25"
      >
        ×
      </button>
    </Reorder.Item>
  )
}

type Editing = { mode: 'new' | 'edit'; index: number; draft: Slide } | null

/**
 * Admin "Slides" section: edit the booth deck. Controlled — it edits the
 * `slides` array from the content draft and reports changes via `onChange`;
 * AdminView publishes the whole content document to the server.
 */
export function SlidesManager({
  slides: deck,
  onChange,
}: {
  slides: Slide[]
  onChange: (slides: Slide[]) => void
}) {
  const [editing, setEditing] = useState<Editing>(null)
  const [adding, setAdding] = useState(false)
  const [hoveredType, setHoveredType] = useState<Slide['type'] | null>(null)

  const commit = (next: Slide[]) => onChange(next)

  const reorder = (ids: string[]) =>
    commit(ids.map((id) => deck.find((s) => s.id === id)).filter((s): s is Slide => !!s))

  const remove = (i: number) => {
    if (deck.length <= 1) return
    commit(deck.filter((_, j) => j !== i))
  }

  const setEnabled = (i: number, enabled: boolean) =>
    commit(deck.map((s, j) => (j === i ? { ...s, enabled } : s)))

  const saveDraft = () => {
    if (!editing || slideMissing(editing.draft)) return
    const next = [...deck]
    if (editing.mode === 'new') next.splice(editing.index, 0, editing.draft)
    else next[editing.index] = editing.draft
    commit(next)
    setEditing(null)
  }

  // ── Editor view ─────────────────────────────────────────────────────
  if (editing) {
    return (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-black text-slate-900">
            {editing.mode === 'new' ? 'Add' : 'Edit'} {TYPE_LABELS[editing.draft.type]} slide
          </h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
            preview updates live
          </span>
        </div>
        <SlideForm
          slide={editing.draft}
          onChange={(draft) => setEditing({ ...editing, draft })}
        />
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={saveDraft}
            disabled={!!slideMissing(editing.draft)}
            className="flex-1 rounded-xl bg-[var(--primary)] py-3 font-bold text-white active:opacity-90 disabled:opacity-40"
          >
            Save slide
          </button>
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="rounded-xl px-4 py-3 font-semibold text-slate-500 active:bg-slate-100"
          >
            Cancel
          </button>
        </div>
        {slideMissing(editing.draft) && (
          <p className="mt-2 text-right text-xs font-semibold text-[var(--warning)]">
            Add {slideMissing(editing.draft)} to save.
          </p>
        )}
      </div>
    )
  }

  // ── List view ───────────────────────────────────────────────────────
  return (
    <div>
      <p className="mb-2 text-xs text-slate-400">
        {deck.length} slide{deck.length === 1 ? '' : 's'} · drag to reorder
      </p>
      <Reorder.Group
        as="ol"
        axis="y"
        values={deck.map((s) => s.id)}
        onReorder={reorder}
        className="flex flex-col gap-2"
      >
        <AnimatePresence initial={false}>
          {deck.map((s, i) => (
            <SlideRow
              key={s.id}
              slide={s}
              canDelete={deck.length > 1}
              onToggle={() => setEnabled(i, s.enabled === false)}
              onEdit={() => setEditing({ mode: 'edit', index: i, draft: s })}
              onRemove={() => remove(i)}
            />
          ))}
        </AnimatePresence>
      </Reorder.Group>

      {/* Add slide */}
      <div className="mt-3">
        {adding ? (
          <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
            <p className="px-1 pb-2 text-xs font-bold uppercase tracking-widest text-slate-400">
              Add which kind?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(TYPE_LABELS) as Slide['type'][]).map((t) => (
                <button
                  key={t}
                  type="button"
                  title={TYPE_DESCRIPTIONS[t]}
                  onClick={() => {
                    setEditing({ mode: 'new', index: deck.length, draft: newSlide(t) })
                    setAdding(false)
                  }}
                  onMouseEnter={() => setHoveredType(t)}
                  onMouseLeave={() => setHoveredType(null)}
                  onFocus={() => setHoveredType(t)}
                  onBlur={() => setHoveredType(null)}
                  className="rounded-lg bg-white py-2 text-sm font-bold text-slate-700 ring-1 ring-slate-200 hover:ring-[var(--primary)] focus-visible:ring-[var(--primary)] active:bg-slate-100"
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            {/* Hover/focus a type to learn what it is before picking. */}
            <p
              className="mt-2 min-h-[3.5em] rounded-lg bg-white/70 px-3 py-2 text-xs leading-snug text-slate-500"
              aria-live="polite"
            >
              {hoveredType
                ? TYPE_DESCRIPTIONS[hoveredType]
                : 'Hover a type to see what it does, then tap to add it.'}
            </p>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="mt-1 w-full py-1 text-sm font-semibold text-slate-400"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-full rounded-xl border border-dashed border-slate-300 py-3 font-bold text-slate-500 transition-colors hover:border-[var(--primary)] hover:bg-slate-50 hover:text-[var(--primary)] active:bg-slate-50"
          >
            + Add slide
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Builds a ready-to-paste prompt for an LLM: brief instructions, the slide
 * schema, and the current deck as a starting point. The volunteer pastes it
 * into ChatGPT/Claude/etc., asks for the slides they want, and imports the
 * JSON that comes back. Schema mirrors content/types.ts (Slide union).
 */
function deckPrompt(deck: Slide[]): string {
  return `You are helping create content for the Humanity First "Disaster Preparedness" booth — a TV slideshow that loops unattended (no taps) beside a QR code. I'll describe the slides I want; you return the deck as JSON.

HOW TO WORK WITH ME
- Don't generate slides right away. First interview me — ask a few focused questions, a couple at a time (not all at once), so the deck fits this booth:
    • the event, audience, and setting (e.g. a community fair, a faith-group open house, a school safety day);
    • which hazards or topics to emphasize, and any to leave out;
    • roughly how many slides, or how long the loop should run;
    • must-include messages, the tone I want, and any language needs.
- When you have enough to go on, deliver the deck — and that delivery message must follow OUTPUT below. Keep all questions and discussion in earlier messages.

OUTPUT (when you deliver the deck)
- Return ONLY a JSON array of slide objects — no prose, no markdown code fences.
- The array REPLACES the whole deck on import, so include every slide to show, in display order. Edit/extend the current deck below rather than starting over.
- Keep text short and legible from across a room. Tone: calm, clear, encouraging — never alarming. Audience: the general public passing a booth.

EVERY SLIDE HAS
- "id": string, unique across the deck (e.g. "title-ready", "hazard-flood")
- "durationMs": number — time on screen before auto-advance (8000–14000 is typical)
- "kicker"?: string — optional short header label

SLIDE TYPES (the "type" field selects the shape)
- { "type": "title", "title": string, "subtitle"?: string }
- { "type": "checklist", "title": string, "items": string[], "icon"?: string }
      ~4–6 items, each ≤ ~6 words. icon = a single emoji.
- { "type": "hazard", "hazard": string, "steps": string[], "headline"?: string, "icon"?: string }
      hazard = short label, e.g. "FLOOD". 3–5 short do-this-now steps. icon = a single emoji.
- { "type": "quiz", "question": string, "options": string[], "answerIndex": number, "revealAfterMs": number, "explanation"?: string }
      2–4 options. answerIndex is 0-based. revealAfterMs MUST be < durationMs (about half works well). explanation = one line.

CURRENT DECK (edit or extend this, then return the full updated array):
${JSON.stringify(deck, null, 2)}

Start by asking me your first questions. Once you have what you need, return the complete updated deck as JSON.`
}

/** Clipboard write with a fallback for non-secure contexts / older browsers. */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } catch {
      /* nothing else to try */
    }
    document.body.removeChild(ta)
  }
}

/**
 * Deck backup/restore controls (export to JSON, import, reset to the built-in
 * deck) plus a "copy an AI prompt" helper. Lifted out of SlidesManager so it
 * can live in the admin's tools rail, separate from the slide list it acts on.
 */
export function DeckBackup({
  slides: deck,
  onChange,
}: {
  slides: Slide[]
  onChange: (slides: Slide[]) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  const exportDeck = () => {
    const blob = new Blob([JSON.stringify(deck, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'booth-deck.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const importDeck = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = sanitizeDeck(JSON.parse(String(reader.result)))
        if (parsed.length) onChange(parsed)
        else alert('That file had no valid slides.')
      } catch {
        alert('Could not read that file as a slide deck.')
      }
    }
    reader.readAsText(file)
  }

  const reset = () => onChange([...builtInDeck])

  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-100">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <button type="button" onClick={exportDeck} className="font-semibold text-[var(--primary)]">
          ⤓ Export deck
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="font-semibold text-[var(--primary)]"
        >
          ⤒ Import deck
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importDeck(f)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={reset}
          className="ml-auto font-semibold text-slate-400 active:text-slate-600"
        >
          Reset ({builtInDeck.length})
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Export to back up or move a deck between devices.
      </p>
    </div>
  )
}

/**
 * Shopping-list config backup/restore: export to JSON, import, reset to built-in.
 * Mirrors DeckBackup but operates on PlannerConfig instead of slides.
 */
export function PlannerBackup({
  planner,
  onChange,
}: {
  planner: PlannerConfig
  onChange: (planner: PlannerConfig) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  const exportPlanner = () => {
    const blob = new Blob([JSON.stringify(planner, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'shopping-list-config.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const importPlanner = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        if (
          !Array.isArray(parsed?.questions) ||
          !Array.isArray(parsed?.stores) ||
          !Array.isArray(parsed?.items)
        ) {
          alert("That file isn't a valid shopping list config (missing questions, stores, or items).")
          return
        }
        onChange(parsed as PlannerConfig)
      } catch {
        alert('Could not read that file as a shopping list config.')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-100">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <button type="button" onClick={exportPlanner} className="font-semibold text-[var(--primary)]">
          ⤓ Export config
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="font-semibold text-[var(--primary)]"
        >
          ⤒ Import config
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importPlanner(f)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => onChange(builtInPlanner)}
          className="ml-auto font-semibold text-slate-400 active:text-slate-600"
        >
          Reset ({builtInPlanner.items.length} items)
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Export to back up the shopping list or transfer it between booths.
      </p>
    </div>
  )
}

/**
 * Pull JSON out of an LLM's reply. The prompts ask for bare JSON, but models
 * routinely wrap it in ```json fences or a sentence or two — so tolerate that:
 * strip a fenced block if present, otherwise slice from the first opening
 * bracket to the last matching closing one (`[`/`]` for the deck array, `{`/`}`
 * for the planner object). Throws if no bracketed JSON is found.
 */
function extractJson(raw: string, open: '[' | '{', close: ']' | '}'): unknown {
  let s = raw.trim()
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) s = fenced[1].trim()
  if (!s.startsWith(open)) {
    const start = s.indexOf(open)
    const end = s.lastIndexOf(close)
    if (start === -1 || end <= start) throw new Error('No JSON found in the reply.')
    s = s.slice(start, end + 1)
  }
  return JSON.parse(s)
}

/**
 * "Generate with AI" helper — closes the loop both ways. Copies a ready-made
 * prompt (instructions + slide schema + the current deck) to paste into an LLM,
 * AND takes the model's reply straight back: paste the JSON it returns below and
 * the deck updates in place — no file download/upload round-trip. The pasted
 * array replaces the whole deck (sanitized first); admins still Publish to go live.
 */
export function DeckAiPrompt({
  slides: deck,
  onChange,
}: {
  slides: Slide[]
  onChange: (slides: Slide[]) => void
}) {
  const [copied, setCopied] = useState(false)
  const [reply, setReply] = useState('')
  const [result, setResult] = useState<{ ok: true; count: number } | { ok: false; msg: string } | null>(
    null,
  )

  const copyPrompt = async () => {
    await copyText(deckPrompt(deck))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const applyReply = () => {
    if (!reply.trim()) return
    let parsed: unknown
    try {
      parsed = extractJson(reply, '[', ']')
    } catch {
      setResult({ ok: false, msg: "That doesn't look like slide JSON. Paste the model's full reply." })
      return
    }
    const slides = sanitizeDeck(parsed)
    if (!slides.length) {
      setResult({ ok: false, msg: 'No valid slides in that reply — nothing was changed.' })
      return
    }
    onChange(slides)
    setReply('')
    setResult({ ok: true, count: slides.length })
  }

  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-100">
      <button
        type="button"
        onClick={copyPrompt}
        className="w-full rounded-xl bg-slate-50 py-2.5 font-bold text-[var(--primary)] ring-1 ring-slate-200 transition hover:bg-slate-100 active:bg-slate-100"
      >
        {copied ? '✓ Prompt copied' : '✨ Copy AI prompt'}
      </button>
      <p className="mt-2 text-xs leading-snug text-slate-400">
        Paste it into an LLM (ChatGPT, Claude…), ask for the slides you want, then paste its reply
        below to update the deck.
      </p>

      <textarea
        aria-label="Paste the AI's reply"
        value={reply}
        onChange={(e) => {
          setReply(e.target.value)
          if (result) setResult(null)
        }}
        rows={2}
        placeholder="Paste the AI's reply here…"
        className="mt-3 w-full resize-none rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs leading-relaxed"
      />
      <button
        type="button"
        onClick={applyReply}
        disabled={!reply.trim()}
        className="mt-2 w-full rounded-xl bg-[var(--primary)] py-2.5 font-bold text-white transition hover:opacity-90 active:opacity-90 disabled:opacity-40"
      >
        Update deck from reply
      </button>
      {result && (
        <p className={`mt-2 text-xs font-semibold ${result.ok ? 'text-green-600' : 'text-red-600'}`}>
          {result.ok ? `✓ Loaded ${result.count} slide${result.count === 1 ? '' : 's'}. Review, then Publish.` : result.msg}
        </p>
      )}
    </div>
  )
}

/**
 * Builds a ready-to-paste prompt for an LLM to edit the shopping-list config:
 * instructions, the full PlannerConfig schema (questions/stores/items, the
 * quantity-formula math, conditions, and the product-link `url` field), and the
 * current config as a starting point. The volunteer pastes it into an LLM, hands
 * it product links + details, and pastes the returned JSON back. Mirrors
 * planner/types.ts — keep the two in sync.
 */
function plannerPrompt(planner: PlannerConfig): string {
  return `You are helping configure the shopping list for the Humanity First "Disaster Preparedness" booth. Visitors answer a few household questions on their phone and get a personalized, per-store emergency-kit shopping list. I'll give you product links and details (or describe changes); you return the COMPLETE updated config as JSON.

HOW TO WORK WITH ME
- Don't dump a config right away. First interview me — ask a few focused questions, a couple at a time (not all at once), so the list fits this booth:
    • the region this booth serves and which hazards the kit should cover;
    • which stores visitors can realistically reach nearby;
    • any specific products, links, or prices I want used (paste them and you'll wire them into the right items, with the link in each item's "url");
    • anything to add, drop, or re-prioritize from the current list, and how budget-conscious to be.
- When you have what you need, deliver the config — and that delivery message must follow OUTPUT below. Keep all questions and discussion in earlier messages.

OUTPUT (when you deliver the config)
- Return ONLY one JSON object — no prose, no markdown code fences.
- It REPLACES the whole config on import, so include everything (questions, stores, items…), not just what changed. Edit/extend the current config below rather than starting over.
- Prices are illustrative USD estimates — keep them realistic for the area I describe; never invent an exact price as if confirmed.

QUANTITIES ARE A FORMULA, NOT A FIXED NUMBER
Each item's "formula" computes how many PACKAGES to buy from the household answers:
  raw   = base + Σ per[k]×count(k) + Σ perPerDay[k]×count(k)×days
  packs = ceil(raw / packSize), then clamped to [min, max]
  k = a question id ("adults") or an aggregate ("people"); days = the booth's prep window.
  • "2 gallons per adult per day", 5-gal case → "perPerDay":{"adults":2}, "packSize":5
  • "5 lbs rice per person",        5-lb bag  → "per":{"people":5},      "packSize":5
  • "one per 4 people, at least 1"            → "per":{"people":0.25},   "min":1
  • "always exactly one"                      → "base":1

THE CONFIG OBJECT
- "aggregates": derived sums usable in formulas/conditions, e.g. {"people":["adults","children","infants"]}
- "categoryLabels": { categoryId: "Display Name" }; "categoryOrder": [categoryId, …] (display order)
- "questions": { "id", "type":"counter", "label", "hint"?, "default", "min"?, "max"? }
      or yes/no { "id", "type":"toggle", "label", "hint"?, "default":false }
- "stores": { "id", "label", "color"?, "enabled"? }   color ∈ blue | teal | amber | rose | violet | green | slate
- "items": { "id", "name", "category" (a categoryLabels key), "store" (a store id),
      "product" (example to buy), "url"? (product-page link — PUT LINKS HERE),
      "unitPrice" (number), "unit" (e.g. "case","bag"),
      "note"? (a short practical tip), "rationale"? (1–2 sentences on WHY it matters in an emergency),
      "formula" (see above), "condition"?, "enabled"? }

ITEM CONDITIONS (optional — gates whether an item appears)
- "whenPositive": ["infants"]              // only if that count/toggle > 0
- "whenAtLeast": { "people": 5 }            // only if a count is ≥ the value
- "whenHazardsAny": ["flood","hurricane"]   // only for these booth hazards
      hazard ids: winter | flood | hurricane | shelter | earthquake | wildfire

CURRENT CONFIG (edit or extend this, then return the full updated object):
${JSON.stringify(planner, null, 2)}

Start by asking me your first questions. Once you have what you need, return the complete updated config as JSON.`
}

/**
 * Shopping-list counterpart to DeckAiPrompt — the same two-way loop for the
 * planner config. Copy a prompt out (with the schema + current config), hand an
 * LLM product links/details, then paste the returned JSON object back and the
 * list updates in place. The pasted object replaces the whole config (shape-
 * checked first, same as Import); admins still Publish to go live.
 */
export function PlannerAiPrompt({
  planner,
  onChange,
}: {
  planner: PlannerConfig
  onChange: (planner: PlannerConfig) => void
}) {
  const [copied, setCopied] = useState(false)
  const [reply, setReply] = useState('')
  const [result, setResult] = useState<
    { ok: true; items: number; stores: number } | { ok: false; msg: string } | null
  >(null)

  const copyPrompt = async () => {
    await copyText(plannerPrompt(planner))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const applyReply = () => {
    if (!reply.trim()) return
    let parsed: unknown
    try {
      parsed = extractJson(reply, '{', '}')
    } catch {
      setResult({ ok: false, msg: "That doesn't look like shopping-list JSON. Paste the model's full reply." })
      return
    }
    const p = parsed as { questions?: unknown; stores?: unknown; items?: unknown }
    if (!Array.isArray(p.questions) || !Array.isArray(p.stores) || !Array.isArray(p.items)) {
      setResult({ ok: false, msg: 'That reply is missing questions, stores, or items — nothing was changed.' })
      return
    }
    onChange(parsed as PlannerConfig)
    setReply('')
    setResult({ ok: true, items: p.items.length, stores: p.stores.length })
  }

  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-100">
      <button
        type="button"
        onClick={copyPrompt}
        className="w-full rounded-xl bg-slate-50 py-2.5 font-bold text-[var(--primary)] ring-1 ring-slate-200 transition hover:bg-slate-100 active:bg-slate-100"
      >
        {copied ? '✓ Prompt copied' : '✨ Copy AI prompt'}
      </button>
      <p className="mt-2 text-xs leading-snug text-slate-400">
        Paste it into an LLM (ChatGPT, Claude…), give it product links and details, then paste its
        reply below to update the list.
      </p>
      <textarea
        aria-label="Paste the AI's reply"
        value={reply}
        onChange={(e) => {
          setReply(e.target.value)
          if (result) setResult(null)
        }}
        rows={2}
        placeholder="Paste the AI's reply here…"
        className="mt-3 w-full resize-none rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs leading-relaxed"
      />
      <button
        type="button"
        onClick={applyReply}
        disabled={!reply.trim()}
        className="mt-2 w-full rounded-xl bg-[var(--primary)] py-2.5 font-bold text-white transition hover:opacity-90 active:opacity-90 disabled:opacity-40"
      >
        Update list from reply
      </button>
      {result && (
        <p className={`mt-2 text-xs font-semibold ${result.ok ? 'text-green-600' : 'text-red-600'}`}>
          {result.ok
            ? `✓ Loaded ${result.items} item${result.items === 1 ? '' : 's'} across ${result.stores} store${result.stores === 1 ? '' : 's'}. Review, then Publish.`
            : result.msg}
        </p>
      )}
    </div>
  )
}
