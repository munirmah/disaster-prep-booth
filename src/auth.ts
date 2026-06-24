import type { AccountInfo } from '@azure/msal-browser'

/**
 * Admin authentication. The mode is chosen by the SERVER at runtime (via
 * `GET /api/config`), so the same build auto-swaps:
 *   - `sso`        → Microsoft/Entra (M365) sign-in via MSAL; the ID token is
 *                    the publish credential (validated server-side).
 *   - `passphrase` → a shared passphrase is the credential.
 *   - `none`       → writes disabled.
 *
 * MSAL is dynamically imported only when SSO is actually used, so it never
 * ships in the booth/phone bundles.
 */
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')

export type SsoConfig = { mode: 'sso'; tenantId: string; clientId: string }
export type AuthConfig = SsoConfig | { mode: 'passphrase' } | { mode: 'none' }

const SCOPES = ['openid', 'profile', 'User.Read']

export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const r = await fetch(`${API_BASE}/api/config`)
    if (r.ok) {
      const j = await r.json()
      if (j.mode === 'sso' && j.tenantId && j.clientId) return j as SsoConfig
      if (j.mode === 'none') return { mode: 'none' }
      if (j.mode === 'passphrase') return { mode: 'passphrase' }
    }
  } catch {
    // No server / unreachable — fall back to the passphrase gate (e.g. local dev).
  }
  return { mode: 'passphrase' }
}

// Lazily construct one MSAL app (loads @azure/msal-browser on first use).
let appPromise: Promise<import('@azure/msal-browser').PublicClientApplication> | null = null
async function getApp(cfg: SsoConfig) {
  if (!appPromise) {
    appPromise = (async () => {
      const { PublicClientApplication } = await import('@azure/msal-browser')
      const app = new PublicClientApplication({
        auth: {
          clientId: cfg.clientId,
          authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
          redirectUri: `${window.location.origin}${window.location.pathname}`,
        },
        cache: { cacheLocation: 'localStorage' },
      })
      await app.initialize()
      return app
    })()
  }
  return appPromise
}

/** Existing signed-in account, if any (returning admin). */
export async function ssoAccount(cfg: SsoConfig): Promise<AccountInfo | null> {
  const app = await getApp(cfg)
  return app.getActiveAccount() ?? app.getAllAccounts()[0] ?? null
}

/** Interactive Microsoft sign-in. Returns the account. */
export async function ssoSignIn(cfg: SsoConfig): Promise<AccountInfo> {
  const app = await getApp(cfg)
  const existing = app.getAllAccounts()[0]
  if (existing) {
    app.setActiveAccount(existing)
    return existing
  }
  const res = await app.loginPopup({ scopes: SCOPES })
  app.setActiveAccount(res.account)
  return res.account
}

/** A fresh ID token to send as the publish credential (silent, else popup). */
export async function ssoToken(cfg: SsoConfig): Promise<string> {
  const app = await getApp(cfg)
  const account = app.getActiveAccount() ?? app.getAllAccounts()[0]
  if (!account) {
    const res = await app.loginPopup({ scopes: SCOPES })
    app.setActiveAccount(res.account)
    return res.idToken
  }
  try {
    const res = await app.acquireTokenSilent({ account, scopes: SCOPES })
    return res.idToken
  } catch {
    const res = await app.acquireTokenPopup({ scopes: SCOPES })
    return res.idToken
  }
}

export async function ssoSignOut(cfg: SsoConfig): Promise<void> {
  const app = await getApp(cfg)
  const account = app.getActiveAccount() ?? app.getAllAccounts()[0] ?? undefined
  await app.logoutPopup({ account })
}

export const accountLabel = (a: AccountInfo): string => a.name ?? a.username
