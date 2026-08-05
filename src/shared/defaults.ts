// Default values for the persisted app settings.
// Lives in the shared layer; the main process hydrates DEFAULT_SETTINGS on
// fresh installs so every run starts from the same baseline.

import type { AppSettings } from './types'

/**
 * Single source of truth for a fresh install's settings (see AppSettings).
 * New keys added to AppSettings should be mirrored here so existing users
 * still get sane defaults when their saved config is loaded.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  destinationMode: 'drive',
  driveId: null,
  folder: null,
  volumeLabel: 'SUMMERCART', // volume label applied when formatting the card
  language: 'en',
  theme: 'gallery',
  downloadMenu: true,
  downloadMetadata: true,
  createFolders: true,
  downloadEmulators: true,
  emulators: { nes: true, snes: true, gb: true, sms: true, chf: true },
  installDDIPL: false,
  ddiplSource: null,
  copyRoms: true,
  romSources: [],
  archiveSources: [],
  copyAllTypes: true,
  romTypes: { n64: true, nes: true, snes: true, gb: true, sms: true, chf: true, ndd: true },
  createSaves: true,
  includeSubdirs: true,
  overwrite: false,
  organizeRoms: false,
  stockFolders: true,
  copyCheats: false,
  stage: false, // stage first, then copy to the card on request
  verify: true,
  preparedSource: null,
  formatOptions: { fullFormat: false, filesystem: 'fat32' } // quick format, FAT32 for broad compatibility
}
