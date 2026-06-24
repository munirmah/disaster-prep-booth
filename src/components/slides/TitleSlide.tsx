import { motion } from 'motion/react'
import type { SlideOfType } from '../../content/types'

export function TitleSlide({ slide }: { slide: SlideOfType<'title'> }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-[6cqw] text-center">
      <motion.h1
        className="max-w-[18ch] text-[13cqh] font-black leading-[1.02] tracking-tight text-white drop-shadow"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        {slide.title}
      </motion.h1>
      {slide.subtitle && (
        <motion.p
          className="mt-[5cqh] max-w-[28ch] text-[5cqh] font-medium leading-[1.2] text-sky-100"
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {slide.subtitle}
        </motion.p>
      )}
    </div>
  )
}
