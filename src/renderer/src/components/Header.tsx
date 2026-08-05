/**
 * In-window header/banner at the top of the wizard body (below the frameless
 * title bar). Shows the app identity, badges for the loaded menu and artwork
 * release tags, a launcher for the menu preview and the admin status or
 * elevation-request control.
 */
import { MonitorPlay, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { MenuReleaseInfo, MetadataReleaseInfo } from '../../../shared/types'
import type { T } from '../i18n'
import { Badge, Button, Spinner } from './ui'
import { cn } from '../lib'
import appIcon from '../assets/app-icon.png'

/**
 * Wizard banner. Pure presentation: release info, admin state and callbacks
 * all arrive as props, so this stays unaware of how they were obtained.
 */
export function Header({
  t,
  menu,
  metadata,
  isAdmin,
  onRequestAdmin,
  adminRequesting,
  onPreview,
  canPreview
}: {
  t: T
  menu: MenuReleaseInfo | null
  metadata: MetadataReleaseInfo | null
  isAdmin: boolean
  onRequestAdmin: () => void
  adminRequesting: boolean
  onPreview: () => void
  canPreview: boolean
}): React.JSX.Element {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-sc64-accent/40 shadow-glow">
          <img src={appIcon} alt={t('app.title')} className="h-full w-full object-cover" />
        </div>
        <div>
          <h1 className="text-lg font-bold leading-tight text-sc64-text">{t('app.title')}</h1>
          <p className="text-xs text-sc64-muted">{t('app.tagline')}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {menu ? <Badge tone="accent">{t('header.menu', { tag: menu.tag })}</Badge> : null}
        {metadata ? <Badge tone="default">{t('header.art', { tag: metadata.tag })}</Badge> : null}
        {/* Preview needs a menu release to browse, so it stays disabled until one loads. */}
        <Button variant="outline" size="sm" onClick={onPreview} disabled={!canPreview} title={t('preview.open')}>
          <MonitorPlay className="h-3.5 w-3.5" />
          {t('preview.open')}
        </Button>
        {/* Admin: a passive green badge. Otherwise a warning-colored pill that
            requests elevation; it shows a spinner and disables itself while a
            relaunch is in flight to guard against double-click. */}
        {isAdmin ? (
          <Badge tone="good">
            <ShieldCheck className="h-3 w-3" />
            {t('header.admin')}
          </Badge>
        ) : (
          <button
            type="button"
            onClick={onRequestAdmin}
            disabled={adminRequesting}
            title={t('header.notAdmin')}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1 rounded-full border border-sc64-warn/40 bg-sc64-warn/10 px-2.5 py-0.5 text-[11px] font-medium text-sc64-warn',
              'transition-all duration-150 hover:bg-sc64-warn/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-sc64-warn/60',
              'disabled:cursor-not-allowed disabled:opacity-60'
            )}
          >
            {adminRequesting ? <Spinner className="h-3 w-3 text-sc64-warn" /> : <ShieldAlert className="h-3 w-3" />}
            {t('header.notAdmin')}
          </button>
        )}
      </div>
    </header>
  )
}
