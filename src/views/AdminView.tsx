import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { planUrl, type Hazard } from '../config'
import { brand } from '../content/brand'
import { useContent, type BoothContent } from '../content/store'
import { HazardsManager } from '../components/admin/HazardsManager'
import { slideMissing } from '../deck'
import {
  accountLabel,
  fetchAuthConfig,
  ssoAccount,
  ssoSignIn,
  ssoSignOut,
  ssoToken,
  type AuthConfig,
  type SsoConfig,
} from '../auth'
import { SlidesManager, DeckBackup, DeckAiPrompt, PlannerBackup, PlannerAiPrompt } from '../components/admin/SlidesManager'
import { PlannerManager } from '../components/admin/PlannerManager'
import { ReportPanel } from '../components/admin/ReportPanel'
import { ConfigPanel } from '../components/admin/ConfigPanel'

const SECRET_KEY = 'dpb.admin.secret'

/** A function that yields a fresh publish credential (passphrase or SSO token). */
type Credential = () => Promise<string>

/**
 * Volunteer admin page (/#/admin). The auth mode is chosen by the server
 * (`/api/config`): Entra/M365 SSO when configured, else a shared passphrase.
 * Edits a local DRAFT of the content document; "Publish" POSTs it so the booth
 * and visitor phones pick it up on next load.
 */
export function AdminView() {
  const [cfg, setCfg] = useState<AuthConfig | null>(null)
  const [cred, setCred] = useState<Credential | null>(null)
  const [account, setAccount] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchAuthConfig().then(async (c) => {
      if (cancelled) return
      setCfg(c)
      if (c.mode === 'sso') {
        const acc = await ssoAccount(c).catch(() => null)
        if (acc && !cancelled) {
          setAccount(accountLabel(acc))
          setCred(() => () => ssoToken(c))
        }
      } else if (c.mode === 'passphrase') {
        const saved = sessionStorage.getItem(SECRET_KEY)
        if (saved && !cancelled) setCred(() => () => Promise.resolve(saved))
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!cfg) return <Centered>Loading…</Centered>
  if (!cred)
    return (
      <Gate
        cfg={cfg}
        onAuthed={(getter, label) => {
          setCred(() => getter)
          setAccount(label)
        }}
      />
    )

  const onSignOut = async () => {
    if (cfg.mode === 'sso') await ssoSignOut(cfg).catch(() => {})
    else sessionStorage.removeItem(SECRET_KEY)
    setCred(null)
    setAccount(null)
  }

  // Passphrase mode: re-set the credential inline after a 401, so a wrong or
  // stale passphrase doesn't strand the user (and loses their unsaved draft).
  const onReauth =
    cfg.mode === 'passphrase'
      ? (secret: string) => {
          sessionStorage.setItem(SECRET_KEY, secret)
          setCred(() => () => Promise.resolve(secret))
        }
      : undefined

  return (
    <AdminPanel
      getCredential={cred}
      account={account}
      onSignOut={onSignOut}
      onReauth={onReauth}
    />
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5 text-slate-400">
      {children}
    </div>
  )
}

function Gate({
  cfg,
  onAuthed,
}: {
  cfg: AuthConfig
  onAuthed: (getter: Credential, label: string | null) => void
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (cfg.mode === 'sso') {
    const sso = cfg as SsoConfig
    const signIn = async () => {
      setBusy(true)
      setError(null)
      try {
        const acc = await ssoSignIn(sso)
        onAuthed(() => ssoToken(sso), accountLabel(acc))
      } catch {
        setError('Sign-in was cancelled or failed.')
        setBusy(false)
      }
    }
    return (
      <Centered>
        <div className="w-full max-w-xs text-center text-slate-900">
          <h1 className="text-xl font-black">Booth Admin</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in with your Humanity First account.</p>
          <button
            type="button"
            onClick={signIn}
            disabled={busy}
            className="mt-4 w-full rounded-2xl bg-[var(--primary)] py-3 font-bold text-white active:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in with Microsoft'}
          </button>
          {error && <p className="mt-2 text-sm text-[var(--accent)]">{error}</p>}
        </div>
      </Centered>
    )
  }

  // passphrase / none
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    sessionStorage.setItem(SECRET_KEY, value)
    onAuthed(() => Promise.resolve(value), null)
  }
  return (
    <Centered>
      <form onSubmit={submit} className="w-full max-w-xs text-center">
        <h1 className="text-xl font-black text-slate-900">Booth Admin</h1>
        <p className="mt-1 text-sm text-slate-500">
          {cfg.mode === 'none'
            ? 'Editing is read-only on this server (no publish credential set).'
            : 'Enter the publish passphrase.'}
        </p>
        <input
          type="password"
          autoFocus
          aria-label="Publish passphrase"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-3 text-center text-lg tracking-widest"
          placeholder="passphrase"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="mt-4 w-full rounded-2xl bg-[var(--primary)] py-3 font-bold text-white active:opacity-90 disabled:opacity-40"
        >
          Continue
        </button>
      </form>
    </Centered>
  )
}

type PubState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'ok' }
  | { kind: 'err'; msg: string }

/**
 * Mandatory-field check across the whole draft — the safety net before content
 * goes live (the inline stores/questions/categories editors have no other gate).
 * Returns a human list of what's missing; empty = publishable.
 */
function contentIssues(c: BoothContent): string[] {
  const out: string[] = []
  c.slides.forEach((s, i) => {
    const m = slideMissing(s)
    if (m) out.push(`Slide ${i + 1} needs ${m}`)
  })
  c.planner.items.forEach((it, i) => {
    if (!it.name.trim()) out.push(`Item ${i + 1} has no name`)
  })
  c.planner.stores.forEach((s, i) => {
    if (!s.label.trim()) out.push(`Store ${i + 1} has no name`)
  })
  c.planner.questions.forEach((q, i) => {
    if (!q.label.trim()) out.push(`Question ${i + 1} has no label`)
  })
  const order = c.planner.categoryOrder ?? Object.keys(c.planner.categoryLabels)
  order.forEach((k, i) => {
    if (!(c.planner.categoryLabels[k] ?? '').trim()) out.push(`Category ${i + 1} has no name`)
  })
  return out
}

const STATUS_LABEL: Record<string, string> = {
  live: 'Connected to server',
  cache: 'Showing cached content',
  offline: 'Not connected — changes won’t publish',
  builtin: 'Using built-in defaults',
}

/** Compact labels for the header indicator (full text is in the title tooltip). */
const SHORT_STATUS: Record<string, string> = {
  live: 'Connected',
  cache: 'Cached',
  offline: 'Offline',
  builtin: 'Built-in',
}

function AdminPanel({
  getCredential,
  account,
  onSignOut,
  onReauth,
}: {
  getCredential: Credential
  account: string | null
  onSignOut?: () => void
  onReauth?: (secret: string) => void
}) {
  const { content, status, publish } = useContent()
  const [draft, setDraft] = useState<BoothContent>(content)
  const [pub, setPub] = useState<PubState>({ kind: 'idle' })
  const [contentTab, setContentTab] = useState<'shopping' | 'slides' | 'hazards' | 'report' | 'config'>('shopping')
  const [reauth, setReauth] = useState(false)
  const [reauthValue, setReauthValue] = useState('')
  const baseRef = useRef<BoothContent>(content)

  // If the published content arrives/changes and the user hasn't diverged, follow it.
  useEffect(() => {
    setDraft((d) => (JSON.stringify(d) === JSON.stringify(baseRef.current) ? content : d))
    baseRef.current = content
  }, [content])

  const dirty = JSON.stringify(draft) !== JSON.stringify(content)
  const issues = contentIssues(draft)

  const setSettings = (patch: Partial<BoothContent['settings']>) =>
    setDraft((d) => ({ ...d, settings: { ...d.settings, ...patch } }))

  const toggleHazard = (id: Hazard) =>
    setDraft((d) => {
      const on = d.settings.hazards.includes(id)
      const hazards = on
        ? d.settings.hazards.filter((h) => h !== id)
        : [...d.settings.hazards, id]
      return { ...d, settings: { ...d.settings, hazards } }
    })

  const onPublish = async () => {
    if (issues.length) return // guarded by the disabled button + banner below
    setPub({ kind: 'saving' })
    try {
      const cred = await getCredential()
      const res = await publish(draft, cred)
      if (res.ok) {
        setPub({ kind: 'ok' })
      } else {
        setPub({ kind: 'err', msg: res.error })
        // Passphrase rejected: prompt to re-enter inline (keeps the draft).
        if (res.auth && onReauth) setReauth(true)
      }
    } catch {
      setPub({ kind: 'err', msg: 'Sign-in needed to publish.' })
    }
  }

  // Retry the publish with a freshly-entered passphrase (and remember it).
  const submitReauth = async (e: React.FormEvent) => {
    e.preventDefault()
    const secret = reauthValue.trim()
    if (!secret) return
    onReauth?.(secret)
    setPub({ kind: 'saving' })
    const res = await publish(draft, secret)
    if (res.ok) {
      setReauth(false)
      setReauthValue('')
      setPub({ kind: 'ok' })
    } else {
      setPub({ kind: 'err', msg: res.error })
      setReauth(Boolean(res.auth)) // close unless still rejected
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--paper)] lg:h-screen lg:overflow-hidden">
      <header className="sticky top-0 z-10 flex-none border-b border-slate-200 bg-white/95 px-5 py-3 backdrop-blur lg:px-8">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 md:max-w-2xl lg:max-w-none">
          <div className="flex min-w-0 items-center gap-2">
            <img src={brand.logoSrc} alt={brand.orgName} className="h-7 w-auto flex-none" />
            <span className="whitespace-nowrap text-sm font-black text-slate-900">Booth Admin</span>
            {/* Connection status — a dot (+ label on wider screens). */}
            <span
              title={STATUS_LABEL[status] ?? status}
              className="ml-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500"
            >
              <span
                className={`h-2 w-2 flex-none rounded-full ${
                  status === 'live'
                    ? 'bg-green-500'
                    : status === 'offline'
                      ? 'bg-[var(--accent)]'
                      : 'bg-[var(--warning)]'
                }`}
              />
              <span className="hidden md:inline">{SHORT_STATUS[status] ?? status}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {account && (
              <span className="hidden max-w-[10ch] truncate text-xs text-slate-500 sm:inline">
                {account}
              </span>
            )}
            {/* Publish/dirty feedback — sm+ only; on phones the Publish button's
                enabled/disabled state carries it, keeping the bar uncluttered. */}
            <span className="hidden items-center gap-2 text-xs sm:flex">
              {pub.kind === 'ok' ? (
                <span className="font-semibold text-green-600">Published ✓</span>
              ) : pub.kind === 'err' ? (
                <span className="max-w-[20ch] truncate font-semibold text-[var(--accent)]">
                  {pub.msg}
                </span>
              ) : dirty ? (
                <>
                  <span className="font-semibold text-[var(--warning)]">Unpublished</span>
                  <button
                    type="button"
                    onClick={() => setDraft(content)}
                    className="font-semibold text-slate-400 underline"
                  >
                    Revert
                  </button>
                </>
              ) : null}
            </span>
            <button
              type="button"
              onClick={onPublish}
              disabled={!dirty || pub.kind === 'saving' || issues.length > 0}
              className="rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-bold text-white active:opacity-90 disabled:opacity-40"
            >
              {pub.kind === 'saving' ? 'Publishing…' : 'Publish'}
            </button>
            <a href="#/" className="hidden text-sm font-semibold text-slate-400 sm:inline">
              Booth
            </a>
            {onSignOut && (
              <button type="button" onClick={onSignOut} className="text-sm font-semibold text-slate-400">
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mandatory-field gate — blocks Publish until the draft is complete, and
          names what's wrong so it's findable across tabs. */}
      {dirty && issues.length > 0 && (
        <div className="flex-none border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-[var(--warning)] lg:px-8">
          <span className="font-bold">Fix before publishing:</span>{' '}
          {issues.slice(0, 4).join(' · ')}
          {issues.length > 4 ? ` · +${issues.length - 4} more` : ''}
        </div>
      )}

      {/* Inline re-auth: shown when a publish is rejected (401) so a wrong or
          stale passphrase can be re-entered without losing the draft. */}
      {reauth && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/30 px-5">
          <form onSubmit={submitReauth} className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-sm font-black text-slate-900">Re-enter passphrase</h2>
            <p className="mt-1 text-xs text-slate-500">
              The publish passphrase was rejected. Enter it again to publish — your edits are kept.
            </p>
            <input
              type="password"
              autoFocus
              aria-label="Publish passphrase"
              value={reauthValue}
              onChange={(e) => setReauthValue(e.target.value)}
              placeholder="passphrase"
              className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-center tracking-widest"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="submit"
                disabled={!reauthValue.trim()}
                className="flex-1 rounded-xl bg-[var(--primary)] py-2 font-bold text-white active:opacity-90 disabled:opacity-40"
              >
                Publish
              </button>
              <button
                type="button"
                onClick={() => setReauth(false)}
                className="rounded-xl px-4 py-2 font-semibold text-slate-500"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <main className="mx-auto w-full max-w-md px-5 py-6 md:max-w-2xl lg:max-w-none lg:px-8 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
        {/* Desktop app-shell: a fixed-height region — the rail and the tabs stay
            anchored and only the editor list scrolls. Stacks + page-scrolls on
            phones/tablets (nested scroll panes are poor UX there). */}
        <div className="lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[19rem_1fr] lg:gap-0">
        {/* Settings & tools rail — anchored; scrolls within itself if tall */}
        <aside className="thin-scroll space-y-6 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pl-1 lg:pr-8">
        {/* Prep window — hazards now live in their own top-level tab. */}
        <Section title="Days of supplies">
          <div className="flex gap-2">
            {[7, 15, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setSettings({ prepDays: d })}
                className={`flex-1 rounded-xl py-3 font-bold ${
                  draft.settings.prepDays === d
                    ? 'bg-[var(--primary)] text-white'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200'
                }`}
              >
                {d} days
              </button>
            ))}
          </div>
        </Section>

        <Section title="List mode" className="border-t border-slate-100 pt-2">
          <div className="flex gap-2">
            {(['shopping', 'prep'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSettings({ planMode: m })}
                className={`flex-1 rounded-xl py-3 text-sm font-bold ${
                  draft.settings.planMode === m
                    ? 'bg-[var(--primary)] text-white'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200'
                }`}
              >
                {m === 'shopping' ? 'Shopping list' : 'Prep list'}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Shopping groups by store. Prep groups by category.
          </p>
        </Section>

        {/* QR the phones scan — click to open the visitor form in a new tab */}
        <Section title="Booth QR" className="border-t border-slate-100 pt-2">
          <a
            href={planUrl()}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the visitor form in a new tab"
            className="flex flex-col items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-100 transition hover:ring-[var(--primary)]"
          >
            <QRCodeSVG value={planUrl()} className="h-40 w-40" level="M" marginSize={2} />
            <span className="break-all text-center text-[11px] text-slate-400">{planUrl()}</span>
          </a>
        </Section>

        {/* Backup / restore tools — tabbed by surface */}
        <Section title="Backup & tools" className="border-t border-slate-100 pt-2">
          <BackupTools
            slides={draft.slides}
            planner={draft.planner}
            onSlidesChange={(slides) => setDraft((d) => ({ ...d, slides }))}
            onPlannerChange={(planner) => setDraft((d) => ({ ...d, planner }))}
          />
        </Section>
        </aside>

        {/* Content column: the two editors, switched via tabs */}
        <div className="mt-6 lg:mt-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:border-l lg:border-slate-200 lg:pl-8">
          <div className="mb-5 flex gap-6 border-b border-slate-200 lg:flex-none">
            {(
              [
                ['shopping', 'Shopping list'],
                ['slides', 'Booth slides'],
                ['hazards', 'Hazards'],
                ['report', 'Report'],
                ['config', 'Config'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setContentTab(id)}
                className={`-mb-px border-b-2 px-1 pb-2.5 text-sm font-bold transition-colors ${
                  contentTab === id
                    ? 'border-[var(--primary)] text-[var(--primary)]'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Only this pane scrolls on desktop; the rail and tabs stay put. */}
          <div className="thin-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-1">
            {contentTab === 'shopping' ? (
              <PlannerManager
                planner={draft.planner}
                settings={draft.settings}
                onChange={(planner) => setDraft((d) => ({ ...d, planner }))}
              />
            ) : contentTab === 'slides' ? (
              <SlidesManager
                slides={draft.slides}
                onChange={(slides) => setDraft((d) => ({ ...d, slides }))}
              />
            ) : contentTab === 'hazards' ? (
              <HazardsManager
                hazards={draft.settings.hazards}
                planner={draft.planner}
                onToggle={toggleHazard}
              />
            ) : contentTab === 'report' ? (
              <ReportPanel getCredential={getCredential} planner={draft.planner} />
            ) : (
              <ConfigPanel getCredential={getCredential} />
            )}
          </div>
        </div>
        </div>
      </main>
    </div>
  )
}

import type { PlannerConfig } from '../planner/types'

function BackupTools({
  slides,
  planner,
  onSlidesChange,
  onPlannerChange,
}: {
  slides: BoothContent['slides']
  planner: PlannerConfig
  onSlidesChange: (slides: BoothContent['slides']) => void
  onPlannerChange: (planner: PlannerConfig) => void
}) {
  const [tab, setTab] = useState<'booth' | 'shopping'>('booth')
  return (
    <div>
      <div className="mb-3 flex gap-1 rounded-xl bg-slate-100 p-0.5">
        {(['booth', 'shopping'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors ${
              tab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
            }`}
          >
            {t === 'booth' ? 'Booth' : 'Shopping list'}
          </button>
        ))}
      </div>
      {tab === 'booth' ? (
        <div className="space-y-3">
          <DeckBackup slides={slides} onChange={onSlidesChange} />
          <DeckAiPrompt slides={slides} onChange={onSlidesChange} />
        </div>
      ) : (
        <div className="space-y-3">
          <PlannerBackup planner={planner} onChange={onPlannerChange} />
          <PlannerAiPrompt planner={planner} onChange={onPlannerChange} />
        </div>
      )}
    </div>
  )
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">{title}</h2>
      {children}
    </section>
  )
}
