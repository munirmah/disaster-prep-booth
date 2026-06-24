import { motion } from 'motion/react'
import type { SlideOfType } from '../../content/types'

export function ChecklistSlide({ slide }: { slide: SlideOfType<'checklist'> }) {
  return (
    <div className="flex h-full flex-col justify-center px-[6cqw] py-[6cqh]">
      {/* Heading group: accent bar → icon + title (generous space below). */}
      <div className="mb-[6cqh]">
        <div className="mb-[2.4cqh] h-[1cqh] w-[12cqh] rounded-full bg-emerald-400" />
        <h2 className="flex items-center gap-[2.5cqw] text-[8cqh] font-black leading-[1.05] tracking-tight text-white">
          {slide.icon && (
            <span aria-hidden className="text-[8.5cqh]">
              {slide.icon}
            </span>
          )}
          <span>{slide.title}</span>
        </h2>
      </div>

      <ul className="grid grid-cols-1 gap-x-[4cqw] gap-y-[3.4cqh] xl:grid-cols-2">
        {slide.items.map((item, i) => (
          <motion.li
            key={item}
            className="flex items-start gap-[1.8cqw] text-[4.5cqh] font-medium leading-[1.15] text-sky-50"
            initial={{ x: -40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.15 + i * 0.12, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="mt-[0.3cqh] flex h-[5cqh] w-[5cqh] flex-none items-center justify-center rounded-full bg-emerald-600 text-[2.8cqh] font-black text-white">
              ✓
            </span>
            <span>{item}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  )
}
