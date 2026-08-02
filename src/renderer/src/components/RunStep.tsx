import { useEffect, useRef } from 'react'
import { CheckCircle2, Play, Square, XCircle, ListChecks, Check, Copy } from 'lucide-react'
import type { AppSettings, StepState } from '../../../shared/types'
import type { T } from '../i18n'
import { Button, ProgressBar, Spinner } from './ui'
import { cn } from '../lib'

export interface LogEntry {
  id: number
  level: 'info' | 'success' | 'warn' | 'error'
  message: string
}

export function RunStep({
  t,
  settings,
  destination,
  preparedCount,
  running,
  progress,
  steps,
  log,
  result,
  onRun,
  onCancel,
  onGoBack
}: {
  t: T
  settings: AppSettings
  destination: string
  preparedCount: { files: number; bytes: number } | null
  running: 'prepare' | 'format' | null
  progress: { value: number; max: number; label?: string } | null
  steps: StepState[]
  log: LogEntry[]
  result: { kind: 'prepare' | 'format'; ok: boolean; message: string } | null
  onRun: () => void
  onCancel: () => void
  onGoBack: () => void
}): React.JSX.Element {
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  const mode = settings.preparedSource ? 'fromPrepared' : settings.stage ? 'staged' : 'direct'
  const emulatorCount = Object.values(settings.emulators).filter(Boolean).length

  const summary: Array<{ label: string; active: boolean }> = [
    { label: t('opt.folders'), active: settings.createFolders },
    { label: t('opt.menu'), active: settings.downloadMenu },
    { label: t('opt.metadata'), active: settings.downloadMetadata },
    { label: `${t('opt.emulators')} (${emulatorCount})`, active: settings.downloadEmulators },
    { label: t('opt.roms'), active: settings.copyRoms && settings.romSources.length > 0 }
  ].filter((s) => s.active)

  if (mode === 'fromPrepared' && preparedCount) {
    summary.unshift({ label: `${t('dest.preparedTitle')} (${preparedCount.files})`, active: true })
  }

  const runningNow = running !== null
  const canRun = (summary.length > 0 || mode === 'fromPrepared') && destination.trim().length > 0 && !runningNow

  const runningLabel =
    running === 'format' ? t('run.formatting') : mode === 'fromPrepared' ? t('run.copying') : t('run.preparing')

  const runLabel = mode === 'fromPrepared' ? t('dest.preparedCopy') : t('run.prepareButton')

  const note =
    mode === 'fromPrepared' ? t('run.fromPreparedNote') : mode === 'staged' ? t('run.stagedNote') : null

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-sc64-border bg-sc64-panel/70 p-5 backdrop-blur">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sc64-muted">{t('run.title')}</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {summary.map((s) => (
            <span
              key={s.label}
              className="inline-flex items-center gap-1.5 rounded-full border border-sc64-accent/30 bg-sc64-accent/10 px-3 py-1 text-xs text-sc64-accent"
            >
              <Check className="h-3 w-3" /> {s.label}
            </span>
          ))}
          {summary.length === 0 ? <span className="text-xs text-sc64-warn">{t('run.nothingSelected')}</span> : null}
        </div>
        {note ? (
          <p className="mb-3 rounded-xl border border-sc64-border bg-sc64-panel2/60 px-4 py-2.5 text-xs text-sc64-muted">
            {note}
          </p>
        ) : null}
        <div className="flex items-center justify-between rounded-xl border border-sc64-border bg-sc64-panel2/60 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('run.destination')}</div>
            <div className="truncate font-mono text-sm text-sc64-accent">{destination || '—'}</div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          {runningNow ? (
            <>
              <Button variant="danger" onClick={onCancel}>
                <Square className="h-4 w-4" /> {t('common.cancel')}
              </Button>
              <span className="flex items-center gap-2 text-xs text-sc64-muted">
                <Spinner /> {runningLabel}
              </span>
            </>
          ) : (
            <>
              <Button variant="primary" size="lg" onClick={onRun} disabled={!canRun} className="animate-glow">
                {mode === 'fromPrepared' ? <Copy className="h-4 w-4" /> : <Play className="h-4 w-4" />} {runLabel}
              </Button>
              <Button variant="ghost" onClick={onGoBack} disabled={runningNow}>
                ← {t('common.back')}
              </Button>
            </>
          )}
        </div>
      </div>

      {progress || steps.length > 0 ? (
        <div className="rounded-2xl border border-sc64-border bg-sc64-panel/70 p-5 backdrop-blur">
          <div className="mb-4">
            <ProgressBar
              value={progress?.value ?? 0}
              max={progress?.max ?? 0}
              label={progress?.label ?? t('run.working')}
              indeterminate={!progress || progress.max === 0}
            />
          </div>
          {steps.length > 0 ? (
            <ul className="space-y-1.5">
              {steps.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm">
                  {s.state === 'done' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-sc64-good" /> : null}
                  {s.state === 'running' ? <Spinner className="h-4 w-4 shrink-0" /> : null}
                  {s.state === 'error' ? <XCircle className="h-4 w-4 shrink-0 text-sc64-bad" /> : null}
                  {s.state === 'pending' ? <span className="h-4 w-4 shrink-0 rounded-full border border-sc64-borderlight" /> : null}
                  <span className={cn('truncate', s.state === 'error' && 'text-sc64-bad', s.state === 'pending' && 'text-sc64-muted')}>
                    {s.label}
                    {s.detail ? <span className="ml-2 text-xs text-sc64-muted">· {s.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div
          className={cn(
            'flex items-start gap-2.5 rounded-2xl border p-4 text-sm',
            result.ok ? 'border-sc64-good/40 bg-sc64-good/10 text-sc64-good' : 'border-sc64-bad/40 bg-sc64-bad/10 text-sc64-bad'
          )}
        >
          {result.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0" />}
          <span className="whitespace-pre-wrap">{result.message}</span>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-sc64-border bg-sc64-log">
        <div className="flex items-center gap-2 border-b border-sc64-border px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-sc64-muted">
          <ListChecks className="h-3.5 w-3.5" /> {t('run.log')}
        </div>
        <div ref={logRef} className="h-56 overflow-y-auto p-3 font-mono text-xs leading-relaxed">
          {log.length === 0 ? (
            <span className="text-sc64-muted/60">{t('run.logEmpty')}</span>
          ) : (
            log.map((l) => (
              <div
                key={l.id}
                className={cn(
                  'whitespace-pre-wrap break-words',
                  l.level === 'success' && 'text-sc64-good',
                  l.level === 'warn' && 'text-sc64-warn',
                  l.level === 'error' && 'text-sc64-bad',
                  l.level === 'info' && 'text-sc64-accent/90'
                )}
              >
                {l.message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
