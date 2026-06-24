import { motion } from 'motion/react'
import type { SlideOfType } from '../../content/types'

export function HazardSlide({ slide }: { slide: SlideOfType<'hazard'> }) {
  return (
    <div className="flex h-full flex-col justify-center px-[6cqw] py-[6cqh]">
      {/* Heading group: large icon anchor + eyebrow → headline. */}
      <div className="mb-[6cqh] flex items-center gap-[2.5cqw]">
        {slide.icon && (
          <span className="text-[12cqh] leading-none" aria-hidden>
            {slide.icon}
          </span>
        )}
        <div>
          <p className="mb-[0.8cqh] text-[3.2cqh] font-bold uppercase tracking-[0.15em] text-amber-300">
            {slide.hazard}
          </p>
          {slide.headline && (
            <h2 className="text-[7.5cqh] font-black leading-[1.05] tracking-tight text-white">
              {slide.headline}
            </h2>
          )}
        </div>
      </div>

      <ol className="flex flex-col gap-[3.2cqh]">
        {slide.steps.map((step, i) => (
          <motion.li
            key={step}
            className="flex items-start gap-[2cqw] text-[4.5cqh] font-medium leading-[1.15] text-sky-50"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 + i * 0.15, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="flex h-[6cqh] w-[6cqh] flex-none items-center justify-center rounded-xl bg-amber-400/20 text-[3.4cqh] font-black text-amber-200">
              {i + 1}
            </span>
            <span className="pt-[0.6cqh]">{step}</span>
          </motion.li>
        ))}
      </ol>
    </div>
  )
}
