import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import type { Plan, PlannedItem } from '../../planner/types'
import { formatUsd, selectItems } from '../../planner/engine'
import { sendPlanEmail, type EmailExtras } from '../../planner/email'
import { storeColor } from '../../planner/store-colors'
import { track } from '../../track'
import type { PlanMode } from '../../settings'

// Project-wide confident ease-out (no bounce) — matches the booth/admin motion.
const EASE = [0.22, 1, 0.36, 1] as const

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string }

/**
 * A USD amount that tweens to its new value when items are toggled, so the
 * running total feels alive instead of snapping. The number is held in a
 * MotionValue and rendered straight into a motion.span (no per-frame React
 * renders); reduced-motion users get an instant set.
 */
function AnimatedUsd({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => formatUsd(v))
  useEffect(() => {
    if (reduce) {
      mv.set(value)
      return
    }
    const controls = animate(mv, value, { duration: 0.5, ease: EASE })
    return () => controls.stop()
  }, [value, reduce, mv])
  return <motion.span className={className}>{text}</motion.span>
}

/**
 * Progressive-disclosure "Why this?" for an item's rationale. Collapsed by
 * default so the shopping list stays scannable; tapping reveals the educational
 * "why" inline. The list is the action — the reasoning is one tap away for
 * anyone who wants it, and invisible to anyone who doesn't.
 */
function WhyDisclosure({ id, text }: { id: string; text: string }) {
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const panelId = `why-${id}`
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="-mx-1 inline-flex items-center gap-1.5 rounded-full px-1 py-1 text-xs font-semibold text-[var(--primary)] transition-colors hover:text-[var(--secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
      >
        <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 flex-none" fill="currentColor">
          <path d="M8 1.25a6.75 6.75 0 1 0 0 13.5 6.75 6.75 0 0 0 0-13.5ZM7.1 5.2a.9.9 0 1 1 1.8 0 .9.9 0 0 1-1.8 0ZM7.25 7.5a.75.75 0 0 1 1.5 0v3.75a.75.75 0 0 1-1.5 0V7.5Z" />
        </svg>
        Why this?
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          className={`h-3 w-3 flex-none transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel"
            id={panelId}
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="overflow-hidden"
          >
            <p className="mt-1.5 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-200">
              {text}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PersonIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 flex-none">
      <path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 0 0-13.074.003Z" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 flex-none">
      <path
        fillRule="evenodd"
        d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** Prominent stat chip — icon + value — for the household + prep-window header. */
function StatBadge({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3.5 py-2 text-sm font-bold capitalize text-[var(--primary)] ring-1 ring-sky-100">
      <span className="text-[var(--primary)]">{icon}</span>
      {text}
    </span>
  )
}

/** Single item row — shared between shopping mode (store groups) and prep mode (category groups). */
function ItemRow({
  p,
  owned,
  onSetStatus,
  planMode = 'shopping',
}: {
  p: PlannedItem
  owned: boolean
  onSetStatus: (id: string, owned: boolean) => void
  planMode?: PlanMode
}) {
  return (
    <li className="p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={`font-semibold transition-colors duration-300 ${
              owned ? 'text-slate-500 line-through' : 'text-slate-900'
            }`}
          >
            {p.qty}× {p.item.name}
          </p>
          {p.item.url ? (
            <a
              href={p.item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-[var(--primary)] underline underline-offset-2"
            >
              {p.item.product}
              <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3 flex-none opacity-70" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4.5 1.5H1.5v9h9V7.5M7.5 1.5H10.5V4.5M10.5 1.5 5.5 6.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </a>
          ) : (
            <p className="text-sm text-slate-500">{p.item.product}</p>
          )}
          {p.item.note && (
            <p className="mt-0.5 text-xs text-slate-500">{p.item.note}</p>
          )}
          {p.item.rationale && (
            <WhyDisclosure id={p.item.id} text={p.item.rationale} />
          )}
        </div>
        <span
          className={`flex-none text-sm font-semibold tabular-nums transition-colors duration-300 ${
            owned ? 'text-slate-500 line-through' : 'text-slate-700'
          }`}
        >
          {formatUsd(p.lineTotal)}
        </span>
      </div>

      {/* Need to buy / Have it toggle. aria-pressed exposes state to AT;
          ✓ + fill are non-color cues so the choice never rides on hue alone. */}
      <div className="mt-2 inline-flex rounded-full bg-slate-100 p-0.5 text-sm font-semibold">
        <button
          type="button"
          aria-pressed={!owned}
          onClick={() => onSetStatus(p.item.id, false)}
          className={`flex min-h-11 items-center rounded-full px-3.5 transition-[transform,background-color,color] duration-150 active:scale-95 ${
            owned ? 'text-slate-600' : 'bg-[var(--primary)] text-white'
          }`}
        >
          Need to {planMode === 'prep' ? 'get' : 'buy'}
        </button>
        <button
          type="button"
          aria-pressed={owned}
          onClick={() => onSetStatus(p.item.id, true)}
          className={`flex min-h-11 items-center gap-1 rounded-full px-3.5 transition-[transform,background-color,color] duration-150 active:scale-95 ${
            owned ? 'bg-[var(--secondary)] text-white' : 'text-slate-600'
          }`}
        >
          {owned && <span aria-hidden>✓</span>}
          Have it
        </button>
      </div>
    </li>
  )
}

const DAY_PRESETS = [7, 15, 30]
const MAX_DAYS = 30

/**
 * Live "how long to prepare for" control on the plan screen. The booth's
 * configured value seeds it (see PlanView); the visitor can switch presets or
 * dial in a custom number, and the whole plan + total re-generate immediately.
 * This replaces a forced booth-wide value with the visitor's own choice, without
 * adding a question to the form.
 */
function PrepWindow({ days, onSetDays }: { days: number; onSetDays: (n: number) => void }) {
  const presetActive = DAY_PRESETS.includes(days)
  const [custom, setCustom] = useState(!presetActive)
  const customActive = custom || !presetActive

  const pill = (active: boolean) =>
    `flex min-h-10 items-center rounded-full px-3.5 transition-[transform,background-color,color] duration-150 active:scale-95 ${
      active ? 'bg-[var(--primary)] text-white' : 'text-slate-600'
    }`

  return (
    <div className="mt-4 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-semibold text-slate-700">Supplies for</span>
        <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-sm font-semibold">
          {DAY_PRESETS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={!customActive && days === d}
              onClick={() => {
                setCustom(false)
                onSetDays(d)
              }}
              className={pill(!customActive && days === d)}
            >
              {d} days
            </button>
          ))}
          <button
            type="button"
            aria-pressed={customActive}
            onClick={() => setCustom(true)}
            className={pill(customActive)}
          >
            Custom
          </button>
        </div>

        {customActive && (
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              aria-label="Fewer days"
              onClick={() => onSetDays(Math.max(1, days - 1))}
              disabled={days <= 1}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xl font-bold text-slate-700 active:bg-slate-200 disabled:opacity-30"
            >
              −
            </button>
            <span className="w-12 text-center text-base font-bold tabular-nums text-slate-900">
              {days}
              <span className="ml-0.5 text-xs font-semibold text-slate-500">d</span>
            </span>
            <button
              type="button"
              aria-label="More days"
              onClick={() => onSetDays(Math.min(MAX_DAYS, days + 1))}
              disabled={days >= MAX_DAYS}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary)] text-xl font-bold text-white active:opacity-80 disabled:opacity-30"
            >
              +
            </button>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        How many days of food, water and supplies to plan for. Quantities and your total update
        automatically.
      </p>
    </div>
  )
}

/**
 * Step 2: the shopping list. Every item starts as "Need to buy"; tapping
 * "Have it" moves it out of the total and the printed/emailed shopping list.
 * The total reflects what's left to spend at the store.
 *
 * `have` (the set of owned item ids) and `onSetStatus` are owned by PlanView so
 * the choice can be persisted to the visitor's phone.
 */
export function PlanResult({
  plan,
  have,
  onSetStatus,
  onRestart,
  days = 0,
  onSetDays,
  preview = false,
  emailEnabled = false,
  emailExtras = { tips: [], nextSteps: [], resources: [] },
  planMode = 'shopping',
}: {
  plan: Plan
  have: Set<string>
  onSetStatus: (id: string, owned: boolean) => void
  onRestart: () => void
  /** The visitor's chosen prep window (days). Owned by PlanView so it persists. */
  days?: number
  /** Change the prep window — regenerates the plan live. Omitted in preview. */
  onSetDays?: (n: number) => void
  /** Admin live preview: render the list + total, but hide the download/email/
   *  start-over actions (so the preview is clean and can't trigger a send). */
  preview?: boolean
  /** Whether the server has EMAIL_WEBHOOK_URL configured. Passed from PlanView. */
  emailEnabled?: boolean
  /** Booth-deck takeaways + operator links that enrich the email body. */
  emailExtras?: EmailExtras
  planMode?: PlanMode
}) {
  const [email, setEmail] = useState('')
  const [send, setSend] = useState<SendState>({ kind: 'idle' })

  // Split the plan into what to buy vs. what they already have.
  const buyKeep = new Set(plan.items.filter((p) => !have.has(p.item.id)).map((p) => p.item.id))
  const buyPlan = selectItems(plan, buyKeep)
  const havePlan = selectItems(plan, have)
  const buyCount = plan.items.length - have.size

  // Anonymous per-item Have/Need snapshot for the "community needs" report —
  // item ids only (config keys, not PII). Sent with the takeaway events.
  const itemProps = () => {
    const planIds = plan.items.map((p) => p.item.id)
    return { plan: planIds, have: planIds.filter((id) => have.has(id)) }
  }

  async function handleDownload() {
    const { savePlanPdf } = await import('../../planner/pdf')
    await savePlanPdf(buyPlan, havePlan, planMode)
    track('pdf_download', itemProps()) // takeaway: they left with their list
  }

  async function handleSend() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setSend({ kind: 'error', message: 'Enter a valid email address.' })
      return
    }
    setSend({ kind: 'sending' })
    const res = await sendPlanEmail(buyPlan, havePlan, email, emailExtras, planMode)
    if (res.ok) {
      setSend({ kind: 'sent' })
      track('email_sent', itemProps()) // takeaway — note: the recipient address is never tracked
    } else {
      const message =
        res.reason === 'disabled'
          ? "Email isn't set up at this booth. Download the PDF instead."
          : "Couldn't send right now. Try again or download the PDF."
      setSend({ kind: 'error', message })
    }
  }

  return (
    <div className="mx-auto w-full max-w-md pb-32 @2xl:max-w-3xl @5xl:max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <h1 className="text-2xl font-black tracking-tight text-slate-900">
          {planMode === 'prep' ? 'Your Prep List' : 'Your Shopping List'}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatBadge icon={<PersonIcon />} text={plan.household} />
          <StatBadge icon={<CalendarIcon />} text={`${plan.days}-day supply`} />
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-500">
        Tap <span className="font-semibold text-slate-700">Have it</span> on anything you
        already own. Your total updates automatically.
      </p>

      {!preview && onSetDays && <PrepWindow days={days} onSetDays={onSetDays} />}

      {/* Item groups: shopping mode groups by store with color accents;
          prep mode groups by category for an "understand your kit" frame. */}
      <div className="mt-4 border-t border-slate-100 pt-4 @2xl:columns-2 @2xl:gap-5 @5xl:columns-3">
      {planMode === 'prep'
        ? plan.byCategory.map((group, gi) => (
          <motion.section
            key={group.category}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: gi * 0.07, duration: 0.45, ease: EASE }}
            className="mt-6 @2xl:mt-0 @2xl:mb-5 @2xl:break-inside-avoid"
          >
            <h2 className="text-lg font-black text-slate-800">{group.label}</h2>
            <div aria-hidden className="mt-1.5 mb-2 h-0.5 w-full rounded-full bg-slate-100" />
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white shadow-sm">
              {group.items.map((p) => (
                <ItemRow key={p.item.id} p={p} owned={have.has(p.item.id)} onSetStatus={onSetStatus} planMode={planMode} />
              ))}
            </ul>
          </motion.section>
        ))
        : plan.byStore.map((group, gi) => {
          const storeBuyTotal = group.items.reduce(
            (s, p) => (have.has(p.item.id) ? s : s + p.lineTotal),
            0,
          )
          const color = storeColor(group.store.color)
          return (
            <motion.section
              key={group.store.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: gi * 0.07, duration: 0.45, ease: EASE }}
              className="mt-6 @2xl:mt-0 @2xl:mb-5 @2xl:break-inside-avoid"
            >
              <div className="flex items-baseline justify-between">
                <h2 className="flex items-center gap-2 text-lg font-black text-[var(--primary)]">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 flex-none rounded-full"
                    style={{ backgroundColor: color.dot }}
                  />
                  {group.store.label}
                </h2>
                <span className="text-sm font-semibold text-slate-500">
                  {formatUsd(storeBuyTotal)}
                </span>
              </div>
              {/* Short colored rule keys the section to its store. */}
              <div
                aria-hidden
                className="mt-1.5 mb-2 h-1 w-10 rounded-full"
                style={{ backgroundColor: color.dot }}
              />
              <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white shadow-sm">
                {group.items.map((p) => (
                  <ItemRow key={p.item.id} p={p} owned={have.has(p.item.id)} onSetStatus={onSetStatus} planMode={planMode} />
                ))}
              </ul>
            </motion.section>
          )
        })
      }
      </div>

      {/* Summary + actions stay in a centered, readable column on every size. */}
      <div className="mx-auto mt-6 max-w-md">
      <div className="flex items-center justify-between rounded-2xl bg-[var(--primary)] px-4 py-4 text-white">
        <span className="font-semibold">{planMode === 'prep' ? 'Total to get' : 'Total to buy'}</span>
        <AnimatedUsd
          value={buyPlan.total}
          className="text-2xl font-black tracking-tight tabular-nums"
        />
      </div>
      <p className="mt-2 text-center text-xs text-slate-500">
        {have.size > 0
          ? `${buyCount} of ${plan.items.length} items to ${planMode === 'prep' ? 'get' : 'buy'} · full kit value ${formatUsd(plan.total)} · estimates`
          : `${plan.items.length} items · prices are estimates`}
      </p>

      {/* Actions — hidden in the admin live preview. */}
      {!preview && (
      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={handleDownload}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-lg font-bold text-white transition-[transform,background-color] hover:bg-slate-700 active:scale-[0.98] active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
        >
          <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 flex-none">
            <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z"/>
            <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z"/>
          </svg>
          Download PDF
        </button>

        {emailEnabled && send.kind !== 'sent' && (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <label htmlFor="plan-email" className="text-sm font-semibold text-slate-700">
              Email it to me
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="plan-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`min-w-0 flex-1 rounded-xl border px-3 py-3 text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                  send.kind === 'error'
                    ? 'border-red-400 focus-visible:border-red-400'
                    : 'border-slate-300 focus-visible:border-[var(--primary)]'
                }`}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={send.kind === 'sending'}
                className="flex flex-none items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 font-bold text-white transition-[transform,opacity] hover:opacity-90 active:scale-95 active:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
              >
                {send.kind === 'sending' && (
                  <svg aria-hidden className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                )}
                {send.kind === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </div>
            {send.kind === 'error' && (
              <p className="mt-2 text-sm text-red-600">{send.message}</p>
            )}
            <p className="mt-3 text-xs leading-snug text-slate-400">
              Privacy: your email is used only to send this one shopping list — we won’t share it or
              send anything else.
            </p>
          </div>
        )}

        {send.kind === 'sent' && (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="rounded-2xl bg-green-50 p-4 text-center font-semibold text-green-700"
          >
            ✓ Sent! Check your inbox.
          </motion.p>
        )}

        <button
          type="button"
          onClick={onRestart}
          className="w-full py-3 text-center font-semibold text-slate-500 transition-colors hover:text-slate-700 active:text-slate-700"
        >
          Start over
        </button>
      </div>
      )}
      </div>
    </div>
  )
}
