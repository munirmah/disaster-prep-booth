import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted Public Sans (variable) — bundled by Vite, so the booth has no
// runtime font dependency and works offline. font-display: swap (set by the
// package) avoids invisible text; system-ui is the metric-near fallback.
import '@fontsource-variable/public-sans/index.css'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
