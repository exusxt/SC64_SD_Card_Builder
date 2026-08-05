/**
 * Step 1 of the wizard: pick the destination card (removable drive) or folder,
 * optionally reformat it (FAT32/exFAT, guarded by a typed mount-point confirm),
 * and inspect an existing card for its menu version, ROM counts and free space.
 * Settings are read from props and patched up via onSettingsChange.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, FolderOpen, HardDrive, RefreshCw, ShieldAlert, Eye, XCircle, X, PackageOpen, Database } from 'lucide-react'
import type { AppSettings, CardInspection, DriveInfo, Filesystem, FormatResult } from '../../../shared/types'
import type { T } from '../i18n'
import { Button, Checkbox, Field, Input, ProgressBar, Select } from './ui'
import { cn, formatBytes } from '../lib'

/**
 * DestinationStep. The wizard body is driven by App.tsx: drives and inspection
 * come from window.api listDrives/inspectCard, and formatting is delegated up
 * via onFormat/onCancelFormat with progress and result fed back in as props.
 */
export function DestinationStep({
  t,
  settings,
  drives,
  drivesLoading,
  destination,
  preparedCount,
  inspection,
  inspectionLoading,
  latestMenuTag,
  onSettingsChange,
  onRefreshDrives,
  onChoosePreparedFolder,
  formatBusy,
  formatProgress,
  formatResult,
  onFormat,
  onCancelFormat,
  onReveal
}: {
  t: T
  settings: AppSettings
  drives: DriveInfo[]
  drivesLoading: boolean
  destination: string
  preparedCount: { files: number; bytes: number } | null
  inspection: CardInspection | null
  inspectionLoading: boolean
  latestMenuTag: string | null
  onSettingsChange: (patch: Partial<AppSettings>) => void
  onRefreshDrives: () => void
  onChoosePreparedFolder: () => void
  formatBusy: boolean
  formatProgress: { value: number; max: number; label?: string } | null
  formatResult: FormatResult | null
  onFormat: () => void
  onCancelFormat: () => void
  onReveal: () => void
}): React.JSX.Element {
  const [showFormat, setShowFormat] = useState(false)
  // Destructive-format guard: the user must retype the card's mount point before onFormat is enabled.
  const [formatConfirm, setFormatConfirm] = useState('')
  // Local draft of the folder path; only committed to settings when the user confirms, so a
  // half-typed path never silently replaces the saved destination.
  const [folderDraft, setFolderDraft] = useState(settings.folder ?? '')

  useEffect(() => {
    setFolderDraft(settings.folder ?? '')
  }, [settings.folder])
  // Only removable drives are offered; internal/system drives are never eligible to be written or formatted.
  const removableDrives = drives.filter((d) => d.removable)
  const selected = drives.find((d) => d.id === settings.driveId) ?? null
  const hasDest = destination.trim().length > 0
  const fs = (selected?.filesystem ?? '').trim().toUpperCase()
  const isFat32 = fs === 'FAT32'
  const isExfatCard = fs === 'EXFAT'
  // Warn once free space drops below half a gigabyte; a prepare run can easily exceed that.
  const almostFull = selected?.free !== null && selected?.free !== undefined && selected.free < 512 * 1024 * 1024
  // Normalize both sides (strip trailing slashes, lower-case) so a trailing backslash doesn't
  // defeat the mount-point retype check and Windows drive letters compare case-insensitively.
  const mountpointKey = (selected?.mountpoint ?? '').trim().replace(/[\\/]+$/, '').toLowerCase()
  const formatConfirmKey = formatConfirm.trim().replace(/[\\/]+$/, '').toLowerCase()
  const formatConfirmValid = mountpointKey.length > 0 && formatConfirmKey === mountpointKey
  const folderDraftPending = folderDraft !== (settings.folder ?? '')
  const formatFs: Filesystem = settings.formatOptions.filesystem
  const isExfat = formatFs === 'exfat'

  // Inspection flow: collapse the raw card scan into a single status line. A menu file
  // present without a parseable version is corrupt; "Preview release" is a pre-release build.
  const menuStatus: { label: string; kind: 'none' | 'preview' | 'version' } = (() => {
    const m = inspection?.menu
    if (!m?.present) return { label: t('inspect.menuNone'), kind: 'none' }
    if (!m.version) return { label: t('inspect.menuCorrupt'), kind: 'none' }
    if (m.version === 'Preview release') return { label: t('inspect.menuPreview'), kind: 'preview' }
    return { label: m.version, kind: 'version' }
  })()

  // Compare the installed menu against the latest GitHub release tag, ignoring a
  // leading "v" so "v2.3" and "2.3" are treated as the same version.
  let menuUpdate: 'none' | 'up-to-date' | 'update' = 'none'
  if (menuStatus.kind !== 'none' && latestMenuTag) {
    const installed = menuStatus.label.replace(/^[vV]/, '')
    const latest = latestMenuTag.replace(/^[vV]/, '')
    menuUpdate = installed === latest ? 'up-to-date' : 'update'
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-sc64-border bg-sc64-panel/70 p-5 backdrop-blur">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-sc64-muted">{t('dest.title')}</h2>
          <div className="flex items-center gap-2">
            {/* Wizard transition within step 1: switching destination mode swaps the whole
                body between the removable-drive picker and a plain folder path input. */}
            <div className="flex rounded-lg border border-sc64-borderlight bg-sc64-panel2 p-0.5">
              <button
                onClick={() => onSettingsChange({ destinationMode: 'drive' })}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  settings.destinationMode === 'drive' ? 'bg-sc64-accent/20 text-sc64-accent' : 'text-sc64-muted hover:text-sc64-text'
                )}
              >
                <HardDrive className="h-3.5 w-3.5" /> {t('dest.modeDrive')}
              </button>
              <button
                onClick={() => onSettingsChange({ destinationMode: 'folder' })}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  settings.destinationMode === 'folder' ? 'bg-sc64-accent2/20 text-sc64-accent2' : 'text-sc64-muted hover:text-sc64-text'
                )}
              >
                <FolderOpen className="h-3.5 w-3.5" /> {t('dest.modeFolder')}
              </button>
            </div>
          </div>
        </div>

        {settings.destinationMode === 'drive' ? (
          <div className="space-y-3">
            <div className="flex items-end gap-3">
              <Field label={t('dest.driveField')} hint={t('dest.driveHint')} className="flex-1">
                <div className="flex gap-2">
                  <Select
                    value={settings.driveId ?? ''}
                    onChange={(e) => {
                      onSettingsChange({ driveId: e.target.value || null })
                      // Clearing the retype guard when the card changes prevents a confirmation
                      // typed for one volume from being applied to a different one.
                      setFormatConfirm('')
                    }}
                    className="flex-1"
                  >
                    <option value="">{t('dest.selectCard')}</option>
                    {removableDrives.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.volumeLabel || d.name} · {d.mountpoint} · {formatBytes(d.size)}
                      </option>
                    ))}
                    {removableDrives.length === 0 ? <option disabled>{t('dest.noRemovable')}</option> : null}
                  </Select>
                  <Button variant="outline" size="md" onClick={onRefreshDrives} disabled={drivesLoading} title={t('dest.refreshTitle')}>
                    <RefreshCw className={cn('h-4 w-4', drivesLoading && 'animate-spin')} />
                  </Button>
                </div>
              </Field>
            </div>

            {selected ? (
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-sc64-border bg-sc64-panel2/60 p-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('dest.volume')}</div>
                  <div className="font-medium">{selected.volumeLabel || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('dest.filesystem')}</div>
                  <div className="font-medium">{selected.filesystem || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('dest.capacity')}</div>
                  <div className="font-medium">{formatBytes(selected.size)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('dest.free')}</div>
                  <div className="font-medium">{formatBytes(selected.free)}</div>
                </div>
              </div>
            ) : null}

            {selected && fs ? (
              isFat32 || isExfatCard ? (
                <div className="flex items-start gap-2 rounded-xl border border-sc64-good/40 bg-sc64-good/10 px-4 py-3 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sc64-good" />
                  <div>
                    <div className="font-medium text-sc64-good">{isFat32 ? t('dest.fat32Ok') : t('dest.exfatOk')}</div>
                    <div className="text-xs text-sc64-good/80">{isFat32 ? t('dest.fat32OkHint') : t('dest.exfatOkHint')}</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-xl border border-sc64-warn/40 bg-sc64-warn/10 px-4 py-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sc64-warn" />
                  <div>
                    <div className="font-medium text-sc64-warn">{t('dest.notFat32')}</div>
                    <div className="text-xs text-sc64-warn/80">{t('dest.notFat32Hint')}</div>
                  </div>
                </div>
              )
            ) : null}

            {almostFull ? (
              <div className="flex items-start gap-2 rounded-xl border border-sc64-warn/40 bg-sc64-warn/10 px-4 py-3 text-sm text-sc64-warn">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('dest.freeWarning', { free: formatBytes(selected.free) })}</span>
              </div>
            ) : null}

            <button
              onClick={() => setShowFormat((v) => !v)}
              className="flex w-full items-center justify-between rounded-xl border border-sc64-border px-4 py-3 text-left text-sm transition-colors hover:border-sc64-borderlight"
            >
              <span className="flex items-center gap-2 font-medium text-sc64-text">
                {!selected ? (
                  <HardDrive className="h-4 w-4 text-sc64-muted" />
                ) : isFat32 || isExfatCard ? (
                  <CheckCircle2 className="h-4 w-4 text-sc64-good" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-sc64-warn" />
                )}
                {isExfat ? t('dest.formatTitleExfat') : t('dest.formatTitle')}
                <span className="text-[11px] font-normal text-sc64-muted">{isExfat ? t('dest.formatHintExfat') : t('dest.formatHint')}</span>
              </span>
              <span className="text-sc64-muted">{showFormat ? '▲' : '▼'}</span>
            </button>

            {showFormat ? (
              <div className="rounded-xl border border-sc64-warn/30 bg-sc64-warn/5 p-4">
                {formatBusy ? (
                  <div className="space-y-3">
                    <ProgressBar value={formatProgress?.value ?? 0} max={formatProgress?.max ?? 0} label={formatProgress?.label ?? t('dest.formatting')} indeterminate={!formatProgress || formatProgress.max === 0} />
                    <Button variant="danger" size="sm" onClick={onCancelFormat}>
                      {t('dest.cancelFormat')}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 text-xs text-sc64-warn">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {isExfat
                          ? t('dest.formatWarningExfat', { dest: selected?.mountpoint ?? t('dest.notSelected') })
                          : t('dest.formatWarning', { dest: selected?.mountpoint ?? t('dest.notSelected') })}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label={t('dest.volumeLabel')} hint={t('dest.volumeLabelHint')} className="w-44">
                        <Input
                          value={settings.volumeLabel}
                          maxLength={isExfat ? 15 : 11}
                          onChange={(e) => onSettingsChange({ volumeLabel: e.target.value })}
                          placeholder="SUMMERCART"
                        />
                      </Field>
                      <Field label={t('dest.filesystem')} hint={t('dest.filesystemHint')} className="w-48">
                        <Select
                          value={formatFs}
                          onChange={(e) =>
                            onSettingsChange({ formatOptions: { ...settings.formatOptions, filesystem: e.target.value as Filesystem } })
                          }
                        >
                          <option value="fat32">FAT32 — {t('dest.fat32Recommended')}</option>
                          <option value="exfat">exFAT</option>
                        </Select>
                      </Field>
                      <Checkbox
                        label={t('dest.fullFormat')}
                        hint={t('dest.fullFormatHint')}
                        checked={settings.formatOptions.fullFormat}
                        onChange={(v) => onSettingsChange({ formatOptions: { ...settings.formatOptions, fullFormat: v } })}
                        className="flex-1"
                      />
                    </div>
                    <div>
                      <Field label={t('dest.formatConfirmLabel', { dest: selected?.mountpoint ?? t('dest.notSelected') })} className="w-full">
                        <Input
                          value={formatConfirm}
                          onChange={(e) => setFormatConfirm(e.target.value)}
                          placeholder={t('dest.formatConfirmPlaceholder', { dest: selected?.mountpoint ?? '' })}
                          className="w-full"
                        />
                      </Field>
                      {formatConfirm.trim().length > 0 && !formatConfirmValid ? (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-sc64-bad">
                          <XCircle className="h-3.5 w-3.5 shrink-0" />
                          {t('dest.formatConfirmMismatch')}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      variant="danger"
                      onClick={onFormat}
                      disabled={!formatConfirmValid || drivesLoading}
                      title={selected ? (isExfat ? t('dest.formatButtonTitleExfat') : t('dest.formatButtonTitle')) : t('dest.formatButtonTitleNone')}
                    >
                      {isExfat
                        ? t('dest.formatButtonExfat', { dest: selected?.mountpoint ?? '' })
                        : t('dest.formatButton', { dest: selected?.mountpoint ?? '' })}
                    </Button>
                  </div>
                )}

                {formatResult ? (
                  <div
                    className={cn(
                      'mt-3 flex items-start gap-2 rounded-lg border p-3 text-xs',
                      formatResult.ok ? 'border-sc64-good/40 bg-sc64-good/10 text-sc64-good' : 'border-sc64-bad/40 bg-sc64-bad/10 text-sc64-bad'
                    )}
                  >
                    {formatResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                    <span>{formatResult.message}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <Field label={t('dest.folderField')} hint={t('dest.folderHint')}>
              <div className="flex gap-2">
                <Input
                  value={folderDraft}
                  onChange={(e) => setFolderDraft(e.target.value)}
                  placeholder={t('dest.folderPlaceholder')}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  onClick={async () => {
                    const dir = await window.api.chooseFolder()
                    if (dir) {
                      setFolderDraft(dir)
                      onSettingsChange({ folder: dir })
                    }
                  }}
                >
                  <FolderOpen className="h-4 w-4" /> {t('common.browse')}
                </Button>
              </div>
            </Field>
            {folderDraftPending ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sc64-warn/40 bg-sc64-warn/10 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-sc64-warn">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {t('dest.confirmTitle')}
                  </div>
                  <div className="mt-0.5 text-xs text-sc64-warn/80">
                    {t('dest.confirmMessage', { path: folderDraft.trim() || t('dest.notSelected') })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={folderDraft.trim().length === 0}
                    onClick={() => {
                      onSettingsChange({ folder: folderDraft.trim() })
                      setFolderDraft(folderDraft.trim())
                    }}
                  >
                    {t('dest.confirmApply')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setFolderDraft(settings.folder ?? '')}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : null}
            {settings.folder ? (
              <p className="flex items-center gap-1.5 text-xs text-sc64-muted">
                <CheckCircle2 className="h-3.5 w-3.5 text-sc64-good" />
                {t('dest.folderSelected', { path: settings.folder })}
              </p>
            ) : null}
          </div>
        )}

        <div className="mt-4 rounded-xl border border-sc64-border bg-sc64-panel2/60 p-4">
          <div className="mb-2 flex items-center gap-2">
            <PackageOpen className="h-4 w-4 text-sc64-accent2" />
            <div>
              <div className="text-sm font-semibold text-sc64-text">{t('dest.preparedTitle')}</div>
              <div className="text-xs text-sc64-muted">{t('dest.preparedHint')}</div>
            </div>
          </div>
          {settings.preparedSource ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-lg border border-sc64-borderlight bg-sc64-panel px-3 py-2 font-mono text-xs text-sc64-accent">
                  {settings.preparedSource}
                </span>
                <Button variant="ghost" size="sm" onClick={() => onSettingsChange({ preparedSource: null })}>
                  <X className="h-3.5 w-3.5" /> {t('common.clear')}
                </Button>
              </div>
              {preparedCount ? (
                <p className="flex items-center gap-1.5 text-xs text-sc64-good">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t('dest.preparedReady', { count: String(preparedCount.files) })}{' '}
                  <span className="text-sc64-muted">({formatBytes(preparedCount.bytes)})</span>
                </p>
              ) : null}
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={onChoosePreparedFolder}>
              <FolderOpen className="h-3.5 w-3.5" /> {t('dest.preparedChoose')}
            </Button>
          )}
        </div>

        {hasDest ? (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-sc64-border bg-sc64-panel2/60 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('dest.willWriteTo')}</div>
              <div className="truncate font-mono text-sm text-sc64-accent">{destination}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={onReveal}>
              <Eye className="h-3.5 w-3.5" /> {t('common.show')}
            </Button>
          </div>
        ) : null}

        {hasDest ? (
          <div className="mt-4 rounded-xl border border-sc64-border bg-sc64-panel2/60 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Database className="h-4 w-4 text-sc64-accent" />
              <div className="text-sm font-semibold text-sc64-text">{t('inspect.title')}</div>
            </div>
            {inspectionLoading ? (
              <p className="text-xs text-sc64-muted">{t('inspect.loading')}</p>
            ) : inspection ? (
              inspection.files > 0 ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-sc64-border bg-sc64-panel/60 p-3 text-sm sm:grid-cols-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('inspect.menu')}</div>
                      <div className="font-medium">{menuStatus.label}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('inspect.roms')}</div>
                      <div className="font-medium">{inspection.roms.n64}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('inspect.gb')}</div>
                      <div className="font-medium">{inspection.roms.gb}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('inspect.gbc')}</div>
                      <div className="font-medium">{inspection.roms.gbc}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('inspect.snes')}</div>
                      <div className="font-medium">{inspection.roms.snes}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('inspect.sms')}</div>
                      <div className="font-medium">{inspection.roms.sms}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('inspect.gg')}</div>
                      <div className="font-medium">{inspection.roms.gg}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('inspect.other')}</div>
                      <div className="font-medium">{inspection.roms.other}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('inspect.saves')}</div>
                      <div className="font-medium">{inspection.saves}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('inspect.files')}</div>
                      <div className="font-medium">{inspection.files}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-sc64-muted">{t('inspect.free')}</div>
                      <div className="font-medium">{formatBytes(inspection.freeBytes)}</div>
                    </div>
                  </div>
                  {menuStatus.kind === 'none' ? (
                    <p className="flex items-start gap-1.5 text-xs text-sc64-warn">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{t('inspect.menuNoneHint')}</span>
                    </p>
                  ) : menuUpdate === 'update' ? (
                    <p className="flex items-start gap-1.5 text-xs text-sc64-warn">
                      <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{t('inspect.updateAvailable', { current: menuStatus.label, latest: latestMenuTag ?? '' })}</span>
                    </p>
                  ) : menuUpdate === 'up-to-date' ? (
                    <p className="flex items-start gap-1.5 text-xs text-sc64-good">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{t('inspect.upToDate', { version: menuStatus.label })}</span>
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="flex items-start gap-1.5 text-xs text-sc64-muted">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sc64-good" />
                  <span>{t('inspect.empty')}</span>
                </p>
              )
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-sc64-border bg-sc64-panel/40 px-4 py-3 text-xs text-sc64-muted">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-sc64-warn" />
        <span>{t('dest.tip')}</span>
      </div>
    </div>
  )
}
