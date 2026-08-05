// Shared TypeScript contracts for the SC64 SD Card Builder.
// Lives in the shared layer so the main, preload, and renderer processes all
// agree on the shape of settings, the prepare/format pipelines, drive
// inspection, the emulator catalog, and the on-screen menu preview.

/**
 * A 64DD IPL ROM dump is exactly 4 MiB big-endian; smaller/corrupt files
 * are rejected so the cart menu does not hang on a bad IPL.
 */
export const DD_IPL_SIZE = 4194304

/**
 * A single 64DD IPL candidate found in the folder being validated. Reports
 * whether the dump is plain big-endian or byte-swapped and flags problems so
 * a bad IPL never gets installed.
 */
export interface DdIplFileInfo {
  id: string
  name: string | null
  present: boolean
  valid: boolean
  size: number | null
  byteOrder: 'be' | 'swapped' | null
  idOk: boolean
}

/** Result of scanning a folder for 64DD IPL dumps, plus files that were not recognized. */
export interface DdIplValidation {
  files: DdIplFileInfo[]
  unrecognized: string[]
}

/**
 * A physical drive as shown in the drive picker.
 * `device` is the raw OS path used for formatting; `mountpoint` is the drive
 * letter when the volume is mounted (null otherwise).
 */
export interface DriveInfo {
  id: string
  name: string
  device: string // raw OS device path (e.g. \\?\PHYSICALDRIVE1), used for formatting
  mountpoint: string | null // drive letter, null when the volume is unmounted
  size: number
  free: number | null
  filesystem: string | null
  volumeLabel: string | null
  removable: boolean
  isSystem: boolean // system/boot drive; the app refuses to use it
}

/** Whether an existing copy of N64FlashcartMenu is present on a card, and its reported version/size. */
export interface InspectMenuInfo {
  present: boolean
  version: string | null
  size: number | null
}

/**
 * The result of inspecting an existing card: what it already holds (menu,
 * ROMs, saves, files) so the UI can warn about overwrites and free space.
 */
export interface CardInspection {
  menu: InspectMenuInfo
  roms: { n64: number; gb: number; gbc: number; snes: number; sms: number; gg: number; other: number } // per-system ROM counts; `other` = unrecognized types
  saves: number
  files: number
  bytes: number
  freeBytes: number | null
}

/** Latest N64FlashcartMenu release, as reported by the GitHub API. */
export interface MenuReleaseInfo {
  tag: string
  name: string
  publishedAt: string
  downloadUrl: string | null
  size: number | null
}

/** Latest metadata release (boxart/descriptions), as reported by the GitHub API. */
export interface MetadataReleaseInfo {
  tag: string
  publishedAt: string
  downloadUrl: string | null
  size: number | null
}

/**
 * Identifies one of the bundled N64-based emulators installed into menu/emulators/:
 * nes = Neon64 (NES), snes = Sodium64 (SNES), gb = GB64 (GB/GBC),
 * sms = SMSPlus64 (SMS/GG), chf = Press-F Ultra (Channel F).
 */
export type EmulatorKey = 'nes' | 'snes' | 'gb' | 'sms' | 'chf'

/** Details about one emulator the app can download and install. */
export interface EmulatorInfo {
  key: EmulatorKey
  label: string
  fileName: string
  version: string | null
  error?: string // set when the emulator is missing or its download failed
}

/** Catalog of available emulators, plus whether it was fetched offline. */
export interface EmulatorsInfo {
  list: EmulatorInfo[]
  offline: boolean
}

import type { Locale, ThemeId } from './i18n'
export type { Locale, ThemeId } from './i18n'

/** Filesystem choices for the formatting step: FAT32 (broadest compatibility) or exFAT (large cards/fat files). */
export type Filesystem = 'fat32' | 'exfat'

/**
 * The persisted user configuration. Saved as JSON by the main process and
 * hydrated from DEFAULT_SETTINGS on fresh installs; the renderer edits it
 * through the settings:get / settings:set IPC channels.
 */
export interface AppSettings {
  destinationMode: 'drive' | 'folder' // write to a physical SD card, or to a plain folder
  driveId: string | null // chosen target drive, matches destinationMode
  folder: string | null // chosen target folder, matches destinationMode
  volumeLabel: string // volume label applied when formatting the card
  language: Locale
  theme: ThemeId
  downloadMenu: boolean
  downloadMetadata: boolean
  createFolders: boolean
  downloadEmulators: boolean
  emulators: Record<EmulatorKey, boolean> // per-emulator install toggle (see EmulatorKey)
  installDDIPL: boolean
  ddiplSource: string | null // folder containing the 64DD IPL dump
  copyRoms: boolean
  romSources: string[] // folders scanned for ROMs
  archiveSources: string[] // archive files (zip/7z) to extract
  copyAllTypes: boolean // when false, only the types enabled in romTypes are copied
  romTypes: Record<'n64' | 'nes' | 'snes' | 'gb' | 'sms' | 'chf' | 'ndd', boolean> // per-system ROM type toggle; ndd = 64DD disk images
  createSaves: boolean
  includeSubdirs: boolean
  overwrite: boolean // overwrite existing files on the card instead of skipping them
  organizeRoms: boolean // split ROMs into per-console folders instead of the stock layout
  stockFolders: boolean // use the folder names N64FlashcartMenu expects (menu/, roms/, saves/, cheats/)
  copyCheats: boolean
  stage: boolean // prepare into a staging folder first, then copy to the card on request
  verify: boolean // byte-for-byte verification after writing
  preparedSource: string | null // staging folder from a prior staged run (used with mode = 'fromPrepared')
  formatOptions: {
    fullFormat: boolean // full vs. quick format
    filesystem: Filesystem
  }
}

/** How a prepare run executes: directly to the card, staged first, or copying a previously staged folder. */
export type PrepareMode = 'direct' | 'staged' | 'fromPrepared'

/**
 * Runtime options for one prepare run. Mirrors AppSettings but resolved to
 * concrete values (e.g. romTypes already expanded to a string list) so the
 * main process needs no settings lookup.
 */
export interface PrepareOptions {
  destination: string
  locale: Locale
  mode: PrepareMode
  preparedSource?: string // staging folder to copy when mode = 'fromPrepared'
  downloadMenu: boolean
  downloadMetadata: boolean
  createFolders: boolean
  downloadEmulators: boolean
  emulators: Record<EmulatorKey, boolean>
  installDDIPL: boolean
  ddiplSource?: string | null // folder containing the 64DD IPL dump
  copyRoms: boolean
  romSources: string[]
  archiveSources: string[]
  romTypes: string[] // ROM extensions enabled for this run
  createSaves: boolean
  includeSubdirs: boolean
  overwrite: boolean
  organizeRoms: boolean
  stockFolders: boolean
  copyCheats: boolean
  verify: boolean
}

/**
 * Options for the formatting step: which raw device to format, its capacity,
 * the volume label, and whether to do a full or quick format.
 */
export interface FormatOptions {
  device: string // raw OS device path (e.g. \\?\PHYSICALDRIVE1)
  size: number
  label: string
  filesystem: Filesystem
  fullFormat: boolean // full vs. quick format
  mountpoint: string | null // current drive letter, shown so the user can confirm the target
  locale: Locale
}

/** The ordered steps of the prepare pipeline, shown as the stepper in the UI. */
export type StepId =
  | 'folders'
  | 'menu'
  | 'metadata'
  | 'emulators'
  | 'ddipl'
  | 'roms'
  | 'format'
  | 'verify'
  | 'copy'

/** Live state of one pipeline step, pushed to the renderer so the stepper can update. */
export interface StepState {
  id: StepId
  label: string
  state: 'pending' | 'running' | 'done' | 'error'
  detail?: string
}

/**
 * The unified event stream the main process pushes to the renderer over the
 * 'main:event' channel: log lines, step changes, progress, phase changes,
 * completion/errors, and update status.
 */
export type AppEvent =
  | { type: 'log'; level: 'info' | 'success' | 'warn' | 'error'; message: string }
  | { type: 'step'; step: StepState }
  | { type: 'progress'; value: number; max: number; label?: string }
  | { type: 'phase'; scope: 'prepare' | 'format'; phase: string }
  | { type: 'done'; scope: 'prepare' | 'format'; summary: string }
  | { type: 'error'; scope: 'prepare' | 'format'; message: string }
  | {
      type: 'update'
      state: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
      version?: string
      percent?: number
      message?: string
    }

/**
 * Outcome of a prepare run: success flag, human-readable summary, and an
 * optional HTML/CSV report of files copied, skipped, or failed.
 */
export interface PrepareResult {
  ok: boolean
  summary: string
  report?: { html: string; csv: string } | null
}

/** Media type of a preview entry, used to pick the matching boxart and description. */
export type PreviewKind = 'n64' | 'dd' | 'gb' | 'gbc' | 'snes' | 'sms' | 'gg' | 'other' // 'dd' = 64DD disk images; the rest map to their emulator

/**
 * One file/folder shown in the on-screen N64FlashcartMenu preview (file
 * browser emulation with boxart and descriptions). Fields beyond name/size
 * are filled from the downloaded metadata when available.
 */
export interface PreviewEntry {
  name: string
  isDir: boolean
  size: number
  kind: PreviewKind
  title: string | null
  gameCode: string | null
  region: string | null
  boxart: string | null
  description: string | null
}

/** Outcome of the formatting step, with a user-facing message on failure. */
export interface FormatResult {
  ok: boolean
  message: string
}
