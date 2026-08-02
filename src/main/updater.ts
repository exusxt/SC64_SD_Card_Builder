import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppEvent } from '../shared/types'

let win: BrowserWindow | null = null
let busy = false

function send(ev: AppEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send('main:event', ev)
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
    send({ type: 'update', state: 'error', message: err?.message ?? String(err) })
  })
}

export function checkForUpdates(): void {
  if (busy) return
  if (!app.isPackaged) {
    send({ type: 'update', state: 'not-available' })
    return
  }
  busy = true
  void autoUpdater.checkForUpdates().catch((e: unknown) => {
    busy = false
    send({ type: 'update', state: 'error', message: e instanceof Error ? e.message : String(e) })
  })
}

export function installUpdate(): void {
  if (app.isPackaged) autoUpdater.quitAndInstall()
}
