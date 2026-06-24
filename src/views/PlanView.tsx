import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { brand } from '../content/brand'
import { useContent } from '../content/store'
import { generatePlan } from '../planner/engine'
import type { Responses } from '../planner/types'
import { track } from '../track'
import { clearSession, loadSession, saveSession } from '../visitor'
import { useEmailEnabled, useEmailExtras } from '../app-config'
import { deckTips } from '../planner/email'
import { FamilyForm } from '../components/plan/FamilyForm'
import { PlanResult } from '../components/plan/PlanResult'

/**
 * The phone surface (route "/", the app root), opened by scanning the booth QR.
 *
 * Two-step local flow: collect the responses, then show the generated plan.
 * The visitor's progress (responses + "Have it" marks) is persisted to their
 * phone so a refresh/lock doesn't lose it; "Start over" clears it.
 */
export function PlanView() {
  // Planner + settings come from the shared content document.
  const { content } = useContent()
  const { planner, settings, slides } = content

  const emailEnabled = useEmailEnabled()
  const { nextSteps, resources } = useEmailExtras()
  // The email body carries booth-deck takeaways (derived from the live slides)
  // plus the operator's editable next-steps + links — additive to the PDF.
  const emailExtras = useMemo(
    () => ({ tips: deckTips(slides), nextSteps, resources }),
    [slides, nextSteps, resources],
  )

  // Restore any in-progress visitor session once on mount.
  const restored = useMemo(loadSession, [])
  const [responses, setResponses] = useState<Responses | null>(restored.responses)
  const [have, setHave] = useState<Set<string>>(restored.have)
  // Prep window: the booth's configured value is the default; the visitor can
  // override it live on the plan screen. A restored choice wins.
  const [days, setDays] = useState<number>(restored.days ?? settings.prepDays)

  // Persist progress whenever it changes (only once we have responses).
  useEffect(() => {
    if (responses) saveSession(responses, have, days)
  }, [responses, have, days])

  // Reach: the QR brought a phone to the planner. Once per mount.
  useEffect(() => {
    track('plan_open')
  }, [])

  const plan = useMemo(
    () =>
      responses
        ? generatePlan(responses, { days, hazards: settings.hazards }, planner)
        : null,
    [responses, days, settings.hazards, planner],
  )

  const setStatus = (id: string, owned: boolean) =>
    setHave((prev) => {
      const next = new Set(prev)
      if (owned) next.add(id)
      else next.delete(id)
      return next
    })

  const handleSubmit = (r: Responses) => {
    setResponses(r)
    setHave(new Set()) // a fresh submission starts with everything "to buy"

    // Engagement: a plan was generated. Send only anonymous household counts —
    // never anything identifying — for the "people covered" report line.
    const peopleKeys = planner.aggregates?.people ?? ['adults', 'children', 'infants']
    const n = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : 0)
    track('plan_generated', {
      people: peopleKeys.reduce((sum, k) => sum + n(k), 0),
      children: n('children'),
      infants: n('infants'),
      pets: n('pets'),
      medical: r['medicalNeeds'] === true,
      hazards: settings.hazards,
      days,
    })
  }

  const handleRestart = () => {
    clearSession()
    setResponses(null)
    setHave(new Set())
    setDays(settings.prepDays) // back to the booth default for the next visitor
  }

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      <header className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="mx-auto flex w-full max-w-md items-center gap-3 sm:max-w-3xl lg:max-w-5xl">
          {/* Logo art already includes the org name + "Serving Mankind". */}
          <img src={brand.logoSrc} alt={brand.orgName} className="h-9 w-auto" />
          <span className="border-l border-slate-200 pl-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
            {brand.tagline}
          </span>
        </div>
      </header>

      <main className="@container px-5 py-8">
        {/* Crossfade between the two steps so the list doesn't snap in. */}
        <AnimatePresence mode="wait">
          <motion.div
            key={plan ? 'plan' : 'form'}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            {plan ? (
              <PlanResult
                plan={plan}
                have={have}
                onSetStatus={setStatus}
                onRestart={handleRestart}
                days={days}
                onSetDays={setDays}
                emailEnabled={emailEnabled}
                emailExtras={emailExtras}
                planMode={settings.planMode}
              />
            ) : (
              <FamilyForm planner={planner} onSubmit={handleSubmit} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
