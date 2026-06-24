import { useState } from 'react'
import { AnimatePresence, Reorder, motion, useDragControls } from 'motion/react'
import { genId } from '../../deck'
import { defaultResponses, formatUsd, generatePlan } from '../../planner/engine'
import type { Item, PlannerConfig, Question, Responses, StoreDef } from '../../planner/types'
import { DragHandle } from './DragHandle'
import type { Settings } from '../../settings'
import { STORE_COLORS, STORE_COLOR_KEYS, storeColor } from '../../planner/store-colors'
import { brand } from '../../content/brand'
import { PlanResult } from '../plan/PlanResult'
import { ItemForm } from './ItemForm'
import { Drawer } from './Drawer'

type Tab = 'items' | 'stores' | 'questions' | 'categories'

// Shared list-row animation (matches the booth slide list): fade in/out, and
// FLIP to the new position on reorder. Honors the global reduced-motion config.
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
const rowMotion = {
  layout: true,
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { layout: { duration: 0.28, ease: EASE }, opacity: { duration: 0.18 } },
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'items', label: 'Items' },
  { id: 'stores', label: 'Stores' },
  { id: 'questions', label: 'Questions' },
  { id: 'categories', label: 'Categories' },
]

/**
 * Admin "Shopping list" editor — controlled, edits the planner config from the
 * content draft (questions, stores, items + prices + formulas, categories) and
 * reports changes via onChange. AdminView publishes the whole content document.
 */
export function PlannerManager({
  planner,
  settings,
  onChange,
}: {
  planner: PlannerConfig
  settings: Settings
  onChange: (p: PlannerConfig) => void
}) {
  const [tab, setTab] = useState<Tab>('items')
  const [previewOpen, setPreviewOpen] = useState(false)
  return (
    <div className="lg:flex lg:h-full lg:min-h-0 lg:gap-0">
      {/* Editor column — scrolls internally, so its scrollbar sits next to the
          list rather than at the far window edge past the preview. */}
      <div className="min-w-0 lg:flex-1 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-slate-200 lg:pl-1 lg:pr-5 thin-scroll">
        {/* Sticky within the admin's scroll pane so the facet tabs stay anchored
            while the list below scrolls (bg matches the column to mask scroll). */}
        <div className="mb-3 lg:sticky lg:top-0 lg:z-10 lg:mb-0 lg:bg-[var(--paper)] lg:pb-3">
          <nav className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-bold ${
                  tab === t.id ? 'bg-white text-[var(--primary)] shadow-sm' : 'text-slate-500'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {tab === 'items' && <Items planner={planner} onChange={onChange} />}
        {tab === 'stores' && <Stores planner={planner} onChange={onChange} />}
        {tab === 'questions' && <Questions planner={planner} onChange={onChange} />}
        {tab === 'categories' && <Categories planner={planner} onChange={onChange} />}

        {/* Narrow screens can't fit the preview beside the editor, so it folds
            into a toggle below. */}
        <div className="mt-6 lg:hidden">
          <button
            type="button"
            onClick={() => setPreviewOpen((v) => !v)}
            className="w-full rounded-xl border border-slate-200 py-2 text-sm font-bold text-[var(--primary)]"
          >
            {previewOpen ? 'Hide live preview' : '▶ Show live preview'}
          </button>
          {previewOpen && (
            <div className="mt-3">
              <LivePreview planner={planner} settings={settings} />
            </div>
          )}
        </div>
      </div>

      {/* Wide screens: a persistent live preview docked beside the editor that
          updates as any facet is edited — no tab-switching to verify. */}
      <aside className="hidden lg:block lg:h-full lg:min-h-0 lg:w-80 lg:flex-none lg:overflow-y-auto lg:pb-4 lg:pl-5 lg:pr-1 thin-scroll">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Live preview</p>
        <LivePreview planner={planner} settings={settings} />
      </aside>
    </div>
  )
}

// ── Items ─────────────────────────────────────────────────────────────
type EditingItem = { index: number; mode: 'new' | 'edit'; draft: Item } | null

function newItem(planner: PlannerConfig): Item {
  return {
    id: genId('item'),
    name: '', // empty so the field shows its example placeholder — just type
    category: Object.keys(planner.categoryLabels)[0] ?? 'food',
    store: planner.stores[0]?.id ?? '',
    product: '',
    unitPrice: 0,
    unit: 'each',
    formula: { base: 1 },
  }
}

function Items({ planner, onChange }: { planner: PlannerConfig; onChange: (p: PlannerConfig) => void }) {
  const [editing, setEditing] = useState<EditingItem>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const items = planner.items
  const storeLabel = (id: string) => planner.stores.find((s) => s.id === id)?.label ?? id
  const setEnabled = (i: number, enabled: boolean) =>
    onChange({ ...planner, items: items.map((x, j) => (j === i ? { ...x, enabled } : x)) })

  const save = () => {
    if (!editing || !editing.draft.name.trim()) return
    const next = [...items]
    if (editing.mode === 'new') next.push(editing.draft)
    else next[editing.index] = editing.draft
    onChange({ ...planner, items: next })
    setEditing(null)
  }

  // ── Bulk selection ──
  const allSelected = items.length > 0 && selected.size === items.length
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((it) => it.id)))
  const exitSelect = () => {
    setSelectMode(false)
    setSelected(new Set())
    setConfirmingDelete(false)
  }
  // Apply a patch to every selected item; keeps the selection so actions chain.
  const applyToSelected = (patch: (it: Item) => Item) =>
    onChange({ ...planner, items: items.map((it) => (selected.has(it.id) ? patch(it) : it)) })
  const bulkDelete = () => {
    onChange({ ...planner, items: items.filter((it) => !selected.has(it.id)) })
    exitSelect()
  }
  const n = selected.size

  return (
    <div className="lg:mt-1">
      {/* Header — normal vs. selection mode. (mt clears the sticky tab bar's
          opaque background, which would otherwise paint over the row's top ring.) */}
      {!selectMode ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs text-slate-400">
            {items.length} item{items.length === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={items.length === 0}
              onClick={() => setSelectMode(true)}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-500 ring-1 ring-slate-200 transition-colors hover:text-slate-700 disabled:opacity-40"
            >
              Select
            </button>
            <button
              type="button"
              onClick={() => setEditing({ index: items.length, mode: 'new', draft: newItem(planner) })}
              className="rounded-xl bg-[var(--primary)] px-3.5 py-2 text-sm font-bold text-white transition-[transform,opacity] hover:opacity-90 active:scale-95"
            >
              + Add item
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-3 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-600">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              {n > 0 ? `${n} selected` : 'Select all'}
            </label>
            <button
              type="button"
              onClick={exitSelect}
              className="ml-auto rounded-lg px-2 py-1 text-xs font-bold text-[var(--primary)]"
            >
              Done
            </button>
          </div>
          {n > 0 &&
            (confirmingDelete ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-red-600">
                  Delete {n} item{n === 1 ? '' : 's'}?
                </span>
                <button
                  type="button"
                  onClick={bulkDelete}
                  className="rounded-lg bg-red-600 px-2.5 py-1 font-bold text-white active:opacity-90"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="font-semibold text-slate-500"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => applyToSelected((it) => ({ ...it, enabled: true }))}
                  className="rounded-lg bg-white px-2.5 py-1 font-semibold text-slate-700 ring-1 ring-slate-200 hover:text-[var(--primary)]"
                >
                  Show
                </button>
                <button
                  type="button"
                  onClick={() => applyToSelected((it) => ({ ...it, enabled: false }))}
                  className="rounded-lg bg-white px-2.5 py-1 font-semibold text-slate-700 ring-1 ring-slate-200 hover:text-[var(--primary)]"
                >
                  Hide
                </button>
                <select
                  aria-label="Move selected to store"
                  value=""
                  onChange={(e) => e.target.value && applyToSelected((it) => ({ ...it, store: e.target.value }))}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1"
                >
                  <option value="">Move to…</option>
                  {planner.stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Set category on selected"
                  value=""
                  onChange={(e) =>
                    e.target.value && applyToSelected((it) => ({ ...it, category: e.target.value }))
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1"
                >
                  <option value="">Category…</option>
                  {Object.entries(planner.categoryLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="rounded-lg px-2.5 py-1 font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            ))}
        </div>
      )}
      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
        {items.map((it, i) => {
          const off = it.enabled === false
          const checked = selected.has(it.id)
          return (
          <motion.li
            {...rowMotion}
            animate={{ opacity: off ? 0.5 : 1 }}
            key={it.id}
            onClick={selectMode ? () => toggleSelect(it.id) : undefined}
            className={`flex items-center gap-2 rounded-xl bg-white p-2 pl-3 ${
              selectMode ? 'cursor-pointer ' : ''
            }${selectMode && checked ? 'ring-2 ring-[var(--primary)]' : 'ring-1 ring-slate-100'}`}
          >
            {selectMode && (
              <input
                type="checkbox"
                checked={checked}
                readOnly
                tabIndex={-1}
                className="h-4 w-4 flex-none accent-[var(--primary)]"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800">{it.name}</p>
              <p className="truncate text-xs text-slate-400">
                {storeLabel(it.store)} · {formatUsd(it.unitPrice)}/{it.unit}
              </p>
            </div>
            {off && (
              <span className="flex-none rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Off
              </span>
            )}
            {!selectMode && (
              <>
                <button
                  type="button"
                  onClick={() => setEnabled(i, off)}
                  title={off ? 'Hidden from the plan — click to include' : 'Included in the plan — click to hide'}
                  className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-400 transition-colors hover:text-slate-700"
                >
                  {off ? 'Show' : 'Hide'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing({ index: i, mode: 'edit', draft: it })}
                  className="rounded-lg px-2 py-1 text-sm font-bold text-[var(--primary)]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  aria-label="Delete item"
                  onClick={() => onChange({ ...planner, items: items.filter((_, j) => j !== i) })}
                  className="px-2 py-1 text-lg text-slate-400"
                >
                  ×
                </button>
              </>
            )}
          </motion.li>
          )
        })}
        </AnimatePresence>
      </ul>
      <Drawer
        open={!!editing}
        title={editing?.mode === 'new' ? 'Add item' : 'Edit item'}
        onClose={() => setEditing(null)}
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!editing?.draft.name.trim()}
              className="flex-1 rounded-xl bg-[var(--primary)] py-3 font-bold text-white transition-[transform,opacity] hover:opacity-90 active:scale-[0.99] disabled:opacity-40"
            >
              {editing?.mode === 'new' ? 'Add item' : 'Save item'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-xl px-4 py-3 font-semibold text-slate-500 transition-colors hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        }
      >
        {editing && (
          <ItemForm
            item={editing.draft}
            planner={planner}
            onChange={(draft) => setEditing({ ...editing, draft })}
          />
        )}
      </Drawer>
    </div>
  )
}

// Header shared by the reorderable lists: count on the left, add action(s) on
// the right (so adding never means scrolling to the bottom).
function ListHeader({ count, noun, plural, children }: { count: number; noun: string; plural?: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <p className="text-xs text-slate-400">
        {count} {count === 1 ? noun : (plural ?? `${noun}s`)} · drag to reorder
      </p>
      <div className="flex gap-2">{children}</div>
    </div>
  )
}

const addBtn = 'rounded-xl bg-[var(--primary)] px-3 py-2 text-sm font-bold text-white transition-[transform,opacity] hover:opacity-90 active:scale-95'

// ── Stores ────────────────────────────────────────────────────────────
function Stores({ planner, onChange }: { planner: PlannerConfig; onChange: (p: PlannerConfig) => void }) {
  const stores = planner.stores
  const set = (next: StoreDef[]) => onChange({ ...planner, stores: next })
  const patch = (id: string, p: Partial<StoreDef>) => set(stores.map((s) => (s.id === id ? { ...s, ...p } : s)))
  const remove = (id: string) => set(stores.filter((s) => s.id !== id))
  const reorder = (ids: string[]) =>
    set(ids.map((id) => stores.find((s) => s.id === id)).filter((s): s is StoreDef => !!s))
  return (
    <div>
      <ListHeader count={stores.length} noun="store">
        <button type="button" onClick={() => set([...stores, { id: genId('store'), label: 'New store' }])} className={addBtn}>
          + Add store
        </button>
      </ListHeader>
      <Reorder.Group axis="y" values={stores.map((s) => s.id)} onReorder={reorder} className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {stores.map((s) => (
            <StoreRow key={s.id} store={s} onPatch={patch} onRemove={remove} />
          ))}
        </AnimatePresence>
      </Reorder.Group>
    </div>
  )
}

function StoreRow({
  store,
  onPatch,
  onRemove,
}: {
  store: StoreDef
  onPatch: (id: string, p: Partial<StoreDef>) => void
  onRemove: (id: string) => void
}) {
  const controls = useDragControls()
  const off = store.enabled === false
  return (
    <Reorder.Item
      value={store.id}
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0 }}
      animate={{ opacity: off ? 0.5 : 1 }}
      exit={{ opacity: 0 }}
      className="rounded-xl bg-white p-2 ring-1 ring-slate-100"
    >
      <div className="flex items-center gap-2">
        <DragHandle controls={controls} />
        <span aria-hidden className="h-3 w-3 flex-none rounded-full" style={{ backgroundColor: storeColor(store.color).dot }} />
        <input
          value={store.label}
          onChange={(e) => onPatch(store.id, { label: e.target.value })}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
        />
        {off && (
          <span className="flex-none rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Off
          </span>
        )}
        <button
          type="button"
          onClick={() => onPatch(store.id, { enabled: off })}
          title={off ? 'Hidden from the plan — click to include' : 'Included in the plan — click to hide'}
          className="flex-none rounded-lg px-2 py-1 text-sm font-semibold text-slate-400 transition-colors hover:text-slate-700"
        >
          {off ? 'Show' : 'Hide'}
        </button>
        <button type="button" aria-label="Delete store" onClick={() => onRemove(store.id)} className="px-2 text-lg text-slate-400">
          ×
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 pl-8">
        {STORE_COLOR_KEYS.map((key) => {
          const active = (store.color ?? 'blue') === key
          return (
            <button
              key={key}
              type="button"
              aria-label={`${store.label} color: ${key}`}
              aria-pressed={active}
              onClick={() => onPatch(store.id, { color: key })}
              className={`h-6 w-6 rounded-full ring-2 ring-offset-1 ${active ? 'ring-slate-900' : 'ring-transparent'}`}
              style={{ backgroundColor: STORE_COLORS[key].dot }}
            />
          )
        })}
      </div>
    </Reorder.Item>
  )
}

// ── Questions ─────────────────────────────────────────────────────────
function Questions({ planner, onChange }: { planner: PlannerConfig; onChange: (p: PlannerConfig) => void }) {
  const qs = planner.questions
  const set = (next: Question[]) => onChange({ ...planner, questions: next })
  const patch = (id: string, p: Partial<Question>) =>
    set(qs.map((q) => (q.id === id ? ({ ...q, ...p } as Question) : q)))
  const remove = (id: string) => set(qs.filter((q) => q.id !== id))
  const reorder = (ids: string[]) =>
    set(ids.map((id) => qs.find((q) => q.id === id)).filter((q): q is Question => !!q))
  const add = (type: 'counter' | 'toggle') =>
    set([
      ...qs,
      type === 'counter'
        ? { id: genId('q'), type, label: 'New count', default: 0 }
        : { id: genId('q'), type, label: 'New yes/no', default: false },
    ])

  return (
    <div>
      <ListHeader count={qs.length} noun="question">
        <button type="button" onClick={() => add('counter')} className={addBtn}>
          + Count
        </button>
        <button type="button" onClick={() => add('toggle')} className={addBtn}>
          + Yes/no
        </button>
      </ListHeader>
      <Reorder.Group axis="y" values={qs.map((q) => q.id)} onReorder={reorder} className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {qs.map((q) => (
            <QuestionRow key={q.id} q={q} onPatch={patch} onRemove={remove} />
          ))}
        </AnimatePresence>
      </Reorder.Group>
    </div>
  )
}

function QuestionRow({
  q,
  onPatch,
  onRemove,
}: {
  q: Question
  onPatch: (id: string, p: Partial<Question>) => void
  onRemove: (id: string) => void
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={q.id}
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="rounded-xl bg-white p-2 ring-1 ring-slate-100"
    >
      <div className="flex items-center gap-2">
        <DragHandle controls={controls} />
        <span className="w-16 flex-none rounded bg-slate-100 px-2 py-0.5 text-center text-[10px] font-bold uppercase text-slate-500">
          {q.type}
        </span>
        <input
          value={q.label}
          onChange={(e) => onPatch(q.id, { label: e.target.value })}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button type="button" aria-label="Delete question" onClick={() => onRemove(q.id)} className="px-1 text-lg text-slate-400">
          ×
        </button>
      </div>
      <input
        value={q.hint ?? ''}
        placeholder="hint (optional)"
        onChange={(e) => onPatch(q.id, { hint: e.target.value || undefined })}
        className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
      />
    </Reorder.Item>
  )
}

// ── Categories ────────────────────────────────────────────────────────
function Categories({ planner, onChange }: { planner: PlannerConfig; onChange: (p: PlannerConfig) => void }) {
  const order = planner.categoryOrder ?? Object.keys(planner.categoryLabels)
  const setLabel = (key: string, label: string) =>
    onChange({ ...planner, categoryLabels: { ...planner.categoryLabels, [key]: label } })
  const reorder = (next: string[]) => onChange({ ...planner, categoryOrder: next })
  const add = () => {
    const key = genId('cat')
    onChange({
      ...planner,
      categoryLabels: { ...planner.categoryLabels, [key]: 'New category' },
      categoryOrder: [...order, key],
    })
  }
  return (
    <div>
      <ListHeader count={order.length} noun="category" plural="categories">
        <button type="button" onClick={add} className={addBtn}>
          + Add category
        </button>
      </ListHeader>
      <Reorder.Group axis="y" values={order} onReorder={reorder} className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {order.map((key) => (
            <CategoryRow key={key} id={key} label={planner.categoryLabels[key] ?? key} onLabel={setLabel} />
          ))}
        </AnimatePresence>
      </Reorder.Group>
      <p className="mt-2 text-xs text-slate-400">Groupings shown on the checklist coverage line.</p>
    </div>
  )
}

function CategoryRow({ id, label, onLabel }: { id: string; label: string; onLabel: (id: string, label: string) => void }) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex items-center gap-2 rounded-xl bg-white p-2 ring-1 ring-slate-100"
    >
      <DragHandle controls={controls} />
      <input
        value={label}
        onChange={(e) => onLabel(id, e.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
      />
    </Reorder.Item>
  )
}

// ── Live preview — the visitor's shopping list, rendered from the draft ──
// Docked beside the editor (or toggled in below on narrow screens). Tweak the
// sample household and watch the generated list update as you edit the config.
function LivePreview({ planner, settings }: { planner: PlannerConfig; settings: Settings }) {
  const [responses, setResponses] = useState<Responses>(() => defaultResponses(planner))
  const [have, setHave] = useState<Set<string>>(new Set())
  const plan = generatePlan(responses, { days: settings.prepDays, hazards: settings.hazards }, planner)
  const setStatus = (id: string, owned: boolean) =>
    setHave((prev) => {
      const next = new Set(prev)
      if (owned) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <div>
      {/* Sample household — tweak it and watch the phone update */}
      <p className="mb-2 text-xs text-slate-400">
        Sample household · {settings.prepDays}-day · {settings.hazards.join(', ') || 'no hazards'}
      </p>
      <div className="divide-y divide-slate-100 rounded-xl bg-white px-3 ring-1 ring-slate-100">
        {planner.questions.map((q) =>
          q.type === 'counter' ? (
            <label key={q.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="text-slate-700">{q.label}</span>
              <input
                type="number"
                min={0}
                value={Number(responses[q.id] ?? 0)}
                onChange={(e) =>
                  setResponses({ ...responses, [q.id]: Math.max(0, Number(e.target.value) || 0) })
                }
                className="w-20 rounded-lg border border-slate-300 px-2 py-1"
              />
            </label>
          ) : (
            <label key={q.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="text-slate-700">{q.label}</span>
              <input
                type="checkbox"
                checked={Boolean(responses[q.id])}
                onChange={(e) => setResponses({ ...responses, [q.id]: e.target.checked })}
                className="h-5 w-5 accent-[var(--primary)]"
              />
            </label>
          ),
        )}
      </div>

      {/* The actual visitor view, rendered live from the draft. */}
      <div className="mt-3">
        <PhonePreview>
          <PlanResult
            plan={plan}
            have={have}
            onSetStatus={setStatus}
            onRestart={() => setHave(new Set())}
            preview
            planMode={settings.planMode}
          />
        </PhonePreview>
      </div>
    </div>
  )
}

/** A little phone mockup framing the live shopping-list preview. */
function PhonePreview({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[20rem]">
      <div className="overflow-hidden rounded-[2.25rem] border-[7px] border-slate-800 bg-[var(--paper)] shadow-xl">
        <div className="flex h-5 items-center justify-center bg-slate-800">
          <span className="h-1.5 w-14 rounded-full bg-slate-600" />
        </div>
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
          <img src={brand.logoSrc} alt="" className="h-5 w-auto" />
          <span className="border-l border-slate-200 pl-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {brand.tagline}
          </span>
        </div>
        {/* Its own container query context → renders the true mobile layout. */}
        <div className="no-scrollbar @container h-[30rem] overflow-y-auto px-4 py-4">{children}</div>
      </div>
      <p className="mt-2 text-center text-xs text-slate-400">Live preview — what visitors see</p>
    </div>
  )
}
