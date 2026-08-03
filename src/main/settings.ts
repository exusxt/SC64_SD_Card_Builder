import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings } from '../shared/types'

export const defaultSettings: AppSettings = {
  destinationMode: 'drive',
  driveId: null,
  folder: null,
  volumeLabel: 'SUMMERCART',
  language: 'en',
  theme: 'midnight',
  downloadMenu: true,
  downloadMetadata: true,
  createFolders: true,
  downloadEmulators: true,
  emulators: { nes: true, snes: true, gb: true, sms: true, chf: true },
  installDDIPL: false,
  ddiplSource: null,
  copyRoms: true,
  romSources: [],
  copyAllTypes: true,
  romTypes: { n64: true, nes: true, snes: true, gb: true, sms: true, chf: true, ndd: true },
  createSaves: true,
  includeSubdirs: true,
  overwrite: false,
  stage: false,
  verify: true,
  preparedSource: null,
  formatOptions: { fullFormat: false }
}

let cached: AppSettings | null = null

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): AppSettings {
  if (cached) return cached
  try {
    const file = settingsFile()
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<AppSettings>
      cached = { ...defaultSettings, ...parsed }
    } else {
      cached = { ...defaultSettings }
    }
  } catch {
    cached = { ...defaultSettings }
  }
  return cached as AppSettings
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  cached = { ...current, ...patch }
  try {
    const file = settingsFile()
    mkdirSync(join(app.getPath('userData')), { recursive: true })
    writeFileSync(file, JSON.stringify(cached, null, 2), 'utf-8')
  } catch {
    // ignore persistence errors
  }
  return cached as AppSettings
}
