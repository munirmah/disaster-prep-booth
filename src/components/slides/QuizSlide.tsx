import { useEffect, useState } from 'react'
import type { SlideOfType } from '../../content/types'

// Confident ease-out for the reveal (not a default curve, no bounce).
const EASE = 'cubic-bezier(0.22,1,0.36,1)'

/**
 * Passive quiz: shows the question + options, then auto-reveals the correct
 * answer after `slide.revealAfterMs`. The reveal timer resets whenever the
 * slide changes (the component remounts per slide via its key in SlideShow).
 *
 * The explanation stays mounted and opens via a grid-rows height transition
 * (+ fade) so it eases in instead of popping into layout and jumping the
 * vertically-centered block.
 */
export function QuizSlide({ slide }: { slide: SlideOfType<'quiz'> }) {
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), slide.revealAfterMs)
    return () => clearTimeout(t)
  }, [slide.revealAfterMs])

  return (
    <div className="flex h-full flex-col justify-center px-[6cqw] py-[6cqh]">
      <div className="mb-[5cqh]">
        <div className="mb-[2.4cqh] h-[1cqh] w-[12cqh] rounded-full bg-[var(--primary)]" />
        <h2 className="max-w-[24ch] text-[7cqh] font-black leading-[1.08] tracking-tight text-white">
          {slide.question}
        </h2>
      </div>
      <ul className="grid grid-cols-2 gap-[3cqh]">
        {slide.options.map((option, i) => {
          const isAnswer = i === slide.answerIndex
          const highlight = revealed && isAnswer
          const dimmed = revealed && !isAnswer
          return (
            <li
              key={option}
              style={{ transitionTimingFunction: EASE }}
              className={[
                'flex items-center gap-[2cqw] rounded-2xl px-[3cqw] py-[3cqh] text-[4.2cqh] font-semibold leading-[1.1]',
                'transition-[transform,background-color,box-shadow,opacity] duration-500 will-change-transform',
                highlight
                  ? 'scale-[1.03] bg-emerald-600 text-white shadow-2xl'
                  : 'bg-white/10 text-sky-50',
                dimmed ? 'opacity-60' : 'opacity-100',
              ].join(' ')}
            >
              <span className="flex h-[6cqh] w-[6cqh] flex-none items-center justify-center rounded-full bg-white/20 text-[3.4cqh] font-black">
                {highlight ? '✓' : String.fromCharCode(65 + i)}
              </span>
              <span>{option}</span>
            </li>
          )
        })}
      </ul>

      {slide.explanation && (
        <div
          style={{ transitionTimingFunction: EASE }}
          className={`grid transition-[grid-template-rows] duration-[600ms] ${
            revealed ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <p
              className={`pt-[4cqh] text-[3.8cqh] font-medium leading-[1.2] text-sky-100 transition-opacity duration-500 ${
                revealed ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {slide.explanation}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
