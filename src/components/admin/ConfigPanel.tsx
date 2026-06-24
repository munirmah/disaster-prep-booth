import { useCallback, useEffect, useState } from 'react'

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')
const CONFIG_URL = `${API_BASE}/api/admin/config`

interface ResourceLink {
  label: string
  url: string
}

interface ServerConfig {
  eventName: string
  emailWebhookSet: boolean
  emailWebhookMasked: string
  emailNextSteps: string[]
  emailResources: ResourceLink[]
  passphraseSet: boolean
  authMode: 'passphrase' | 'sso' | 'none'
  port: string
  contentDir: string
}

type Load = { kind: 'loading' } | { kind: 'error'; msg: string } | { kind: 'ready'; cfg: ServerConfig }

/**
 * Admin "Config" tab — the booth's self-sufficient runtime settings, persisted
 * server-side to config.json (seeded from env on first boot). Holds the event
 * name, the email webhook, and the admin passphrase, so the binary no longer
 * depends on its launch environment for them. Bootstrap-only values (port, data
 * dir, auth mode) are shown read-only.
 */
export function ConfigPanel({ getCredential }: { getCredential: () => Promise<string> }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })

  const refresh = useCallback(async () => {
    setLoad({ kind: 'loading' })
    try {
      const cred = await getCredential()
      const res = await fetch(CONFIG_URL, { headers: { Authorization: `Bearer ${cred}` } })
      if (res.status === 401) return setLoad({ kind: 'error', msg: 'Not authorized — sign in to manage config.' })
      if (!res.ok) return setLoad({ kind: 'error', msg: `Couldn’t load config (server ${res.status}).` })
      setLoad({ kind: 'ready', cfg: (await res.json()) as ServerConfig })
    } catch {
      setLoad({ kind: 'error', msg: 'Couldn’t reach the server. Config needs the booth binary running.' })
    }
  }, [getCredential])

  useEffect(() => {
    refresh()
  }, [refresh])

  const save = useCallback(
    async (patch: Record<string, unknown>): Promise<{ ok: true } | { ok: false; msg: string }> => {
      try {
        const cred = await getCredential()
        const res = await fetch(CONFIG_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cred}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (res.ok) return { ok: true }
        const j = await res.json().catch(() => ({}))
        return { ok: false, msg: (j as { error?: string }).error ?? `Server ${res.status}` }
      } catch {
        return { ok: false, msg: 'Could not reach the server.' }
      }
    },
    [getCredential],
  )

  if (load.kind === 'loading') return <p className="py-10 text-center text-sm text-slate-400">Loading config…</p>
  if (load.kind === 'error')
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-[var(--accent)]">{load.msg}</p>
        <button type="button" onClick={refresh} className="mt-3 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-bold text-white active:opacity-90">
          Try again
        </button>
      </div>
    )

  const { cfg } = load
  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h3 className="text-lg font-black text-slate-900">Booth configuration</h3>
        <p className="text-xs text-slate-500">Saved on the server (config.json) — no environment variables or restart needed.</p>
      </div>

      <EventNameCard value={cfg.eventName} onSave={save} />
      <EmailCard configured={cfg.emailWebhookSet} masked={cfg.emailWebhookMasked} onSave={save} />
      <EmailContentCard
        nextSteps={cfg.emailNextSteps}
        resources={cfg.emailResources}
        onSave={save}
      />
      {cfg.authMode === 'passphrase' ? (
        <PassphraseCard onSave={save} />
      ) : (
        <Card title="Admin access">
          <p className="text-sm text-slate-600">
            Sign-in is handled by <span className="font-semibold">Microsoft SSO</span>, configured via the server
            environment. There’s no passphrase to manage here.
          </p>
        </Card>
      )}

      <Card title="Server (read-only)">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-slate-400">Auth mode</dt>
          <dd className="font-semibold text-slate-700">{cfg.authMode}</dd>
          <dt className="text-slate-400">Port</dt>
          <dd className="font-semibold text-slate-700">{cfg.port}</dd>
          <dt className="text-slate-400">Data dir</dt>
          <dd className="truncate font-semibold text-slate-700">{cfg.contentDir}</dd>
        </dl>
        <p className="mt-2 text-xs text-slate-400">These are set when the binary launches and can’t change at runtime.</p>
      </Card>
    </div>
  )
}

type SaveFn = (patch: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; msg: string }>

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-100">
      <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">{title}</h4>
      {children}
    </section>
  )
}

function Status({ state }: { state: SaveState }) {
  if (state === 'saving') return <span className="text-xs text-slate-400">Saving…</span>
  if (state === 'saved') return <span className="text-xs font-semibold text-green-600">✓ Saved</span>
  if (typeof state === 'object') return <span className="text-xs font-semibold text-red-600">{state.error}</span>
  return null
}
type SaveState = 'idle' | 'saving' | 'saved' | { error: string }

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'
const btnCls =
  'rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-bold text-white transition-[transform,opacity] hover:opacity-90 active:scale-95 disabled:opacity-40'

function EventNameCard({ value, onSave }: { value: string; onSave: SaveFn }) {
  const [v, setV] = useState(value)
  const [state, setState] = useState<SaveState>('idle')
  const dirty = v.trim() !== value
  return (
    <Card title="Event name">
      <p className="mb-2 text-xs text-slate-500">Stamped on analytics events and used as the Report’s event filter. Change it for each new event.</p>
      <div className="flex items-center gap-2">
        <input value={v} onChange={(e) => { setV(e.target.value); setState('idle') }} className={inputCls} placeholder="e.g. Spring Expo 2026" />
        <button
          type="button"
          disabled={!dirty || state === 'saving'}
          onClick={async () => { setState('saving'); const r = await onSave({ eventName: v.trim() }); setState(r.ok ? 'saved' : { error: r.msg }) }}
          className={`${btnCls} flex-none`}
        >
          Save
        </button>
      </div>
      <div className="mt-1.5"><Status state={state} /></div>
    </Card>
  )
}

function EmailCard({ configured, masked, onSave }: { configured: boolean; masked: string; onSave: SaveFn }) {
  const [editing, setEditing] = useState(!configured)
  const [v, setV] = useState('')
  const [state, setState] = useState<SaveState>('idle')
  return (
    <Card title="Email webhook">
      <p className="mb-2 text-xs text-slate-500">
        The Power Automate flow URL that sends plans. Empty = email is off (the PDF download still works).
      </p>
      {configured && !editing ? (
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">{masked}</code>
          <span className="flex-none text-xs font-semibold text-green-600">● enabled</span>
          <button type="button" onClick={() => { setEditing(true); setV('') }} className="flex-none rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
            Replace
          </button>
        </div>
      ) : (
        <>
          <input value={v} onChange={(e) => { setV(e.target.value); setState('idle') }} className={inputCls} placeholder="https://…logic.azure.com/…/triggers/…" />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={state === 'saving'}
              onClick={async () => { setState('saving'); const r = await onSave({ emailWebhookUrl: v.trim() }); setState(r.ok ? 'saved' : { error: r.msg }); if (r.ok && v.trim()) setEditing(false) }}
              className={btnCls}
            >
              Save
            </button>
            {configured && (
              <button
                type="button"
                onClick={async () => { setState('saving'); const r = await onSave({ emailWebhookUrl: '' }); setState(r.ok ? 'saved' : { error: r.msg }) }}
                className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--accent)] ring-1 ring-slate-200"
              >
                Remove (disable email)
              </button>
            )}
            {configured && (
              <button type="button" onClick={() => { setEditing(false); setState('idle') }} className="text-sm font-semibold text-slate-500">
                Cancel
              </button>
            )}
            <Status state={state} />
          </div>
        </>
      )}
    </Card>
  )
}

function EmailContentCard({
  nextSteps,
  resources,
  onSave,
}: {
  nextSteps: string[]
  resources: ResourceLink[]
  onSave: SaveFn
}) {
  const [stepsText, setStepsText] = useState(nextSteps.join('\n'))
  const [links, setLinks] = useState<ResourceLink[]>(resources)
  const [state, setState] = useState<SaveState>('idle')

  const cleanSteps = stepsText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const cleanLinks = links
    .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
    .filter((l) => l.label && l.url)

  const dirty =
    JSON.stringify(cleanSteps) !== JSON.stringify(nextSteps) ||
    JSON.stringify(cleanLinks) !== JSON.stringify(resources)

  return (
    <Card title="Email content">
      <p className="mb-3 text-xs text-slate-500">
        Added to the emailed plan, below the shopping list. The “Good to know” tips come
        automatically from your booth slides; set the “Go further” steps and resource links here.
        Leave a field empty to use the built-in defaults.
      </p>

      <label className="block text-xs font-semibold text-slate-500">Go further — one step per line</label>
      <textarea
        value={stepsText}
        onChange={(e) => {
          setStepsText(e.target.value)
          setState('idle')
        }}
        rows={4}
        className={`${inputCls} mt-1 font-normal`}
        placeholder={'Make a family communication plan.\nLearn your evacuation routes.'}
      />

      <label className="mt-4 block text-xs font-semibold text-slate-500">Resource links</label>
      <div className="mt-1 space-y-2">
        {links.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={l.label}
              onChange={(e) => {
                setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                setState('idle')
              }}
              className={`${inputCls} flex-none basis-36`}
              placeholder="Ready.gov"
            />
            <input
              value={l.url}
              onChange={(e) => {
                setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                setState('idle')
              }}
              className={`${inputCls} min-w-0 flex-1`}
              placeholder="https://www.ready.gov"
            />
            <button
              type="button"
              aria-label="Remove link"
              onClick={() => {
                setLinks((ls) => ls.filter((_, j) => j !== i))
                setState('idle')
              }}
              className="flex-none rounded-lg px-2 py-2 text-slate-400 transition-colors hover:text-[var(--accent)]"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setLinks((ls) => [...ls, { label: '', url: '' }])}
          className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200"
        >
          + Add link
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || state === 'saving'}
          onClick={async () => {
            setState('saving')
            const r = await onSave({ emailNextSteps: cleanSteps, emailResources: cleanLinks })
            setState(r.ok ? 'saved' : { error: r.msg })
          }}
          className={btnCls}
        >
          Save
        </button>
        <Status state={state} />
      </div>
    </Card>
  )
}

function PassphraseCard({ onSave }: { onSave: SaveFn }) {
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [state, setState] = useState<SaveState>('idle')
  const localError =
    next && next.length < 6 ? 'New passphrase must be at least 6 characters.' : next !== confirm ? 'New passphrase and confirmation don’t match.' : ''
  const canSave = cur !== '' && next !== '' && !localError && state !== 'saving'
  return (
    <Card title="Admin passphrase">
      <p className="mb-2 text-xs text-slate-500">Stored hashed on the server — never in plain text.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block text-xs font-semibold text-slate-500">
          Current
          <input type="password" autoComplete="current-password" value={cur} onChange={(e) => { setCur(e.target.value); setState('idle') }} className={`${inputCls} mt-1 font-normal`} />
        </label>
        <label className="block text-xs font-semibold text-slate-500">
          New
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setState('idle') }} className={`${inputCls} mt-1 font-normal`} />
        </label>
        <label className="block text-xs font-semibold text-slate-500">
          Confirm new
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setState('idle') }} className={`${inputCls} mt-1 font-normal`} />
        </label>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={!canSave}
          onClick={async () => {
            setState('saving')
            const r = await onSave({ currentPassphrase: cur, newPassphrase: next })
            if (r.ok) {
              setState('saved')
              setCur(''); setNext(''); setConfirm('')
            } else setState({ error: r.msg })
          }}
          className={btnCls}
        >
          Change passphrase
        </button>
        {state === 'saved' ? (
          <span className="text-xs font-semibold text-green-600">✓ Changed — sign out and back in with the new passphrase.</span>
        ) : localError && next ? (
          <span className="text-xs font-semibold text-red-600">{localError}</span>
        ) : (
          <Status state={state} />
        )}
      </div>
      <p className="mt-2 text-xs text-slate-400">⚠ If this is lost, recovery needs server access (delete config.json to fall back to the env passphrase).</p>
    </Card>
  )
}
