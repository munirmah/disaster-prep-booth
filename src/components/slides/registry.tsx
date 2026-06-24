import type { Slide } from '../../content/types'
import { TitleSlide } from './TitleSlide'
import { ChecklistSlide } from './ChecklistSlide'
import { HazardSlide } from './HazardSlide'
import { QuizSlide } from './QuizSlide'

/**
 * Single dispatch point from slide DATA to slide COMPONENT.
 *
 * When you add a new slide variant in content/types.ts, add its case here.
 * The exhaustiveness check below will fail to compile until you do.
 */
export function renderSlide(slide: Slide) {
  switch (slide.type) {
    case 'title':
      return <TitleSlide slide={slide} />
    case 'checklist':
      return <ChecklistSlide slide={slide} />
    case 'hazard':
      return <HazardSlide slide={slide} />
    case 'quiz':
      return <QuizSlide slide={slide} />
    default:
      return assertNever(slide)
  }
}

function assertNever(x: never): never {
  throw new Error(`Unhandled slide variant: ${JSON.stringify(x)}`)
}
