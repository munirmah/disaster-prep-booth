import { MotionConfig } from 'motion/react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ContentProvider } from './content/store'
import { BoothView } from './views/BoothView'
import { PlanView } from './views/PlanView'
import { AdminView } from './views/AdminView'

/**
 * HashRouter is intentional: the QR code and deep links (#/plan) resolve
 * client-side, so the app works on any static host (GitHub Pages, a USB stick,
 * a sub-path) with no server-side rewrite rules.
 *
 *   /         → PlanView   (the phone form the QR opens — the default surface)
 *   /#/booth  → BoothView  (the TV screen, with the QR code)
 *   /#/admin  → AdminView  (PIN-gated volunteer settings)
 */
export default function App() {
  return (
    // reducedMotion="user" makes framer-motion honor prefers-reduced-motion
    // (drops transform/layout animations, keeps opacity). The CSS guard in
    // index.css covers the CSS-driven transitions/keyframes.
    <ContentProvider>
      <MotionConfig reducedMotion="user">
        <HashRouter>
          <Routes>
            <Route path="/" element={<PlanView />} />
            <Route path="/booth" element={<BoothView />} />
            <Route path="/admin" element={<AdminView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </MotionConfig>
    </ContentProvider>
  )
}
