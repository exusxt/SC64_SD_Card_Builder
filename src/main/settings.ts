import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/defaults'
import { dataDir } from './portable'

export const defaultSettings: AppSettings = DEFAULT_SETTINGS

let cached: AppSettings | null = null

function settingsFile(): string {
  return join(dataDir(), 'settings.json')
}

export function getSettings(): AppSettings {
  if (cached) return cached
  try {
    const file = settingsFile()
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<AppSettings>
      cached = {
        ...defaultSettings,
        ...parsed,
        formatOptions: { ...defaultSettings.formatOptions, ...parsed.formatOptions }
      }
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
    mkdirSync(dataDir(), { recursive: true })
    writeFileSync(file, JSON.stringify(cached, null, 2), 'utf-8')
  } catch {
    // ignore persistence errors
  }
  return cached as AppSettings
}
