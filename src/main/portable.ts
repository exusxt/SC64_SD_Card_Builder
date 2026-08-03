import { app } from 'electron'

// electron-builder's portable wrapper sets PORTABLE_EXECUTABLE_DIR to the
// directory that holds the running .exe (see updater.ts). Keep the app's own
// data (settings, release cache) next to the executable so the portable build
// is truly portable and leaves no config behind on the host machine.
function isPortable(): boolean {
  return process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_DIR != null
}

export function dataDir(): string {
  return isPortable() ? (process.env.PORTABLE_EXECUTABLE_DIR as string) : app.getPath('userData')
}
