import { brand } from '../content/brand'

/**
 * Persistent header bar shown across all booth slides. The official HF logo is
 * a blue-on-transparent lockup, so on the dark booth gradient we sit it on a
 * white "chip" to keep it legible. The slide's current `kicker` rides on the
 * right as the chapter label.
 */
export function Branding({ kicker }: { kicker?: string }) {
  return (
    <header className="flex items-center justify-between px-[4vw] py-[3vh]">
      <div className="flex items-center gap-[1.5vw]">
        <span className="rounded-2xl bg-white px-[1.6vw] py-[1.4vh] shadow-lg">
          <img src={brand.logoSrc} alt={brand.orgName} className="h-[6vh] w-auto" />
        </span>
        <span className="text-[2.4vh] font-bold uppercase tracking-widest text-sky-100">
          {brand.tagline}
        </span>
      </div>
      {kicker && (
        <span className="rounded-full bg-white/15 px-[2vw] py-[1.4vh] text-[2.6vh] font-bold text-white">
          {kicker}
        </span>
      )}
    </header>
  )
}
