/**
 * Step 2 of the wizard: all preparation options. Toggles cover folder creation,
 * menu/metadata/emulator downloads, 64DD IPL installation, ROM copy sources
 * (folders and archives) with per-type checkboxes, clean collection, stock
 * folders, cheats, saves, overwrite, verify, staging, and per-card format
 * options (FAT32/exFAT) which are configured on step 1.
 */
import { FolderPlus, Trash2, FolderOpen, FileArchive } from 'lucide-react'
import type { AppSettings, DdIplFileInfo, DdIplValidation, EmulatorsInfo, EmulatorKey, MenuReleaseInfo, MetadataReleaseInfo } from '../../../shared/types'
import { DD_IPL_SIZE } from '../../../shared/types'
import type { T } from '../i18n'
import { Badge, Button, Checkbox, Field } from './ui'
import { cn, EMULATOR_LABELS, ROM_TYPE_LABELS } from '../lib'

/**
 * Explains why a 64DD IPL file was rejected. Checks are ordered so the most
 * specific failure wins: wrong file size, byte-swapped data, missing header,
 * then a bad header id; a fully valid file returns its readable id.
 */
function ddiplReason(t: T, f: DdIplFileInfo): string {
  if (f.size !== DD_IPL_SIZE) return t('opt.ddiplReasonSize', { size: String(f.size ?? 0), expected: String(DD_IPL_SIZE) })
  if (f.byteOrder === 'swapped') return t('opt.ddiplReasonSwap')
  if (f.byteOrder === null) return t('opt.ddiplReasonHeader')
  if (!f.idOk) return t('opt.ddiplReasonId')
  return f.id
}

/**
 * Small chip-based readout of the 64DD IPL validation result: one badge per IPL
 * file (valid / invalid / missing) plus a summary and per-file rejection reasons.
 */
function DDIPLStatus({ t, validation }: { t: T; validation: DdIplValidation }): React.JSX.Element {
  const validCount = validation.files.filter((f) => f.valid).length
  const invalid = validation.files.filter((f) => f.present && !f.valid)
  const missing = validation.files.filter((f) => !f.present)

  let summary: string
  if (validCount === 0) {
    summary = t('opt.ddiplNone')
  } else if (missing.length === 0 && invalid.length === 0) {
    summary = t('opt.ddiplComplete')
  } else {
    summary = t('opt.ddiplPartial', { missing: [...invalid.map((f) => f.id), ...missing.map((f) => f.id)].join(', ') })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {validation.files.map((f) => (
          <span
            key={f.id}
            title={f.valid ? t('opt.ddiplValid') : f.present ? ddiplReason(t, f) : t('opt.ddiplMissing')}
            className={cn(
              'rounded-md px-2 py-1 font-mono text-[11px]',
              f.valid && 'border border-sc64-good/40 bg-sc64-good/10 text-sc64-good',
              f.present && !f.valid && 'border border-sc64-bad/40 bg-sc64-bad/10 text-sc64-bad',
              !f.present && 'border border-sc64-border bg-sc64-panel/50 text-sc64-muted'
            )}
          >
            {f.id}
          </span>
        ))}
      </div>
      <p className={cn('text-xs', validCount === 0 ? 'text-sc64-warn' : 'text-sc64-muted')}>{summary}</p>
      {invalid.length > 0 ? (
        <ul className="space-y-0.5">
          {invalid.map((f) => (
            <li key={f.id} className="text-xs text-sc64-bad">
              {f.id}: {ddiplReason(t, f)}
            </li>
          ))}
        </ul>
      ) : null}
      {validation.unrecognized.length > 0 ? (
        <p className="text-[11px] text-sc64-muted">{t('opt.ddiplExtra', { files: validation.unrecognized.join(', ') })}</p>
      ) : null}
    </div>
  )
}

/**
 * OptionsStep. Every control maps to a field on AppSettings, patched up through
 * onSettingsChange; App.tsx owns the electron dialogs behind onAddSources/
 * onRemoveSource/onAddArchives/onRemoveArchive/onChooseDDIPL and validates the
 * 64DD IPL folder via window.api.validateDDIPL.
 */
export function OptionsStep({
  t,
  settings,
  menu,
  metadata,
  emulators,
  ddiplValidation,
  onSettingsChange,
  onAddSources,
  onRemoveSource,
  onAddArchives,
  onRemoveArchive,
  onChooseDDIPL
}: {
  t: T
  settings: AppSettings
  menu: MenuReleaseInfo | null
  metadata: MetadataReleaseInfo | null
  emulators: EmulatorsInfo | null
  ddiplValidation: DdIplValidation | null
  onSettingsChange: (patch: Partial<AppSettings>) => void
  onAddSources: () => void
  onRemoveSource: (path: string) => void
  onAddArchives: () => void
  onRemoveArchive: (path: string) => void
  onChooseDDIPL: () => void
}): React.JSX.Element {
  // True when any option actually performs work; gates the "nothing selected"
  // warning. A previously prepared folder still counts as an action, so the
  // step can be skipped when the card only needs a prepared-folder copy.
  const hasAnyAction =
    settings.downloadMenu ||
    settings.downloadMetadata ||
    settings.createFolders ||
    settings.writeMenuConfig ||
    settings.downloadEmulators ||
    (settings.installDDIPL && settings.ddiplSource !== null) ||
    (settings.copyRoms && settings.romSources.length > 0 && (settings.copyAllTypes || Object.values(settings.romTypes).some(Boolean))) ||
    (settings.copyRoms && settings.archiveSources.length > 0)

  return (
    <div className="space-y-4">
      <Checkbox
        label={t('opt.folders')}
        hint={t('opt.foldersHint')}
        checked={settings.createFolders}
        onChange={(v) => onSettingsChange({ createFolders: v })}
      />

      <Checkbox
        label={
          <span className="flex items-center gap-2">
            {t('opt.menu')} <code className="font-mono text-[11px] text-sc64-accent">sc64menu.n64</code>
            {menu ? <Badge tone="accent">{menu.tag}</Badge> : null}
          </span>
        }
        hint={t('opt.menuHint')}
        checked={settings.downloadMenu}
        onChange={(v) => onSettingsChange({ downloadMenu: v })}
      />

      <Checkbox
        label={
          <span className="flex items-center gap-2">
            {t('opt.metadata')}
            {metadata ? <Badge tone="default">{metadata.tag}</Badge> : null}
          </span>
        }
        hint={t('opt.metadataHint')}
        checked={settings.downloadMetadata}
        onChange={(v) => onSettingsChange({ downloadMetadata: v })}
      />

      <Checkbox
        label={t('opt.emulators')}
        hint={t('opt.emulatorsHint')}
        checked={settings.downloadEmulators}
        onChange={(v) => onSettingsChange({ downloadEmulators: v })}
      />

      <Checkbox
        label={t('opt.menuConfig')}
        hint={t('opt.menuConfigHint')}
        checked={settings.writeMenuConfig}
        onChange={(v) => onSettingsChange({ writeMenuConfig: v })}
      />

      <div className={cn('space-y-2 pl-1 transition-opacity', !settings.downloadEmulators && 'pointer-events-none opacity-40')}>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(EMULATOR_LABELS) as EmulatorKey[]).map((key) => {
            const info = emulators?.list.find((e) => e.key === key)
            return (
              <label
                key={key}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors',
                  settings.emulators[key]
                    ? 'border-sc64-accent/50 bg-sc64-accent/10'
                    : 'border-sc64-border bg-sc64-panel/50 hover:border-sc64-borderlight'
                )}
              >
                <input
                  type="checkbox"
                  checked={settings.emulators[key]}
                  onChange={(e) => onSettingsChange({ emulators: { ...settings.emulators, [key]: e.target.checked } })}
                  className="h-4 w-4 cursor-pointer appearance-none rounded border border-sc64-borderlight bg-sc64-panel2 transition-all checked:border-sc64-accent checked:bg-sc64-accent"
                />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium">{EMULATOR_LABELS[key]}</span>
                  <span className="block truncate font-mono text-[11px] text-sc64-muted">
                    {info?.error ? t('opt.unavailable') : info?.version ? `${info.fileName} (${info.version})` : info?.fileName ?? key}
                  </span>
                </span>
                {info?.error ? <Badge tone="bad">{t('opt.offline')}</Badge> : null}
              </label>
            )
          })}
        </div>
      </div>

      <Checkbox
        label={t('opt.ddipl')}
        hint={t('opt.ddiplHint')}
        checked={settings.installDDIPL}
        onChange={(v) => onSettingsChange({ installDDIPL: v })}
      />

      <div className={cn('space-y-3 rounded-xl border border-sc64-border bg-sc64-panel2/40 p-4 transition-opacity', !settings.installDDIPL && 'pointer-events-none opacity-40')}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-sc64-muted">{t('opt.ddiplSource')}</span>
          <Button variant="outline" size="sm" onClick={onChooseDDIPL}>
            <FolderPlus className="h-3.5 w-3.5" /> {t('opt.ddiplChoose')}
          </Button>
        </div>

        {settings.ddiplSource ? (
          <div className="flex items-center gap-2 rounded-lg border border-sc64-border bg-sc64-panel px-3 py-2">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sc64-accent" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{settings.ddiplSource}</span>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-sc64-border px-3 py-4 text-center text-xs text-sc64-muted">
            {t('opt.ddiplNoFolder')}
          </p>
        )}

        {ddiplValidation ? <DDIPLStatus t={t} validation={ddiplValidation} /> : null}
      </div>

      <Checkbox
        label={
          <span className="flex items-center gap-2">
            {t('opt.roms')} <Badge tone="good">{t('opt.recommended')}</Badge>
          </span>
        }
        hint={t('opt.romsHint')}
        checked={settings.copyRoms}
        onChange={(v) => onSettingsChange({ copyRoms: v })}
      />

      <div className={cn('space-y-3 rounded-xl border border-sc64-border bg-sc64-panel2/40 p-4 transition-opacity', !settings.copyRoms && 'pointer-events-none opacity-40')}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-sc64-muted">{t('opt.romSources')}</span>
          <Button variant="outline" size="sm" onClick={onAddSources}>
            <FolderPlus className="h-3.5 w-3.5" /> {t('opt.addFolders')}
          </Button>
        </div>

        {settings.romSources.length === 0 ? (
          <p className="rounded-lg border border-dashed border-sc64-border px-3 py-4 text-center text-xs text-sc64-muted">
            {t('opt.noFolders')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {settings.romSources.map((src) => (
              <li key={src} className="group flex items-center gap-2 rounded-lg border border-sc64-border bg-sc64-panel px-3 py-2">
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sc64-accent" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{src}</span>
                <button
                  onClick={() => onRemoveSource(src)}
                  className="text-sc64-muted opacity-0 transition-opacity hover:text-sc64-bad group-hover:opacity-100"
                  title={t('opt.removeFolder')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 border-t border-sc64-border pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sc64-muted">{t('opt.archivesSources')}</span>
            <Button variant="outline" size="sm" onClick={onAddArchives}>
              <FolderPlus className="h-3.5 w-3.5" /> {t('opt.addArchives')}
            </Button>
          </div>
          <p className="mt-1 text-xs text-sc64-muted">{t('opt.archivesHint')}</p>

          {settings.archiveSources.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-sc64-border px-3 py-3 text-center text-xs text-sc64-muted">
              {t('opt.noArchives')}
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {settings.archiveSources.map((src) => (
                <li key={src} className="group flex items-center gap-2 rounded-lg border border-sc64-border bg-sc64-panel px-3 py-2">
                  <FileArchive className="h-3.5 w-3.5 shrink-0 text-sc64-accent" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{src}</span>
                  <button
                    onClick={() => onRemoveArchive(src)}
                    className="text-sc64-muted opacity-0 transition-opacity hover:text-sc64-bad group-hover:opacity-100"
                    title={t('opt.removeArchive')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <Checkbox
            label={t('opt.subdirs')}
            hint={t('opt.subdirsHint')}
            checked={settings.includeSubdirs}
            onChange={(v) => onSettingsChange({ includeSubdirs: v })}
            className="flex-1"
          />
          <Checkbox
            label={t('opt.createSaves')}
            hint={t('opt.createSavesHint')}
            checked={settings.createSaves}
            onChange={(v) => onSettingsChange({ createSaves: v })}
            className="flex-1"
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Checkbox
            label={t('opt.organize')}
            hint={t('opt.organizeHint')}
            checked={settings.organizeRoms}
            onChange={(v) => onSettingsChange({ organizeRoms: v })}
            className="flex-1"
          />
          <Checkbox
            label={t('opt.copyCheats')}
            hint={t('opt.copyCheatsHint')}
            checked={settings.copyCheats}
            onChange={(v) => onSettingsChange({ copyCheats: v })}
            className="flex-1"
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Checkbox
            label={t('opt.normalize')}
            hint={t('opt.normalizeHint')}
            checked={settings.normalizeN64}
            onChange={(v) => onSettingsChange({ normalizeN64: v })}
            className="flex-1"
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Checkbox
            label={t('opt.stockFolders')}
            hint={t('opt.stockFoldersHint')}
            checked={settings.stockFolders}
            onChange={(v) => onSettingsChange({ stockFolders: v })}
            className="flex-1"
          />
        </div>

        <Field label={t('opt.fileTypes')}>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {(Object.keys(ROM_TYPE_LABELS) as Array<keyof AppSettings['romTypes']>).map((key) => (
              <label
                key={key}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-xs transition-colors',
                  settings.romTypes[key]
                    ? 'border-sc64-accent/50 bg-sc64-accent/10'
                    : 'border-sc64-border bg-sc64-panel/50 hover:border-sc64-borderlight'
                )}
              >
                <input
                  type="checkbox"
                  checked={settings.romTypes[key]}
                  onChange={(e) => onSettingsChange({ romTypes: { ...settings.romTypes, [key]: e.target.checked } })}
                  className="h-3.5 w-3.5 cursor-pointer appearance-none rounded border border-sc64-borderlight bg-sc64-panel2 transition-all checked:border-sc64-accent checked:bg-sc64-accent"
                />
                {ROM_TYPE_LABELS[key]}
              </label>
            ))}
          </div>
        </Field>
      </div>

      <Checkbox
        label={t('opt.overwrite')}
        hint={t('opt.overwriteHint')}
        checked={settings.overwrite}
        onChange={(v) => onSettingsChange({ overwrite: v })}
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <Checkbox
          label={t('opt.stage')}
          hint={t('opt.stageHint')}
          checked={settings.stage}
          onChange={(v) => onSettingsChange({ stage: v })}
        />
        <Checkbox
          label={t('opt.verify')}
          hint={t('opt.verifyHint')}
          checked={settings.verify}
          onChange={(v) => onSettingsChange({ verify: v })}
        />
      </div>

      {!hasAnyAction && !settings.preparedSource ? (
        <p className="rounded-xl border border-sc64-warn/40 bg-sc64-warn/10 px-4 py-3 text-xs text-sc64-warn">
          {t('opt.nothingSelected')}
        </p>
      ) : null}
    </div>
  )
}
