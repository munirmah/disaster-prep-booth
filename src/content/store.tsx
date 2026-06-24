import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { slides as builtinSlides } from './slides'
import type { Slide } from './types'
import { planConfig } from '../planner/plan-config'
import type { PlannerConfig, StoreDef } from '../planner/types'
import { isStoreColorKey } from '../planner/store-colors'
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../settings'
import { sanitizeDeck } from '../deck'

/**
 * The single content document for the whole booth — slides, the planner config,
 * and settings. Source of truth is the server (`GET /api/content`); the booth
 * and visitor phones both read it. Resolution at load:
 *
 *   server fetch  →  localStorage cache  →  built-in default
 *
 * so the app paints instantly from cache/built-in and never blanks if the
 * server is briefly unreachable. The admin publishes a new document with
 * `publish()` (POST, passphrase-authed). See server/main.go.
 */
export interface BoothContent {
  version: number
  slides: Slide[]
  planner: PlannerConfig
  settings: Settings
}

export const BUILTIN_CONTENT: BoothContent = {
  version: 1,
  slides: builtinSlides,
  planner: planConfig,
  settings: DEFAULT_SETTINGS,
}

const CACHE_KEY = 'dpb.content'
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')
const CONTENT_URL = `${API_BASE}/api/content`

function sanitizePlanner(raw: unknown): PlannerConfig {
  if (!raw || typeof raw !== 'object') return BUILTIN_CONTENT.planner
  const r = raw as Record<string, unknown>
  // Core arrays must exist; otherwise fall back so the planner can't break.
  if (!Array.isArray(r.questions) || !Array.isArray(r.stores) || !Array.isArray(r.items)) {
    return BUILTIN_CONTENT.planner
  }
  // Drop any store `color` that isn't a known palette key, so a bad value can
  // never reach a className on the next load (resolve falls back to default).
  const stores = (r.stores as StoreDef[]).map((s) =>
    s && isStoreColorKey(s.color) ? s : { ...s, color: undefined },
  )
  return { ...(raw as PlannerConfig), stores }
}

export function sanitizeContent(raw: unknown): BoothContent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const slides = sanitizeDeck(r.slides)
  return {
    version: typeof r.version === 'number' ? r.version : 1,
    slides: slides.length ? slides : BUILTIN_CONTENT.slides,
    planner: sanitizePlanner(r.planner),
    settings: sanitizeSettings(r.settings),
  }
}

function loadCache(): BoothContent | null {
  try {
    const v = localStorage.getItem(CACHE_KEY)
    return v ? sanitizeContent(JSON.parse(v)) : null
  } catch {
    return null
  }
}

function saveCache(c: BoothContent) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch {
    // ignore quota / private mode
  }
}

export type ContentStatus = 'builtin' | 'cache' | 'live' | 'offline'
export type PublishResult = { ok: true } | { ok: false; error: string; auth?: boolean }

interface ContentCtx {
  content: BoothContent
  status: ContentStatus
  publish: (next: BoothContent, secret: string) => Promise<PublishResult>
}

const Ctx = createContext<ContentCtx | null>(null)

export function ContentProvider({ children }: { children: ReactNode }) {
  const cached = loadCache()
  const [content, setContent] = useState<BoothContent>(cached ?? BUILTIN_CONTENT)
  const [status, setStatus] = useState<ContentStatus>(cached ? 'cache' : 'builtin')

  useEffect(() => {
    let cancelled = false
    fetch(CONTENT_URL, { headers: { Accept: 'application/json' } })
      .then((res) => {
        // 404 = server reachable but nothing published yet → stay on built-in,
        // but we ARE connected.
        if (res.status === 404) {
          if (!cancelled) setStatus('live')
          return null
        }
        if (!res.ok) throw new Error(String(res.status))
        return res.json()
      })
      .then((data) => {
        if (cancelled || data === null) return
        const c = sanitizeContent(data)
        setContent(c)
        saveCache(c)
        setStatus('live')
      })
      .catch(() => {
        // No server / unreachable: keep cache or built-in.
        if (!cancelled) setStatus((s) => (s === 'cache' ? 'cache' : 'offline'))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const publish = async (next: BoothContent, secret: string): Promise<PublishResult> => {
    try {
      const res = await fetch(CONTENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify(next),
      })
      if (res.ok) {
        setContent(next)
        saveCache(next)
        setStatus('live')
        return { ok: true }
      }
      if (res.status === 401) {
        return { ok: false, error: 'Wrong or missing passphrase.', auth: true }
      }
      // Surface the server's own {"error":"..."} so the cause is visible
      // (e.g. "writes disabled…", "storage unavailable", or a non-API origin).
      let serverMsg = ''
      try {
        const j = await res.json()
        if (j && typeof j.error === 'string') serverMsg = j.error
      } catch {
        // Non-JSON body — usually means we hit something other than the API
        // (e.g. the Vite dev server with no Go backend running).
      }
      return {
        ok: false,
        error: serverMsg ? `${serverMsg} (${res.status})` : `Server error (${res.status}).`,
      }
    } catch {
      return { ok: false, error: 'Could not reach the server.' }
    }
  }

  return <Ctx.Provider value={{ content, status, publish }}>{children}</Ctx.Provider>
}

export function useContent(): ContentCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useContent must be used within <ContentProvider>')
  return ctx
}
