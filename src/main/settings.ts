// Settings persistence for the main process. Settings live in a settings.json
// inside the app data dir (same portable-aware dataDir as the release cache),
// are memoized in memory after first load, and are merged over DEFAULT_SETTINGS
// so keys added in newer app versions get their defaults on old save files.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/defaults'
import { dataDir } from './portable'

/** The defaults every setting starts from; new app versions only add keys here and old saves pick them up automatically. */
export const defaultSettings: AppSettings = DEFAULT_SETTINGS

let cached: AppSettings | null = null

// Same portable-aware location as the releases cache (settings.json next to the
// executable in the portable build, userData otherwise).
function settingsFile(): string {
  return join(dataDir(), 'settings.json')
}

/**
 * Loads the current settings, memoized for the lifetime of the process. The
 * saved file is merged over the defaults (top-level and the nested
 * formatOptions object) so fields missing from an older save fall back to
 * defaults instead of becoming undefined.
 */
export function getSettings(): AppSettings {
  if (cached) return cached
  try {
    const file = settingsFile()
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<AppSettings>
      // Merge order matters: defaults first, then the save, so a partial save
      // never drops the other default keys. formatOptions needs its own merge
      // because it is an object spread, not a scalar.
      cached = {
        ...defaultSettings,
        ...parsed,
        formatOptions: { ...defaultSettings.formatOptions, ...parsed.formatOptions }
      }
    } else {
      cached = { ...defaultSettings }
    }
  } catch {
    // Corrupt or unreadable settings.json: fall back to defaults rather than crash.
    cached = { ...defaultSettings }
  }
  return cached as AppSettings
}

/**
 * Applies a patch to the in-memory settings and persists the result. Persistence
 * is best-effort: a write failure (e.g. read-only media) is swallowed so the
 * current session still works with the in-memory values.
 */
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
