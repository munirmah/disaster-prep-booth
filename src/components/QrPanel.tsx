import { QRCodeSVG } from 'qrcode.react'
import { planUrl } from '../config'

/**
 * The booth's call-to-action: a big QR code phones scan to open the form.
 * Phones fetch the current settings/planner from the server (content store),
 * so the QR is just the plan URL.
 */
export function QrPanel() {
  const url = planUrl()
  return (
    <aside className="flex h-full w-[32vw] flex-col items-center justify-center gap-[5vh] bg-white/95 px-[3vw] py-[5vh] text-center">
      <p className="text-[3.4vh] font-black uppercase tracking-wide text-[var(--primary)]">
        Build Your Family’s Survival Plan
      </p>
      <div className="rounded-3xl bg-white p-[2vh] shadow-2xl [animation:qr-attention_3s_ease-in-out_infinite]">
        <QRCodeSVG
          value={url}
          // Sized in viewport units so it scales with the TV.
          className="h-[34vh] w-[34vh]"
          level="M"
          marginSize={2}
        />
      </div>
      <p className="text-[3.6vh] font-black uppercase tracking-wide leading-tight text-slate-800">
        ☝️ Take action
        <br />
        Scan this now
      </p>
    </aside>
  )
}
