import { useState, useEffect } from 'react'

/**
 * Fetches /api/config once (module-level singleton) and exposes runtime
 * server configuration — emailEnabled, auth mode — to React components.
 *
 * Pre-fetching at module load means the promise is usually already resolved
 * by the time components mount, so the hook update is near-instant.
 */
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')

export interface ResourceLink {
  label: string
  url: string
}

interface AppConfig {
  emailEnabled: boolean
  /** "Go further" actions shown in the plan email (operator-editable). */
  nextSteps: string[]
  /** Resource links shown in the plan email (operator-editable). */
  resources: ResourceLink[]
}

const EMPTY: AppConfig = { emailEnabled: false, nextSteps: [], resources: [] }

function parseConfig(j: Record<string, unknown>): AppConfig {
  const nextSteps = Array.isArray(j['emailNextSteps'])
    ? (j['emailNextSteps'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  const resources = Array.isArray(j['emailResources'])
    ? (j['emailResources'] as unknown[])
        .filter(
          (r): r is ResourceLink =>
            !!r &&
            typeof (r as ResourceLink).label === 'string' &&
            typeof (r as ResourceLink).url === 'string',
        )
        .map((r) => ({ label: r.label, url: r.url }))
    : []
  return { emailEnabled: j['emailEnabled'] === true, nextSteps, resources }
}

let _promise: Promise<AppConfig> | null = null

function fetchAppConfig(): Promise<AppConfig> {
  if (!_promise) {
    _promise = fetch(`${API_BASE}/api/config`)
      .then((r) => (r.ok ? r.json() : ({} as Record<string, unknown>)))
      .then((j: Record<string, unknown>) => parseConfig(j))
      .catch(() => EMPTY)
  }
  return _promise
}

// Kick off immediately so it's ready before any component mounts.
fetchAppConfig()

export function useEmailEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetchAppConfig().then((c) => {
      if (!cancelled) setEnabled(c.emailEnabled)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return enabled
}

/** The operator-editable email extras (next-steps + resource links). */
export function useEmailExtras(): { nextSteps: string[]; resources: ResourceLink[] } {
  const [extras, setExtras] = useState<{ nextSteps: string[]; resources: ResourceLink[] }>({
    nextSteps: [],
    resources: [],
  })
  useEffect(() => {
    let cancelled = false
    fetchAppConfig().then((c) => {
      if (!cancelled) setExtras({ nextSteps: c.nextSteps, resources: c.resources })
    })
    return () => {
      cancelled = true
    }
  }, [])
  return extras
}
