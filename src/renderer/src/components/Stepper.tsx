/**
 * Horizontal 3-step indicator (Destination -> Options -> Run) that doubles as
 * navigation. Highlights the active step, stamps completed steps with a check
 * mark and lets the user jump back to an earlier step unless locked.
 */
import { cn } from '../lib'
import { Check } from 'lucide-react'
import type { T } from '../i18n'

/**
 * Wizard step strip. step is the 1-based index of the active step; onNavigate
 * lets the user revisit an earlier step, while locked disables navigation
 * (e.g. while a run is in progress).
 */
export function Stepper({
  t,
  step,
  onNavigate,
  locked
}: {
  t: T
  step: number
  onNavigate: (s: number) => void
  locked: boolean
}): React.JSX.Element {
  // The three wizard phases, in fixed order; each renders as a clickable card.
  const steps = [
    { n: 1, title: t('step.destination'), desc: t('step.destinationDesc') },
    { n: 2, title: t('step.options'), desc: t('step.optionsDesc') },
    { n: 3, title: t('step.run'), desc: t('step.runDesc') }
  ]
  return (
    <nav className="mb-6 flex items-center gap-2">
      {steps.map((s, i) => {
        const active = step === s.n
        // A step is "done" when the wizard has moved past it, earning a check mark.
        const done = step > s.n
        return (
          <div key={s.n} className="flex flex-1 items-center gap-2">
            <button
              onClick={() => !locked && onNavigate(s.n)}
              disabled={locked}
              className={cn(
                'group flex flex-1 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-150',
                active
                  ? 'border-sc64-accent/60 bg-sc64-panel shadow-glow'
                  : done
                    ? 'border-sc64-good/40 bg-sc64-panel/70 hover:border-sc64-good/60'
                    : 'border-sc64-border bg-sc64-panel/40 hover:border-sc64-borderlight',
                locked && 'cursor-not-allowed opacity-60'
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold transition-colors',
                  active
                    ? 'border-sc64-accent bg-sc64-accent/20 text-sc64-accent'
                    : done
                      ? 'border-sc64-good bg-sc64-good/20 text-sc64-good'
                      : 'border-sc64-borderlight bg-sc64-panel2 text-sc64-muted'
                )}
              >
                {done ? <Check className="h-4 w-4" /> : s.n}
              </span>
              <span className="min-w-0">
                <span className={cn('block text-sm font-semibold', active ? 'text-sc64-text' : done ? 'text-sc64-good' : 'text-sc64-text')}>
                  {s.title}
                </span>
                <span className="block truncate text-[11px] text-sc64-muted">{s.desc}</span>
              </span>
            </button>
            {/* Connector between adjacent steps, colored once the preceding step is done. */}
            {i < steps.length - 1 ? <span className={cn('h-px w-4 shrink-0', done ? 'bg-sc64-good/50' : 'bg-sc64-borderlight')} /> : null}
          </div>
        )
      })}
    </nav>
  )
}
