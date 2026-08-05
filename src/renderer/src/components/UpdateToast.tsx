/**
 * Auto-update toast pinned to the bottom-right corner. Renders the updater's
 * state machine (checking, available, not-available, downloading, downloaded,
 * error) with matching icons, download progress and an install/later action
 * once a build is ready. State changes arrive through the parent, which feeds
 * it from window.api AppEvent update events.
 */
import { CheckCircle2, Download, X, XCircle } from 'lucide-react'
import type { T } from '../i18n'
import { Button, Spinner } from './ui'

/**
 * One snapshot of the auto-update flow. percent tracks download progress while
 * downloading; version and message carry detail for the available/error states.
 */
export type UpdateState = {
  state: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

/**
 * Update toast. Presentational: the parent supplies the current UpdateState and
 * the dismiss/install callbacks (wired to window.api.checkForUpdates and
 * window.api.installUpdate), keeping main-process calls out of this component.
 */
export function UpdateToast({
  t,
  update,
  onDismiss,
  onInstall
}: {
  t: T
  update: UpdateState
  onDismiss: () => void
  onInstall: () => void
}): React.JSX.Element {
  const { state } = update

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-2xl border border-sc64-border bg-sc64-panel p-4 shadow-2xl shadow-black/50 backdrop-blur">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 shrink-0">
          {/* Icon per state: spinner while busy, success/error glyphs for the
              terminal states, download glyph when a build is offered. */}
          {state === 'checking' || state === 'downloading' ? (
            <Spinner className="h-4 w-4" />
          ) : state === 'downloaded' || state === 'not-available' ? (
            <CheckCircle2 className="h-4 w-4 text-sc64-good" />
          ) : state === 'error' ? (
            <XCircle className="h-4 w-4 text-sc64-bad" />
          ) : (
            <Download className="h-4 w-4 text-sc64-accent" />
          )}
        </div>
        {/* Exactly one message line per state, interpolating percent/version/message. */}
        <div className="min-w-0 flex-1 text-xs leading-relaxed text-sc64-text">
          {state === 'checking' ? t('update.checking') : null}
          {state === 'available' ? t('update.available', { version: update.version ?? '' }) : null}
          {state === 'not-available' ? t('update.notAvailable') : null}
          {state === 'downloading' ? t('update.downloading', { percent: update.percent ?? 0 }) : null}
          {state === 'downloaded' ? t('update.downloaded') : null}
          {state === 'error' ? t('update.error', { message: update.message ?? '' }) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md p-0.5 text-sc64-muted transition-colors hover:bg-sc64-panel2 hover:text-sc64-text"
          title={t('common.clear')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {state === 'downloading' ? (
        // Progress bar: width mirrors the percentage emitted by the downloader;
        // the width transition makes each progress event animate smoothly.
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-sc64-panel2">
          <div
            className="h-full rounded-full bg-sc64-accent transition-[width] duration-300"
            style={{ width: `${update.percent ?? 0}%` }}
          />
        </div>
      ) : null}

      {state === 'downloaded' ? (
        // Install is only offered once the download finished; "later" dismisses
        // without installing so the user can keep working.
        <div className="mt-3 flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={onInstall}>
            {t('update.install')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            {t('update.later')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
