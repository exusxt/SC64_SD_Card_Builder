// The prepare pipeline: downloads the menu, metadata, and emulators, installs
// the 64DD IPL, copies and validates ROMs, creates save folders and .cht
// cheats, then writes an HTML/CSV report. Runs entirely in the main process so
// downloads and large copies never block the renderer; every stage streams
// step/progress/log events through PrepareCallbacks.emit.

import { mkdtemp, copyFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname, sep } from 'node:path'
import { tmpdir } from 'node:os'
import type { AppEvent, Locale, PrepareMode, PrepareOptions, PrepareResult, StepId, StepState, EmulatorKey } from '../shared/types'
import { translate } from '../shared/i18n'
import { downloadFile } from './download'
import { ensureDir } from './fspaths'
import { getMenuRelease, getMetadataRelease, latestReleaseAssets, GB64_TEMPLATE_URL } from './releases'
import { extractZip, findEntriesInZip, extractEntryTo, copyDirContents, rmTree, listDirDeep, extractArchive } from './unzip'
import { verifyFile } from './verify'
import { pathContains } from './pathguard'
import { organizeBase, uniqueBase, emuOrganizeBase, chtNameOf } from './organize'
import { inspectN64File, isN64Ext, romIdentity, N64_REGION_LABELS, N64Header, N64Issue, N64Region } from './n64validate'
import { validateEmuFile, emuIdentity, isGBExt, isSNESExt, isSMSExt, EmuHeaderInfo, EmuIssue, EmuKind } from './emuheader'
import { normalizeN64ToFile, verifyNormalized } from './normalize'
import { installDDIPL } from './ddipl'
import { writeReport, type ReportCounts, type ReportLog, type ReportRow } from './report'

/**
 * Callbacks the runner uses to reach the outside world: `emit` pushes
 * AppEvents (step/progress/log/done/error) to the renderer, `cancel` is the
 * shared flag toggled by the prepare:cancel channel, and `version` is the app
 * version stamped into the generated report.
 */
export interface PrepareCallbacks {
  emit: (ev: AppEvent) => void
  cancel?: { cancelled: boolean }
  version?: string
}

/** ROM file extensions accepted per type; the enabled romTypes map onto these. */
const EXTENSIONS: Record<string, string[]> = {
  n64: ['.n64', '.z64', '.v64'],
  nes: ['.nes'],
  snes: ['.smc', '.sfc', '.fig'],
  gb: ['.gb', '.gbc'],
  sms: ['.sms', '.gg'],
  chf: ['.chf'],
  ndd: ['.ndd', '.d64']
}

/**
 * The ordered pipeline steps shown as the stepper in the UI. 'format' is the
 * exception: it is owned by the separate format:run flow and is never executed
 * here, so it stays 'pending' (or is marked skipped in fromPrepared mode).
 */
const STEP_IDS: StepId[] = ['folders', 'menu', 'metadata', 'emulators', 'ddipl', 'roms', 'format', 'verify', 'copy']

// Human-readable names for the per-console emulator summary log.
const EMU_KIND_LABELS: Record<EmuKind, string> = {
  gb: 'Game Boy',
  gbc: 'Game Boy Color',
  snes: 'SNES',
  sms: 'Sega Master System',
  gg: 'Sega Game Gear'
}

function baseNameOf(p: string): string {
  return p.split(/[/\\]/).pop() ?? p
}

// extOf lowercases so .Z64 matches .z64 on case-insensitive and
// case-sensitive filesystems alike.
function extOf(p: string): string {
  return p.slice(p.lastIndexOf('.')).toLowerCase()
}

// Mirrors the stock card's layout: GB/GBC games live under GBC/, SNES games
// under snes_rom/ and SMS/GG games under smsPlus64/, each with a saves/
// folder per game. Returns null for systems without a stock folder (N64, NES,
// 64DD), which stay in the card root - exactly what the menu expects.
function stockFolderOf(p: string): string | null {
  const ext = extOf(p)
  if (ext === '.gb' || ext === '.gbc') return 'GBC'
  if (ext === '.smc' || ext === '.sfc' || ext === '.fig') return 'snes_rom'
  if (ext === '.sms' || ext === '.gg') return 'smsPlus64'
  return null
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function listFilesDirect(source: string): string[] {
  try {
    return readdirSync(source).map((n) => join(source, n)).filter((p) => isDir(p) === false)
  } catch {
    return []
  }
}

function fileSize(p: string): number {
  try {
    return statSync(p).size
  } catch {
    return 0
  }
}

// A .cht cheat file next to the ROM, matched case-insensitively because cheats
// dumped from some setups are named with different casing than the ROM.
function findCht(romPath: string): string | null {
  const last = romPath.lastIndexOf('.')
  const stem = last >= 0 ? romPath.slice(0, last) : romPath
  const exact = `${stem}.cht`
  if (existsSync(exact)) return exact
  try {
    const dir = dirname(romPath)
    const want = baseNameOf(exact).toLowerCase()
    const entry = readdirSync(dir).find((n) => n.toLowerCase() === want)
    return entry ? join(dir, entry) : null
  } catch {
    return null
  }
}

/**
 * Stateful executor for a single prepare run. Accumulates per-step states,
 * report rows/logs/counts, and a locale for localizing every message it
 * emits, then feeds progress to the renderer through the callbacks.
 */
class Runner {
  private steps: Record<StepId, StepState>
  private readonly locale: Locale
  // The options of the run currently executing; set by prepare() before any
  // step runs so step helpers (e.g. the menu config.ini writer) can read the
  // run's overwrite/createSaves flags without parameter plumbing.
  opts: PrepareOptions | null = null
  lastCopyCount = 0
  readonly logs: ReportLog[] = []
  readonly rows: ReportRow[] = []
  readonly counts: ReportCounts = {
    romsCopied: 0, duplicates: 0, verified: 0, verifyFailures: 0,
    cheatsCopied: 0, savesCreated: 0, archivesExtracted: 0,
    emulatorsInstalled: 0, ddiplInstalled: 0, normalized: 0, menuTag: '', metadataTag: ''
  }
  readonly startedAt: string = new Date().toISOString()

  constructor(private cb: PrepareCallbacks, locale: Locale) {
    this.locale = locale
    this.steps = {} as Record<StepId, StepState>
    // Every step starts 'pending' so the stepper shows the full pipeline even
    // before a step has run; steps that never run stay pending (e.g. format).
    for (const id of STEP_IDS) {
      this.steps[id] = { id, label: this.t(`stepLabel.${id}`), state: 'pending' }
    }
  }

  /** Localized message helper bound to this run's locale. */
  t(key: Parameters<typeof translate>[1], vars?: Record<string, string | number>): string {
    return translate(this.locale, key, vars)
  }

  /** Marks a step running/done/error and pushes the change to the renderer. */
  step(id: StepId, state: StepState['state'], detail?: string): void {
    const s = this.steps[id]
    s.state = state
    if (detail !== undefined) s.detail = detail
    this.cb.emit({ type: 'step', step: { ...s } })
  }

  /** Ends a step 'done' with a "skipped" detail so the stepper stays green when a feature is disabled. */
  markSkipped(id: StepId): void {
    this.step(id, 'done', this.t('log.skipped'))
  }

  /** Appends a line to the report log and streams the same line to the UI. */
  log(level: 'info' | 'success' | 'warn' | 'error', message: string): void {
    this.logs.push({ level, message })
    this.cb.emit({ type: 'log', level, message })
  }

  /** Forwards byte/file progress to the renderer. */
  progress(value: number, max: number, label?: string): void {
    this.cb.emit({ type: 'progress', value, max, label })
  }

  /** Downloads a file with progress; `max` is the byte count when the server reports one. */
  async download(url: string, dest: string, label: string): Promise<void> {
    await downloadFile(url, dest, { onProgress: (p) => this.progress(p.received, p.total || 0, label) })
  }

  /** Throws when the user requested a cancel; polled between files so cancellation lands quickly. */
  checkCancel(): void {
    if (this.cb.cancel?.cancelled) throw new Error(this.t('log.cancelled'))
  }

  /** Localizes an N64 validation issue using the parsed header for its details. */
  n64IssueMessage(issue: N64Issue, header: N64Header, rel: string): string {
    switch (issue.code) {
      case 'ext-mismatch':
        return this.t('n64.extMismatch', { file: rel, actual: header.byteOrder, ext: extOf(rel).slice(1) })
      case 'bad-size':
        return this.t('n64.badSize', { file: rel, size: Math.round(header.size / (1024 * 1024)) })
      case 'not-n64':
        return this.t('n64.notN64', { file: rel })
    }
  }

  /** Localizes an emulator (GB/SNES/SMS/GG) validation issue. */
  emuIssueMessage(issue: EmuIssue, rel: string): string {
    switch (issue.code) {
      case 'not-gb':
        return this.t('emu.notGB', { file: rel })
      case 'not-snes':
        return this.t('emu.notSNES', { file: rel })
      case 'not-sms':
        return this.t('emu.notSMS', { file: rel })
      case 'byte-swapped':
        return this.t('emu.byteSwapped', { file: rel })
      case 'ext-mismatch':
        return issue.detail === 'headered'
          ? this.t('emu.extMismatchHeadered', { file: rel, ext: extOf(rel).slice(1) })
          : this.t('emu.extMismatchUnheadered', { file: rel, ext: extOf(rel).slice(1) })
      case 'bad-dump':
        return this.t('emu.badDump', { file: rel })
    }
  }

  /**
   * Creates the menu folder tree (menu/, menu/metadata/, menu/64ddipl/,
   * menu/emulators/) and, when stockFolders is set, the per-console game
   * folders GBC/, snes_rom/ and smsPlus64/. When the run is configured to
   * write a menu config.ini, that is pre-created here too so the menu boots
   * with the chosen saves-folder layout even on a card it has never seen.
   */
  async createFolders(destination: string, enabled: boolean, stockFolders = false): Promise<void> {
    const menuConfig = this.opts?.writeMenuConfig === true
    if (!enabled && !menuConfig) {
      this.markSkipped('folders')
      return
    }
    this.step('folders', 'running')
    if (enabled) {
      const dirs = ['menu', join('menu', 'metadata'), join('menu', '64ddipl'), join('menu', 'emulators')]
      if (stockFolders) dirs.push('GBC', 'snes_rom', 'smsPlus64')
      for (const d of dirs) await ensureDir(join(destination, d))
      this.log('info', this.t('log.createdFolders'))
    }
    if (menuConfig) await this.writeMenuConfigFile(destination)
    this.step('folders', 'done')
  }

  /**
   * Pre-writes menu/config.ini (the N64FlashcartMenu settings file) when it
   * does not exist yet. The values mirror exactly what the menu would write on
   * first boot (settings.c defaults), except use_saves_folder follows the
   * run's createSaves option so the config always matches the card layout the
   * app just produced.
   */
  private async writeMenuConfigFile(destination: string): Promise<void> {
    const configPath = join(destination, 'menu', 'config.ini')
    if (existsSync(configPath) && !this.opts?.overwrite) {
      this.log('warn', this.t('log.menuConfigExists'))
      return
    }
    await ensureDir(join(destination, 'menu'))
    const useSaves = this.opts?.createSaves ? 'true' : 'false'
    const body = [
      '[menu]',
      'schema_revision=1',
      'first_run=true',
      'pal60=false',
      'force_progressive_scan=false',
      'show_protected_entries=false',
      'default_directory=/',
      `use_saves_folder=${useSaves}`,
      'show_saves_folder=false',
      'show_save_files=false',
      'show_cheat_files=false',
      'show_rom_configuration_files=false',
      'soundfx_enabled=false',
      'bgm_enabled=false',
      'reboot_rom_enabled=false',
      ''
    ].join('\n')
    await writeFile(configPath, body, 'utf8')
    this.log('success', this.t('log.menuConfigWritten', { useSaves }))
  }

  /**
   * Downloads the latest sc64menu.n64 release into the card root. A card that
   * already has a menu keeps it unless the user asked to overwrite.
   */
  async downloadMenu(destination: string, enabled: boolean, overwrite: boolean): Promise<void> {
    if (!enabled) {
      this.markSkipped('menu')
      return
    }
    this.step('menu', 'running')
    const target = join(destination, 'sc64menu.n64')
    if (existsSync(target) && !overwrite) {
      this.log('warn', this.t('log.menuExists'))
      this.step('menu', 'done', this.t('log.alreadyPresent'))
      return
    }
    const rel = await getMenuRelease()
    if (!rel.downloadUrl) {
      this.log('error', this.t('log.menuNotFound'))
      this.step('menu', 'error')
      return
    }
    this.log('info', this.t('log.menuDownloading', { tag: rel.tag }))
    await this.download(rel.downloadUrl, target, 'sc64menu.n64')
    this.counts.menuTag = rel.tag
    this.log('success', this.t('log.menuDownloaded', { tag: rel.tag }))
    this.step('menu', 'done')
  }

  /**
   * Downloads the boxart & metadata release into a temp dir, extracts it, and
   * merges its contents into menu/metadata/. The temp dir is always removed.
   */
  async downloadMetadata(destination: string, enabled: boolean): Promise<void> {
    if (!enabled) {
      this.markSkipped('metadata')
      return
    }
    this.step('metadata', 'running')
    const work = await mkdtemp(join(tmpdir(), 'sc64-meta-'))
    try {
      const rel = await getMetadataRelease()
      if (!rel.downloadUrl) {
        this.log('error', this.t('log.metaNotFound'))
        this.step('metadata', 'error')
        return
      }
      this.log('info', this.t('log.metaDownloading', { tag: rel.tag }))
      const zipPath = join(work, 'release-metadata.zip')
      await this.download(rel.downloadUrl, zipPath, 'boxart & metadata pack')
      this.log('info', this.t('log.metaExtracting'))
      const extractDir = join(work, 'extracted')
      const onProgress = (done: number, total: number): void => {
        this.checkCancel()
        this.progress(done, total, this.t('log.metaExtracting'))
      }
      await extractZip(zipPath, extractDir, onProgress)
      const source = this.findMetadataSource(extractDir)
      const target = join(destination, 'menu', 'metadata')
      await ensureDir(target)
      const count = await copyDirContents(source, target, true, onProgress)
      this.counts.metadataTag = rel.tag
      this.log('success', this.t('log.metaExtracted', { count: String(count) }))
      this.step('metadata', 'done')
    } finally {
      await rmTree(work)
    }
  }

  // Metadata zips have shipped with several internal layouts; probe the known
  // ones before falling back to the extracted root.
  private findMetadataSource(extractDir: string): string {
    const candidates = [join(extractDir, 'metadata'), join(extractDir, 'menu', 'metadata'), join(extractDir, 'menu')]
    for (const c of candidates) if (isDir(c)) return c
    return extractDir
  }

  /**
   * Downloads the selected emulators into menu/emulators/. Each emulator is
   * isolated in its own try/catch so a failed release never aborts the step;
   * the step still ends 'done' with a partial-failure detail.
   */
  async downloadEmulators(destination: string, enabled: boolean, emulators: Record<EmulatorKey, boolean>): Promise<void> {
    if (!enabled) {
      this.markSkipped('emulators')
      return
    }
    this.step('emulators', 'running')
    const emuDir = join(destination, 'menu', 'emulators')
    await ensureDir(emuDir)
    let anyError = false

    // Wraps one emulator install: logs the label, swallows the failure into
    // anyError, and keeps the other emulators running.
    const guard = async (label: string, fn: () => Promise<void>): Promise<void> => {
      this.checkCancel()
      this.log('info', `  ${label}`)
      try {
        await fn()
      } catch (e: any) {
        anyError = true
        this.log('error', this.t('log.emulatorError', { label, message: e?.message ?? String(e) }))
      }
    }

    if (emulators.nes) {
      await guard('NES (Neon64)...', async () => {
        const assets = await latestReleaseAssets('hcs64/neon64v2')
        const zip = assets.find((a) => a.name.toLowerCase().endsWith('.zip'))
        if (!zip) throw new Error('No Neon64 zip asset found')
        // Dot-prefixed temp files keep the download invisible to the menu's
        // file browser and are deleted as soon as the needed ROM is pulled out.
        const zipPath = join(emuDir, '.neon64.zip')
        await this.download(zip.browser_download_url, zipPath, 'Neon64')
        // The release bundles several ROM variants; prefer the 'bu' build,
        // else fall back to the first match.
        const entries = await findEntriesInZip(zipPath, (n) => /\.rom$/i.test(n) || /neon64/i.test(n))
        const chosen = entries.find((n) => /bu/i.test(n)) ?? entries[0]
        if (!chosen) throw new Error('No Neon64 ROM found in zip')
        await extractEntryTo(zipPath, chosen, join(emuDir, 'neon64bu.rom'))
        await rm(zipPath, { force: true })
        this.counts.emulatorsInstalled++
        this.log('success', `    ${this.t('log.installed', { name: 'neon64bu.rom' })}`)
      })
    }

    if (emulators.snes) {
      await guard('SNES (Sodium64)...', async () => {
        const assets = await latestReleaseAssets('Hydr8gon/sodium64')
        const zip = assets.find((a) => a.name.toLowerCase().endsWith('.zip'))
        if (!zip) throw new Error('No Sodium64 zip asset found')
        const zipPath = join(emuDir, '.sodium64.zip')
        await this.download(zip.browser_download_url, zipPath, 'Sodium64')
        // Same pattern as Neon64: pull just the intended N64 ROM out of the
        // release zip, then drop the zip.
        const entries = await findEntriesInZip(zipPath, (n) => /\.(z64|v64|n64)$/i.test(n))
        const chosen = entries.find((n) => /sodium64/i.test(n)) ?? entries[0]
        if (!chosen) throw new Error('No Sodium64 ROM found in zip')
        await extractEntryTo(zipPath, chosen, join(emuDir, 'sodium64.z64'))
        await rm(zipPath, { force: true })
        this.counts.emulatorsInstalled++
        this.log('success', `    ${this.t('log.installed', { name: 'sodium64.z64' })}`)
      })
    }

    if (emulators.gb) {
      await guard('Game Boy / Color (GB64)...', async () => {
        const target = join(emuDir, 'gb.v64')
        // GB64 serves both Game Boy and Game Boy Color, so the single download
        // is copied to both names and only counted once.
        await this.download(GB64_TEMPLATE_URL, target, 'GB64')
        await copyFile(target, join(emuDir, 'gbc.v64'))
        this.counts.emulatorsInstalled++
        this.log('success', `    ${this.t('log.installed', { name: 'gb.v64 + gbc.v64' })}`)
      })
    }

    if (emulators.sms) {
      await guard('SMS / GG (SMSPlus64)...', async () => {
        const assets = await latestReleaseAssets('fhoedemakers/smsplus64')
        const asset = assets.find((a) => /^smsPlus64\.z64$/i.test(a.name))
        if (!asset) throw new Error('No smsPlus64.z64 asset found')
        await this.download(asset.browser_download_url, join(emuDir, 'smsPlus64.z64'), 'SMSPlus64')
        this.counts.emulatorsInstalled++
        this.log('success', `    ${this.t('log.installed', { name: 'smsPlus64.z64' })}`)
      })
    }

    if (emulators.chf) {
      await guard('Channel F (Press-F Ultra)...', async () => {
        const assets = await latestReleaseAssets('celerizer/Press-F-Ultra')
        const asset = assets.find((a) => /^Press-F\.z64$/i.test(a.name))
        if (!asset) throw new Error('No Press-F.z64 asset found')
        await this.download(asset.browser_download_url, join(emuDir, 'Press-F.z64'), 'Press-F')
        this.counts.emulatorsInstalled++
        this.log('success', `    ${this.t('log.installed', { name: 'Press-F.z64' })}`)
      })
    }

    this.checkCancel()
    this.step('emulators', 'done', anyError ? this.t('log.someFailed') : undefined)
  }

  /**
   * Installs validated 64DD IPL dumps into menu/64ddipl. A missing source is
   * tolerated (warn + skip) so a run without IPL dumps still completes.
   */
  async installDDIPLStep(destination: string, enabled: boolean, source: string | null): Promise<void> {
    if (!enabled) {
      this.markSkipped('ddipl')
      return
    }
    this.step('ddipl', 'running')
    if (!source) {
      this.log('warn', this.t('log.ddiplNoSource'))
      this.step('ddipl', 'done')
      return
    }
    const dest = join(destination, 'menu', '64ddipl')
    const res = await installDDIPL(source, dest)
    if (res.installed.length > 0) {
      this.counts.ddiplInstalled = res.installed.length
      this.log('success', this.t('log.ddiplInstalled', { count: String(res.installed.length), names: res.installed.join(', ') }))
    }
    for (const id of res.invalid) {
      this.log('warn', this.t('log.ddiplInvalid', { name: id }))
    }
    if (res.missing.length > 0) {
      this.log('warn', this.t('log.ddiplMissing', { missing: res.missing.join(', ') }))
    }
    this.step('ddipl', 'done')
  }

  /**
   * The core copying step: extracts archives into the destination, walks every
   * ROM source, validates N64 and emulator headers, dedupes by identity, and
   * copies matching files (organizing, byte-swap normalizing and creating
   * saves/cheats as configured). Optionally verifies each copy. Returns how
   * many ROMs and save folders were produced.
   */
  async copyRoms(options: PrepareOptions): Promise<{ roms: number; saves: number }> {
    const archiveList = (options.archiveSources ?? []).filter((a) => existsSync(a))
    const hasArchiveSources = options.copyRoms && archiveList.length > 0
    if (!options.copyRoms || (options.romSources.length === 0 && !hasArchiveSources)) {
      this.markSkipped('roms')
      this.markSkipped('verify')
      return { roms: 0, saves: 0 }
    }
    this.step('roms', 'running')
    const extSet = new Set(options.romTypes.flatMap((t) => EXTENSIONS[t] ?? []))
    if (extSet.size === 0 && !hasArchiveSources) {
      this.step('roms', 'done', this.t('log.noTypes'))
      this.markSkipped('verify')
      return { roms: 0, saves: 0 }
    }
    const destRoot = options.destination
    let roms = 0
    let verified = 0
    let mismatches = 0
    let firstMismatch = ''
    const saveDirs = new Set<string>()
    const destNorm = destRoot.replace(/\//g, sep).toLowerCase()
    const label = this.t('log.copyingRoms')

    // Duplicate-detection map shared by N64 and emulator ROMs; see the key
    // construction below for what each identity contains.
    const seen = new Map<string, string>()
    let n64Count = 0
    let warningCount = 0
    let duplicateCount = 0
    let normalizedCount = 0
    const regionCounts: Partial<Record<N64Region, number>> = {}
    const emuCounts: Partial<Record<EmuKind, number>> = {}
    const usedBases = new Set<string>()
    let cheatsCopied = 0

    if (options.verify) this.step('verify', 'running')
    else this.markSkipped('verify')

    // Archives are extracted straight into the destination so their internal
    // folder layout is preserved as-is.
    for (const archive of archiveList) {
      this.checkCancel()
      const name = baseNameOf(archive)
      this.log('info', this.t('log.archiveExtracting', { name }))
      const count = await extractArchive(archive, destRoot)
      if (count > 0) {
        this.counts.archivesExtracted++
        this.log('success', this.t('log.archiveExtracted', { name, count: String(count) }))
      } else {
        this.log('warn', this.t('log.archiveEmpty', { name }))
      }
    }

    for (const source of options.romSources) {
      this.checkCancel()
      if (!existsSync(source)) continue
      const files = options.includeSubdirs ? listDirDeep(source) : listFilesDirect(source)
      const matches: string[] = []
      for (const file of files) {
        // Never copy a source that lives inside the destination - the walk
        // would read back what we write and loop into itself.
        if (isInsideDest(file, destNorm)) continue
        if (extSet.has(extOf(file))) matches.push(file)
      }
      for (const file of matches) {
        this.checkCancel()
        const rel = options.includeSubdirs ? file.slice(source.length).replace(/^[/\\]/, '') : baseNameOf(file)
        let target = join(destRoot, rel)
        if (options.stockFolders) {
          // Retarget the file into its stock folder (GBC/, snes_rom/,
          // smsPlus64/) unless the source path already targets it.
          const folder = stockFolderOf(file)
          if (folder) {
            const firstSeg = rel.split(/[/\\]/)[0]?.toLowerCase()
            if (firstSeg !== folder.toLowerCase()) {
              target = join(destRoot, folder, rel)
            }
          }
        }
        // Respect overwrite: existing files are skipped unless overwriting.
        if (existsSync(target) && !options.overwrite) continue

        let n64Header: N64Header | null = null
        if (isN64Ext(file)) {
          const v = await inspectN64File(file)
          if (v.header) {
            n64Header = v.header
            // Duplicate detection: N64 ROMs are keyed by romIdentity (game
            // code + header CRCs, lowercase), so the same game is caught even
            // when its filename or byte order differs. The map value is the
            // first occurrence's relative path, used to say where the
            // duplicate was already seen.
            const id = romIdentity(v.header)
            const first = seen.get(id)
            if (first) {
              duplicateCount++
              this.rows.push({ status: 'duplicate', source: rel, target: '', size: fileSize(file), game: v.header.title, region: N64_REGION_LABELS[v.header.region], note: this.t('n64.duplicate', { first, file: rel }) })
              this.log('warn', this.t('n64.duplicate', { first, file: rel }))
              continue
            }
            seen.set(id, rel)
            n64Count++
            regionCounts[v.header.region] = (regionCounts[v.header.region] ?? 0) + 1
            for (const issue of v.issues) {
              warningCount++
              this.log('warn', this.n64IssueMessage(issue, v.header, rel))
            }
          } else {
            warningCount++
            this.log('warn', this.t('n64.notN64', { file: rel }))
          }
        }

        let emuHeader: EmuHeaderInfo | null = null
        if (isGBExt(file) || isSNESExt(file) || isSMSExt(file)) {
          const v = validateEmuFile(file)
          if (v.header) {
            emuHeader = v.header
            // Emulator ROMs are keyed by emuIdentity + size (kind + title or
            // product code + checksum), sharing the same `seen` map as N64.
            const id = emuIdentity(v.header, fileSize(file))
            const first = seen.get(id)
            if (first) {
              duplicateCount++
              this.rows.push({ status: 'duplicate', source: rel, target: '', size: fileSize(file), game: v.header.title, region: v.header.region ?? '', note: this.t('n64.duplicate', { first, file: rel }) })
              this.log('warn', this.t('n64.duplicate', { first, file: rel }))
              continue
            }
            seen.set(id, rel)
            emuCounts[v.header.kind] = (emuCounts[v.header.kind] ?? 0) + 1
            for (const issue of v.issues) {
              warningCount++
              this.log('warn', this.emuIssueMessage(issue, rel))
            }
          } else {
            warningCount++
            for (const issue of v.issues) {
              this.log('warn', this.emuIssueMessage(issue, rel))
            }
          }
        }

        // Byte-swap normalization: a parsed N64 header that is not already
        // big-endian (and the option on) means the copy converts the dump to
        // canonical .z64 while it streams.
        const normalizeOrder = options.normalizeN64 === true && n64Header && n64Header.byteOrder !== 'z64' ? n64Header.byteOrder : null
        let outExt = extOf(file)
        if (normalizeOrder) {
          outExt = '.z64'
          // Point the target at the normalized name, then re-check overwrite
          // because the .z64 target may exist even when the .v64/.n64 one does
          // not (and vice versa).
          const targetExt = extOf(target)
          const normTarget = targetExt ? `${target.slice(0, target.length - targetExt.length)}${outExt}` : `${target}${outExt}`
          if (normTarget !== target) {
            target = normTarget
            if (existsSync(target) && !options.overwrite) continue
          }
        }

        if (options.organizeRoms && (n64Header || emuHeader)) {
          // Organize mode: each game lands in its own "Title (Region)" folder;
          // uniqueBase appends a numeric suffix when two titles collide.
          // Emulator ROMs stay under their stock folder (GBC/, snes_rom/,
          // smsPlus64/) when the stock layout is on; N64 games organize into
          // the card root.
          const base = n64Header
            ? uniqueBase(organizeBase(n64Header), usedBases)
            : uniqueBase(emuOrganizeBase(emuHeader!.title, emuHeader!.region, emuHeader!.productCode), usedBases)
          const parent = !n64Header && options.stockFolders ? join(destRoot, stockFolderOf(file) ?? '') : destRoot
          target = join(parent, base, `${base}${outExt}`)
        }

        await ensureDir(dirname(target))
        if (normalizeOrder) {
          await normalizeN64ToFile(file, target, normalizeOrder)
          normalizedCount++
        } else {
          await copyFile(file, target)
        }
        roms++
        // Remember the folder for the saves/ subfolder pass below.
        if (options.createSaves) saveDirs.add(dirname(target))

        if (options.copyCheats && n64Header) {
          // Sidecar .cht cheat files are copied beside the ROM and renamed to
          // match the copied target (see chtNameOf).
          const cht = findCht(file)
          if (cht) {
            const chtTarget = chtNameOf(target)
            if (!existsSync(chtTarget) || options.overwrite) {
              await ensureDir(dirname(chtTarget))
              await copyFile(cht, chtTarget)
              cheatsCopied++
            }
          }
        }

        if (options.verify) {
          // Byte-for-byte comparison of the copy against the source before the
          // next file is written; a normalized file is compared against its
          // normalized bytes instead of a raw hash.
          const ok = normalizeOrder ? await verifyNormalized(file, target, normalizeOrder) : await verifyFile(file, target)
          if (ok) {
            verified++
          } else {
            mismatches++
            if (!firstMismatch) firstMismatch = rel
            this.log('error', this.t('log.verifyFail', { file: rel }))
          }
        }
        const destRel = target.slice(destRoot.length).replace(/^[/\\]/, '')
        const isVerifyFail = options.verify && mismatches > 0 && rel === firstMismatch
        this.rows.push({
          status: isVerifyFail ? 'verify-fail' : (isN64Ext(file) && !n64Header) ? 'not-n64' : 'copied',
          source: rel, target: destRel, size: fileSize(file),
          game: n64Header?.title ?? emuHeader?.title ?? emuHeader?.productCode ?? '',
          region: n64Header ? N64_REGION_LABELS[n64Header.region] : (emuHeader?.region ?? ''),
          note: isVerifyFail ? this.t('log.verifyFail', { file: rel }) : ''
        })
        if (roms % 50 === 0) this.progress(roms, matches.length, label)
      }
    }

    // Per-console summary lines: the N64 line breaks counts down by region and
    // the emulator line by console, so the user sees the shape of the card at
    // a glance.
    if (n64Count > 0) {
      const regions = (Object.entries(regionCounts) as Array<[N64Region, number]>)
        .filter(([, c]) => c > 0)
        .map(([r, c]) => `${N64_REGION_LABELS[r]} ${c}`)
        .join(' · ')
      this.log('info', this.t('n64.summary', { roms: String(n64Count), regions, warnings: String(warningCount), dupes: String(duplicateCount) }))
    }

    const emuTotal = (Object.values(emuCounts) as number[]).reduce((a, b) => a + b, 0)
    if (emuTotal > 0) {
      const kinds = (Object.entries(emuCounts) as Array<[EmuKind, number]>)
        .filter(([, c]) => c > 0)
        .map(([k, c]) => `${EMU_KIND_LABELS[k]} ${c}`)
        .join(' · ')
      this.log('info', this.t('emu.summary', { roms: String(emuTotal), kinds, warnings: String(warningCount), dupes: String(duplicateCount) }))
    }

    if (normalizedCount > 0) {
      this.log('success', this.t('log.normalized', { count: String(normalizedCount) }))
    }

    let saves = 0
    if (options.createSaves) {
      // saveDirs collected every folder that received a ROM; each gets one
      // saves/ subfolder, which is where the menu writes save files.
      for (const d of saveDirs) {
        await ensureDir(join(d, 'saves'))
        saves++
      }
    }

    if (options.verify) {
      if (mismatches > 0) {
        this.step('verify', 'error', this.t('log.verifyFail', { file: firstMismatch }))
      } else {
        this.step('verify', 'done', this.t('run.verified'))
        this.log('success', this.t('log.verifyDone', { count: String(verified) }))
      }
    }

    this.log('success', this.t('log.romsCopied', { roms: String(roms) }))
    if (options.createSaves) this.log('success', this.t('log.savesCreated', { saves: String(saves) }))
    if (options.copyCheats && cheatsCopied > 0) this.log('success', this.t('log.cheatsCopied', { count: String(cheatsCopied) }))
    this.step('roms', 'done')
    this.counts.romsCopied = roms
    this.counts.duplicates = duplicateCount
    this.counts.verified = verified
    this.counts.verifyFailures = mismatches
    this.counts.cheatsCopied = cheatsCopied
    this.counts.savesCreated = saves
    this.counts.normalized = normalizedCount
    return { roms, saves }
  }

  /**
   * Copies a fully-prepared tree into the destination (used by 'staged' and
   * 'fromPrepared' modes). Verifies every byte when requested and throws at
   * the end when any mismatch was found, naming up to five offending files.
   */
  async copyTree(source: string, dest: string, verify: boolean): Promise<void> {
    this.step('copy', 'running')
    this.step('verify', 'pending')
    const files = listDirDeep(source)
    let total = 0
    for (const f of files) total += fileSize(f)

    let copied = 0
    let doneBytes = 0
    let verified = 0
    const mismatches: string[] = []
    const label = this.t('log.copyingTo', { dest })

    for (const file of files) {
      this.checkCancel()
      const rel = file.slice(source.length).replace(/^[/\\]/, '')
      const target = join(dest, rel)
      await ensureDir(dirname(target))
      const size = fileSize(file)
      await copyFile(file, target)
      doneBytes += size
      copied++
      if (verify) {
        this.log('info', this.t('log.verifying', { file: rel }))
        if (await verifyFile(file, target)) {
          verified++
        } else {
          mismatches.push(rel)
          this.log('error', this.t('log.verifyFail', { file: rel }))
        }
      }
      if (copied % 50 === 0 || copied === files.length) {
        this.progress(doneBytes, total || 1, label)
      }
    }

    this.lastCopyCount = copied

    if (mismatches.length > 0) {
      this.step('verify', 'error', this.t('log.verifyFail', { file: mismatches[0] }))
      this.step('copy', 'error')
      const first = mismatches.slice(0, 5).join(', ')
      throw new Error(this.t('summary.verifyFail', { count: String(mismatches.length) }) + ` — ${first}`)
    }

    if (verify) {
      this.step('verify', 'done', this.t('run.verified'))
    } else {
      this.markSkipped('verify')
    }
    this.log('success', this.t('log.copiedTo', { dest, count: String(copied) }))
    this.step('copy', 'done')
  }

  /** Renders and writes sc64-report.html/csv next to the prepared card contents. */
  async writeReportFile(destination: string, mode: PrepareMode, durationMs: number, ok: boolean): Promise<{ html: string; csv: string } | null> {
    const report = await writeReport({
      appVersion: this.cb.version ?? '',
      locale: this.locale,
      destination,
      mode,
      startedAt: this.startedAt,
      durationMs,
      ok,
      counts: this.counts,
      rows: this.rows,
      logs: this.logs
    }, destination)
    if (report) {
      this.log('info', this.t('log.reportWritten', { path: join(destination, 'sc64-report.html') }))
    }
    return report
  }
}

// Case-insensitive containment check (paths normalized to the platform
// separator) so a source folder that is actually inside the destination is
// detected regardless of letter case.
function isInsideDest(p: string, destNorm: string): boolean {
  const norm = p.replace(/\//g, sep).toLowerCase()
  return norm === destNorm || norm.startsWith(destNorm + sep)
}

/**
 * Entry point of the prepare pipeline, invoked over the prepare:run channel.
 *
 * In 'direct' mode everything is written straight into the destination. In
 * 'staged' mode the pipeline builds a temp staging folder first (so the card
 * can be formatted before files land) and then copies the tree over.
 * 'fromPrepared' skips every build step and just copies an already-prepared
 * folder tree. All modes end with the HTML/CSV report and a done/error
 * AppEvent.
 */
export async function prepare(options: PrepareOptions, cb: PrepareCallbacks): Promise<PrepareResult> {
  const runner = new Runner(cb, options.locale ?? 'en')
  runner.opts = options
  const startMs = Date.now()
  try {
    // Conflict guard: refuse to build when a source folder contains the
    // destination, because copying would read back what we write and never
    // converge.
    const guardSources = options.mode === 'fromPrepared' ? [options.preparedSource ?? ''] : options.copyRoms ? options.romSources : []
    for (const src of guardSources) {
      if (src && pathContains(src, options.destination)) {
        throw new Error(runner.t('prepare.conflictingSource', { path: src }))
      }
    }
    if (options.mode === 'fromPrepared') {
      // Reuse a prior staged result: only copy + verify run, and the rest of
      // the stepper is marked skipped.
      const src = options.preparedSource
      if (!src || !existsSync(src)) {
        throw new Error(runner.t('log.preparedMissing', { path: src ?? '' }))
      }
      for (const id of STEP_IDS) {
        if (id !== 'copy' && id !== 'verify') runner.markSkipped(id)
      }
      await runner.copyTree(src, options.destination, options.verify)
      runner.counts.romsCopied = runner.lastCopyCount
      const report = await runner.writeReportFile(options.destination, 'fromPrepared', Date.now() - startMs, true)
      const summary = runner.t('summary.doneCopy', { count: String(runner.lastCopyCount) })
      cb.emit({ type: 'done', scope: 'prepare', summary })
      return { ok: true, summary, report }
    }

    let target = options.destination
    let cleanupTarget = false
    if (options.mode === 'staged') {
      // staged mode builds into a temp dir so the card can be formatted
      // before any file lands; the staging dir is removed when the run ends.
      target = await mkdtemp(join(tmpdir(), 'sc64-stage-'))
      cleanupTarget = true
      runner.log('info', runner.t('log.staging'))
    }

    try {
      // Probe write/delete confirms the destination is actually writable
      // before the pipeline spends effort building into it.
      const probe = join(target, '.sc64-probe')
      await writeFile(probe, '')
      await rm(probe, { force: true })

      await runner.createFolders(target, options.createFolders, options.stockFolders)
      await runner.downloadMenu(target, options.downloadMenu, options.overwrite)
      await runner.downloadMetadata(target, options.downloadMetadata)
      await runner.downloadEmulators(target, options.downloadEmulators, options.emulators)
      await runner.installDDIPLStep(target, options.installDDIPL, options.ddiplSource ?? null)
      const { roms, saves } = await runner.copyRoms({ ...options, destination: target })

      let summary: string
      if (options.mode === 'staged') {
        await runner.copyTree(target, options.destination, options.verify)
        summary = runner.t('summary.doneCopy', { count: String(runner.lastCopyCount) })
      } else {
        const hasMenu = existsSync(join(target, 'sc64menu.n64'))
        summary = runner.t('summary.done', {
          menu: hasMenu ? 'sc64menu.n64 ' : '',
          roms: String(roms),
          saves: String(saves)
        })
      }
      const report = await runner.writeReportFile(options.destination, options.mode, Date.now() - startMs, true)
      cb.emit({ type: 'done', scope: 'prepare', summary })
      return { ok: true, summary, report }
    } finally {
      // Staging and extraction temp dirs are always cleaned up, even on error.
      if (cleanupTarget) await rmTree(target)
    }
  } catch (e: any) {
    const message = e?.message ?? String(e)
    let report: { html: string; csv: string } | null = null
    try {
      report = await runner.writeReportFile(options.destination, options.mode, Date.now() - startMs, false)
    } catch {
      // report writing must never mask the original error
    }
    cb.emit({ type: 'error', scope: 'prepare', message })
    return { ok: false, summary: message, report }
  }
}
