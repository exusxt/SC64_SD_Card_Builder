// Portable-build data-path handling for the main process. In the portable
// build all app state (settings.json, release cache) lives next to the
// executable instead of the host's user profile, so the app leaves nothing
// behind on the machine it runs from. dataDir() is the single source of truth
// the rest of the app uses to pick the location.

import { app } from 'electron'

// electron-builder's portable wrapper sets PORTABLE_EXECUTABLE_DIR to the
// directory that holds the running .exe (see updater.ts). Keep the app's own
// data (settings, release cache) next to the executable so the portable build
// is truly portable and leaves no config behind on the host machine.
function isPortable(): boolean {
  return process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_DIR != null
}

/**
 * Directory for app data: the executable's own folder in the portable build,
 * otherwise Electron's per-user userData directory.
 */
export function dataDir(): string {
  return isPortable() ? (process.env.PORTABLE_EXECUTABLE_DIR as string) : app.getPath('userData')
}
