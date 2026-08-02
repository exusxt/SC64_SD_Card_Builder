import { ShieldAlert, ShieldCheck } from 'lucide-react'
import type { MenuReleaseInfo, MetadataReleaseInfo } from '../../../shared/types'
import type { T } from '../i18n'
import { Badge } from './ui'

export function Header({
  t,
  menu,
  metadata,
  isAdmin
}: {
  t: T
  menu: MenuReleaseInfo | null
  metadata: MetadataReleaseInfo | null
  isAdmin: boolean
}): React.JSX.Element {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-sc64-accent/40 bg-gradient-to-br from-sc64-accent/20 to-sc64-accent2/20 text-sc64-accent shadow-glow">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 4h12l4 6-9 10L4 10l2-6z" />
            <path d="M4 10h16" />
            <path d="M12 20L8.5 10" />
            <path d="M12 20l3.5-10" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-bold leading-tight text-sc64-text">{t('app.title')}</h1>
          <p className="text-xs text-sc64-muted">{t('app.tagline')}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {menu ? <Badge tone="accent">{t('header.menu', { tag: menu.tag })}</Badge> : null}
        {metadata ? <Badge tone="default">{t('header.art', { tag: metadata.tag })}</Badge> : null}
        <Badge tone={isAdmin ? 'good' : 'warn'}>
          {isAdmin ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
          {isAdmin ? t('header.admin') : t('header.notAdmin')}
        </Badge>
      </div>
    </header>
  )
}
