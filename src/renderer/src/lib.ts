import type { AppSettings, EmulatorKey } from '../../shared/types'
import type { ThemeId } from '../../shared/i18n'

export const DEFAULT_SETTINGS: AppSettings = {
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

export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`
}

export type ThemeVars = Record<string, string>

export const THEMES: Record<ThemeId, { name: string; vars: ThemeVars }> = {
  midnight: {
    name: 'Midnight',
    vars: {
      '--sc64-bg': '#0b1020',
      '--sc64-panel': '#111a30',
      '--sc64-panel2': '#0e1526',
      '--sc64-deep': '#070b16',
      '--sc64-border': '#223052',
      '--sc64-borderlight': '#2e3f6b',
      '--sc64-accent': '#38bdf8',
      '--sc64-accent2': '#a78bfa',
      '--sc64-good': '#34d399',
      '--sc64-warn': '#fbbf24',
      '--sc64-bad': '#f87171',
      '--sc64-muted': '#8b98b8',
      '--sc64-text': '#e2e8f0',
      '--sc64-glow': '0 0 24px rgba(56, 189, 248, 0.25)'
    }
  },
  ocean: {
    name: 'Ocean',
    vars: {
      '--sc64-bg': '#04141f',
      '--sc64-panel': '#082b3d',
      '--sc64-panel2': '#06212f',
      '--sc64-deep': '#020d14',
      '--sc64-border': '#0e3d56',
      '--sc64-borderlight': '#17567a',
      '--sc64-accent': '#22d3ee',
      '--sc64-accent2': '#60a5fa',
      '--sc64-good': '#34d399',
      '--sc64-warn': '#facc15',
      '--sc64-bad': '#fb7185',
      '--sc64-muted': '#7aa2bb',
      '--sc64-text': '#e0f2fe',
      '--sc64-glow': '0 0 24px rgba(34, 211, 238, 0.25)'
    }
  },
  forest: {
    name: 'Forest',
    vars: {
      '--sc64-bg': '#0c1512',
      '--sc64-panel': '#14241d',
      '--sc64-panel2': '#0f1d17',
      '--sc64-deep': '#070d0a',
      '--sc64-border': '#1e3b2f',
      '--sc64-borderlight': '#2c5847',
      '--sc64-accent': '#34d399',
      '--sc64-accent2': '#a3e635',
      '--sc64-good': '#4ade80',
      '--sc64-warn': '#fbbf24',
      '--sc64-bad': '#f87171',
      '--sc64-muted': '#87a89a',
      '--sc64-text': '#e7f5ee',
      '--sc64-glow': '0 0 24px rgba(52, 211, 153, 0.25)'
    }
  },
  sunset: {
    name: 'Sunset',
    vars: {
      '--sc64-bg': '#1d0f1e',
      '--sc64-panel': '#2d1530',
      '--sc64-panel2': '#251226',
      '--sc64-deep': '#150a16',
      '--sc64-border': '#47224a',
      '--sc64-borderlight': '#653466',
      '--sc64-accent': '#fb7185',
      '--sc64-accent2': '#fbbf24',
      '--sc64-good': '#4ade80',
      '--sc64-warn': '#fbbf24',
      '--sc64-bad': '#fb7185',
      '--sc64-muted': '#b58ab5',
      '--sc64-text': '#fce7f3',
      '--sc64-glow': '0 0 24px rgba(251, 113, 133, 0.25)'
    }
  }
}

export function applyTheme(id: ThemeId): void {
  const theme = THEMES[id] ?? THEMES.midnight
  for (const [key, value] of Object.entries(theme.vars)) {
    document.documentElement.style.setProperty(key, value)
  }
  document.documentElement.dataset.theme = id
}

export const EMULATOR_LABELS: Record<EmulatorKey, string> = {
  nes: 'NES (Neon64)',
  snes: 'SNES (Sodium64)',
  gb: 'Game Boy / Color (GB64)',
  sms: 'SMS / Game Gear (SMSPlus64)',
  chf: 'Channel F (Press-F Ultra)'
}

export const ROM_TYPE_LABELS: Record<string, string> = {
  n64: 'N64 (.n64 / .z64 / .v64)',
  nes: 'NES (.nes)',
  snes: 'SNES (.smc / .sfc)',
  gb: 'Game Boy (.gb / .gbc)',
  sms: 'SMS / Game Gear (.sms / .gg)',
  chf: 'Channel F (.chf)',
  ndd: '64DD disks (.ndd / .d64)'
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
