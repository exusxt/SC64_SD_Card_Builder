import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { downloadFile } from './download'
import { getAppLatestRelease } from './releases'
import type { ReleaseAsset } from './releases'
import type { AppEvent } from '../shared/types'

let win: BrowserWindow | null = null
let busy = false

// electron-builder's portable wrapper sets these env vars; electron-updater has no
// portable support and would otherwise run the NSIS installer instead of updating.
const isPortable = process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_FILE != null

interface PendingUpdate {
  version: string
  asset: ReleaseAsset
  downloadedPath: string | null
}

let pending: PendingUpdate | null = null

function send(ev: AppEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send('main:event', ev)
}

function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.split('.').map((x) => parseInt(x, 10))
  const b = current.split('.').map((x) => parseInt(x, 10))
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }
  return false
}

function portableAssetName(version: string): string {
  return `SC64-SD-Card-Builder-${version}-${process.arch}.exe`
}

function pickPortableAsset(assets: ReleaseAsset[], version: string): ReleaseAsset | undefined {
  const exact = portableAssetName(version)
  return (
    assets.find((a) => a.name === exact) ??
    assets.find((a) => a.name === `SC64-SD-Card-Builder-${version}.exe`) ??
    assets.find((a) => /\.exe$/i.test(a.name) && !/setup/i.test(a.name))
  )
}

async function portableCheck(): Promise<void> {
  try {
    const info = await getAppLatestRelease(true)
    if (!isNewerVersion(info.version, app.getVersion())) {
      send({ type: 'update', state: 'not-available' })
      return
    }
    const asset = pickPortableAsset(info.assets, info.version)
    if (!asset) {
      send({ type: 'update', state: 'error', message: 'No portable build available for this platform' })
      return
    }
    pending = { version: info.version, asset, downloadedPath: null }
    send({ type: 'update', state: 'available', version: info.version })
    await portableDownload()
  } catch (e) {
    send({ type: 'update', state: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

async function portableDownload(): Promise<void> {
  const p = pending
  if (!p) return
  try {
    const dest = join(app.getPath('temp'), `sc64-update-${p.version}.exe`)
    send({ type: 'update', state: 'downloading', percent: 0 })
    await downloadFile(p.asset.browser_download_url, dest, {
      onProgress: (prog) =>
        send({
          type: 'update',
          state: 'downloading',
          percent: prog.total > 0 ? Math.round((prog.received / prog.total) * 100) : 0
        })
    })
    p.downloadedPath = dest
    send({ type: 'update', state: 'downloaded', version: p.version })
  } catch (e) {
    send({ type: 'update', state: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

function portableReplace(): void {
  const p = pending
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (!p?.downloadedPath || !exe) return
  const src = p.downloadedPath
  const dst = exe
  // The downloaded portable exe cannot overwrite the running one directly (it is
  // locked). Run a small detached batch file that waits for the app to exit and
  // then swaps the files and relaunches. A .bat is used instead of PowerShell to
  // keep the heuristic surface of the packaged binary smaller.
  const script = [
    '@echo off',
    'set n=0',
    ':loop',
    'set /a n+=1',
    'if %n% gtr 60 goto relaunch',
    `move /y "${src}" "${dst}" >nul 2>&1`,
    'if errorlevel 1 (',
    '  ping -n 2 127.0.0.1 >nul',
    '  goto loop',
    ')',
    ':relaunch',
    `start "" "${dst}"`
  ].join('\r\n')
  const batPath = join(app.getPath('temp'), 'sc64-portable-update.bat')
  try {
    writeFileSync(batPath, script)
  } catch {
    return
  }
  const child = spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  app.exit(0)
}

function updaterErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/no published versions|no releases/i.test(message)) {
    return 'not-available'
  }
  return message
}

export function initUpdater(w: BrowserWindow): void {
  win = w

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => {
    busy = true
    send({ type: 'update', state: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    send({ type: 'update', state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    busy = false
    send({ type: 'update', state: 'not-available' })
  })
  autoUpdater.on('download-progress', (p) => {
    send({ type: 'update', state: 'downloading', percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    busy = false
    send({ type: 'update', state: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    busy = false
    const message = updaterErrorMessage(err)
    if (message === 'not-available') {
      send({ type: 'update', state: 'not-available' })
    } else {
      send({ type: 'update', state: 'error', message })
    }
  })
}

export function checkForUpdates(): void {
  if (busy) return
  if (!app.isPackaged) {
    send({ type: 'update', state: 'not-available' })
    return
  }
  busy = true
  if (isPortable) {
    void portableCheck().finally(() => {
      busy = false
    })
  } else {
    void autoUpdater.checkForUpdates().catch((e: unknown) => {
      busy = false
      const message = updaterErrorMessage(e)
      if (message === 'not-available') {
        send({ type: 'update', state: 'not-available' })
      } else {
        send({ type: 'update', state: 'error', message })
      }
    })
  }
}

export function installUpdate(): void {
  if (!app.isPackaged) return
  if (isPortable) {
    portableReplace()
  } else {
    autoUpdater.quitAndInstall()
  }
}
