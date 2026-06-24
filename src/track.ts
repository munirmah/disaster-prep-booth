/**
 * Anonymous booth analytics — the visitor funnel, for a later leadership report.
 *
 * Fire-and-forget POSTs to the Go binary's `/api/event`. Best-effort by design:
 * a booth's network is often flaky, so a failed send is swallowed and never
 * blocks the UI (same posture as the email path). The server aggregates these
 * into `/api/stats`, surfaced in the admin "Report" tab.
 *
 * Privacy: no PII is ever sent. `sid` is an opaque per-device random id used
 * only to dedupe refreshes within one visit; the only payload is anonymous
 * household counts on `plan_generated`.
 */

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')
const EVENT_URL = `${API_BASE}/api/event`

const SID_KEY = 'dpb.sid'

/** An opaque, non-identifying device id, generated once and reused. */
function sessionId(): string {
  try {
    let v = localStorage.getItem(SID_KEY)
    if (!v) {
      v = crypto.randomUUID()
      localStorage.setItem(SID_KEY, v)
    }
    return v
  } catch {
    return 'anon' // private mode / storage blocked — still send, just un-deduped
  }
}

export type TrackEvent = 'plan_open' | 'plan_generated' | 'pdf_download' | 'email_sent'

export function track(event: TrackEvent, props?: Record<string, unknown>): void {
  try {
    fetch(EVENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: event, sid: sessionId(), props }),
      // keepalive lets the request outlive a navigation — e.g. the PDF download
      // that immediately follows pdf_download.
      keepalive: true,
    }).catch(() => {})
  } catch {
    // JSON/stringify or fetch unavailable — analytics are never load-bearing.
  }
}
