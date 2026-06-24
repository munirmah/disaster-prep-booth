import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Old TV browsers (Samsung Tizen, etc.) run the JS but choke on Tailwind v4's
// modern CSS — oklch() colors, color-mix(), @property — leaving content with no
// brand colors / wrong font. Process the CSS with Lightning CSS targeting old
// browsers so it down-converts those to rgb() + plain-custom-property fallbacks:
// modern browsers still get the rich values, old ones degrade gracefully.
// Version numbers are encoded as (major << 16) for Lightning CSS's Targets.
const v = (major: number) => major << 16
const legacyCssTargets = { chrome: v(64), safari: v(12), firefox: v(60), samsung: v(8) }

// Relative base so the built kiosk works when served from a file path,
// USB stick, or sub-path on a local server at the booth.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  css: { transformer: 'lightningcss', lightningcss: { targets: legacyCssTargets } },
  build: { cssMinify: 'lightningcss' },
  server: {
    watch: {
      // Full-stack local dev runs the Go binary with CONTENT_DIR inside the
      // repo (e.g. `make run` → ./data). The server writes content/config and
      // appends analytics to events.ndjson; if Vite watched those, every
      // fire-and-forget `plan_open` would trigger a full page reload, which
      // re-fires `plan_open` — an infinite reload storm that freezes the page.
      // Never watch the server's data dirs.
      ignored: ['**/data/**', '**/devdata/**'],
    },
  },
})
