import { useEffect } from 'react'

/**
 * Keeps the screen awake for an unattended kiosk using the Screen Wake Lock
 * API. The lock is dropped by the browser whenever the page is hidden (e.g.
 * the OS dims the display), so we re-acquire it on visibilitychange.
 *
 * Best-effort: the API needs a secure context (https or localhost) and isn't
 * available everywhere. For a hard guarantee, also disable sleep in the OS /
 * display settings of the booth machine — see CLAUDE.md "Kiosk deployment".
 */
export function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false

    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        // Ignored: denied, not visible, or unsupported. Nothing we can do.
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible' && !cancelled) void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
    }
  }, [])
}
