import { SlideShow } from '../components/SlideShow'
import { QrPanel } from '../components/QrPanel'
import { useWakeLock } from '../hooks/useWakeLock'

/**
 * The TV surface (route "/#/booth"). Split layout: the looping awareness deck on
 * the left, a persistent QR call-to-action on the right. The `kiosk` class enables
 * the unattended-display CSS (hidden cursor, no selection) AND the booth's dark
 * background gradient (defined in index.css as explicit hex, so it renders on old
 * TV browsers) — for this route only; the phone form deliberately does NOT get it.
 */
export function BoothView() {
  useWakeLock()
  return (
    <div className="kiosk flex h-screen w-screen overflow-hidden">
      <div className="min-w-0 flex-1">
        <SlideShow />
      </div>
      <QrPanel />
    </div>
  )
}
