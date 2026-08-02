import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import type { Locale, ThemeId } from '../../../shared/i18n'
import { LOCALES, THEME_IDS } from '../../../shared/i18n'
import type { T } from '../i18n'
import type { UpdateState } from './UpdateToast'
import { cn } from '../lib'
import appIcon from '../assets/app-icon.png'

interface MenuProps {
  label: string
  children: React.ReactNode
}

function Menu({ label, children }: MenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={ref} className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'rounded-md px-2.5 py-1 text-xs font-medium text-sc64-muted transition-colors',
          'hover:bg-sc64-panel hover:text-sc64-text',
          open && 'bg-sc64-panel text-sc64-accent'
        )}
      >
        {label}
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-48 overflow-hidden rounded-lg border border-sc64-border bg-sc64-panel p-1 shadow-2xl shadow-black/50">
          {children}
        </div>
      ) : null}
    </div>
  )
}

interface MenuItemProps {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}

function MenuItem({ active, onClick, children }: MenuItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-6 rounded-md px-2.5 py-1.5 text-left text-xs text-sc64-text transition-colors',
        'hover:bg-sc64-panel2',
        active && 'text-sc64-accent'
      )}
    >
      {children}
      {active ? <span className="text-sc64-accent">✓</span> : null}
    </button>
  )
}

interface TitleBarProps {
  t: T
  theme: ThemeId
  language: Locale
  maximized: boolean
  updateState: UpdateState['state'] | null
  onThemeChange: (theme: ThemeId) => void
  onLanguageChange: (locale: Locale) => void
  onCheckForUpdates: () => void
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

export function TitleBar(props: TitleBarProps): React.JSX.Element {
  const { t, theme, language, maximized, updateState } = props

  const updateActive =
    updateState === 'available' || updateState === 'downloading' || updateState === 'downloaded' || updateState === 'checking'

  return (
    <header
      className="flex h-10 shrink-0 select-none items-center gap-1 border-b border-sc64-border bg-sc64-panel2/70 pl-3 pr-1"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="mr-3 flex items-center gap-2">
        <img src={appIcon} alt={t('app.title')} className="h-5 w-5 rounded-md object-cover" />
        <span className="text-xs font-semibold tracking-wide text-sc64-text">{t('app.title')}</span>
      </div>

      <div className="flex items-center gap-0.5">
        <Menu label={t('menubar.theme')}>
          {THEME_IDS.map((id) => (
            <MenuItem key={id} active={theme === id} onClick={() => props.onThemeChange(id)}>
              {t(`theme.${id}`)}
            </MenuItem>
          ))}
        </Menu>
        <Menu label={t('menubar.language')}>
          {LOCALES.map((l) => (
            <MenuItem key={l} active={language === l} onClick={() => props.onLanguageChange(l)}>
              {t(`lang.${l}`)}
            </MenuItem>
          ))}
        </Menu>
        <button
          type="button"
          onClick={() => void window.api.openDocs()}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-sc64-muted transition-colors hover:bg-sc64-panel hover:text-sc64-text"
        >
          {t('menubar.docs')}
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          type="button"
          title={t('update.check')}
          onClick={props.onCheckForUpdates}
          className="relative mr-1 flex h-8 w-9 items-center justify-center rounded-md text-sc64-muted transition-colors hover:bg-sc64-panel hover:text-sc64-text"
        >
          <Download className="h-4 w-4" />
          {updateActive ? (
            <span
              className={cn(
                'absolute right-1.5 top-1.5 h-2 w-2 rounded-full',
                updateState === 'downloaded' ? 'bg-sc64-good' : 'bg-sc64-accent'
              )}
            />
          ) : null}
        </button>
        <button
          type="button"
          title={t('window.minimize')}
          onClick={props.onMinimize}
          className="flex h-8 w-11 items-center justify-center rounded-md text-sc64-muted transition-colors hover:bg-sc64-panel hover:text-sc64-text"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          title={maximized ? t('window.restore') : t('window.maximize')}
          onClick={props.onToggleMaximize}
          className="flex h-8 w-11 items-center justify-center rounded-md text-sc64-muted transition-colors hover:bg-sc64-panel hover:text-sc64-text"
        >
          {maximized ? (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
              <rect x="1" y="3" width="7" height="7" stroke="currentColor" />
              <path d="M3 3V1h7v7H8" stroke="currentColor" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
              <rect x="1" y="1" width="9" height="9" stroke="currentColor" />
            </svg>
          )}
        </button>
        <button
          type="button"
          title={t('window.close')}
          onClick={props.onClose}
          className="ml-1 flex h-8 w-11 items-center justify-center rounded-md text-sc64-muted transition-colors hover:bg-sc64-bad hover:text-white"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </header>
  )
}
