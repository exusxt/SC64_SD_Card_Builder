export interface DriveInfo {
  id: string
  name: string
  device: string
  mountpoint: string | null
  size: number
  free: number | null
  filesystem: string | null
  volumeLabel: string | null
  removable: boolean
  isSystem: boolean
}

export interface MenuReleaseInfo {
  tag: string
  name: string
  publishedAt: string
  downloadUrl: string | null
  size: number | null
}

export interface MetadataReleaseInfo {
  tag: string
  publishedAt: string
  downloadUrl: string | null
  size: number | null
}

export type EmulatorKey = 'nes' | 'snes' | 'gb' | 'sms' | 'chf'

export interface EmulatorInfo {
  key: EmulatorKey
  label: string
  fileName: string
  version: string | null
  error?: string
}

export interface EmulatorsInfo {
  list: EmulatorInfo[]
  offline: boolean
}

import type { Locale, ThemeId } from './i18n'
export type { Locale, ThemeId } from './i18n'

export interface AppSettings {
  destinationMode: 'drive' | 'folder'
  driveId: string | null
  folder: string | null
  volumeLabel: string
  language: Locale
  theme: ThemeId
  downloadMenu: boolean
  downloadMetadata: boolean
  createFolders: boolean
  downloadEmulators: boolean
  emulators: Record<EmulatorKey, boolean>
  copyRoms: boolean
  romSources: string[]
  copyAllTypes: boolean
  romTypes: Record<'n64' | 'nes' | 'snes' | 'gb' | 'sms' | 'chf' | 'ndd', boolean>
  createSaves: boolean
  includeSubdirs: boolean
  overwrite: boolean
  stage: boolean
  verify: boolean
  preparedSource: string | null
  formatOptions: {
    fullFormat: boolean
  }
}

export type PrepareMode = 'direct' | 'staged' | 'fromPrepared'

export interface PrepareOptions {
  destination: string
  locale: Locale
  mode: PrepareMode
  preparedSource?: string
  downloadMenu: boolean
  downloadMetadata: boolean
  createFolders: boolean
  downloadEmulators: boolean
  emulators: Record<EmulatorKey, boolean>
  copyRoms: boolean
  romSources: string[]
  romTypes: string[]
  createSaves: boolean
  includeSubdirs: boolean
  overwrite: boolean
  verify: boolean
}

export interface FormatOptions {
  device: string
  size: number
  label: string
  fullFormat: boolean
  mountpoint: string | null
  locale: Locale
}

export type StepId =
  | 'folders'
  | 'menu'
  | 'metadata'
  | 'emulators'
  | 'roms'
  | 'format'
  | 'verify'
  | 'copy'

export interface StepState {
  id: StepId
  label: string
  state: 'pending' | 'running' | 'done' | 'error'
  detail?: string
}

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

export interface PrepareResult {
  ok: boolean
  summary: string
}

export interface FormatResult {
  ok: boolean
  message: string
}
