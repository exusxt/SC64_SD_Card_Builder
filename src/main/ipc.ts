import { app, dialog, ipcMain, shell, BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { AppEvent, PrepareOptions, FormatOptions } from '../shared/types'
import { listDrives } from './drives'
import { getSettings, saveSettings } from './settings'
import { getMenuRelease, getMetadataRelease, getEmulatorsInfo } from './releases'
import { prepare } from './prepare'
import { inspectCard } from './inspect'
import { scanDDIPLFolder } from './ddipl'
import { formatDisk, FormatRequest } from './format'
import { isElevated, showAdminPrompt } from './admin'
import { checkForUpdates, installUpdate } from './updater'
import { listDirDeep } from './unzip'
import { listPreviewDir, loadPreviewBoxart } from './preview'
import { translate } from '../shared/i18n'

interface CancelToken {
  cancelled: boolean
}

let prepareCancel: CancelToken = { cancelled: false }
let formatCancel: CancelToken = { cancelled: false }

function sendTo(win: BrowserWindow | null, ev: AppEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send('main:event', ev)
}

function winOf(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

async function pickFolder(win: BrowserWindow | null): Promise<string | null> {
  const opts = { properties: ['openDirectory', 'createDirectory'] as Electron.OpenDialogOptions['properties'] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled ? null : res.filePaths[0] ?? null
}

async function pickFolders(win: BrowserWindow | null): Promise<string[]> {
  const opts = { properties: ['openDirectory', 'multiSelections'] as Electron.OpenDialogOptions['properties'] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled ? [] : res.filePaths
}

async function pickRomFiles(win: BrowserWindow | null): Promise<string[]> {
  const opts: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Supported ROMs', extensions: ['n64', 'z64', 'v64', 'nes', 'smc', 'sfc', 'gb', 'gbc', 'sms', 'gg', 'chf', 'ndd', 'd64'] }
    ]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled ? [] : res.filePaths
}

async function pickArchives(win: BrowserWindow | null): Promise<string[]> {
  const opts: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Archives', extensions: ['zip', '7z'] }]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled ? [] : res.filePaths
}

function classifyDroppedPaths(paths: string[]): { folders: string[]; archives: string[] } {
  const folders: string[] = []
  const archives: string[] = []
  for (const p of paths) {
    try {
      if (statSync(p).isDirectory()) {
        folders.push(p)
      } else if (/\.(zip|7z)$/i.test(p)) {
        archives.push(p)
      }
    } catch {
      // ignore unreadable paths
    }
  }
  return { folders, archives }
}

export function registerIpc(): void {
  ipcMain.handle('drives:list', () => listDrives())

  ipcMain.handle('win:minimize', (e) => winOf(e)?.minimize())
  ipcMain.handle('win:toggleMaximize', (e) => {
    const win = winOf(e)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle('win:isMaximized', (e) => winOf(e)?.isMaximized() ?? false)
  ipcMain.handle('win:close', (e) => winOf(e)?.close())

  ipcMain.handle('dialog:chooseFolder', (e) => pickFolder(winOf(e)))
  ipcMain.handle('dialog:chooseFolders', (e) => pickFolders(winOf(e)))
  ipcMain.handle('dialog:chooseRomFiles', (e) => pickRomFiles(winOf(e)))
  ipcMain.handle('dialog:chooseArchives', (e) => pickArchives(winOf(e)))
  ipcMain.handle('dialog:classifyDropped', (_e, paths: string[]) => classifyDroppedPaths(Array.isArray(paths) ? paths : []))

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: unknown) => saveSettings(patch as never))

  ipcMain.handle('releases:menu', () => getMenuRelease())
  ipcMain.handle('releases:metadata', () => getMetadataRelease())
  ipcMain.handle('releases:emulators', () => getEmulatorsInfo())

  ipcMain.handle('app:isAdmin', () => isElevated())
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:relaunchAdmin', () => showAdminPrompt())
  ipcMain.handle('app:openDocs', () => {
    void shell.openExternal('https://github.com/exusxt/SC64_SD_Card_Builder')
  })

  ipcMain.handle('prepare:run', async (e, options: PrepareOptions) => {
    const win = winOf(e)
    prepareCancel = { cancelled: false }
    return prepare(options, {
      emit: (ev) => sendTo(win, ev),
      cancel: prepareCancel,
      version: app.getVersion()
    })
  })
  ipcMain.on('prepare:cancel', () => {
    prepareCancel.cancelled = true
  })

  ipcMain.handle('inspect:card', async (_e, path: string) => {
    if (!path || !existsSync(path)) return null
    return inspectCard(path)
  })

  ipcMain.handle('ddipl:validate', async (_e, dir: string) => {
    if (!dir || !existsSync(dir)) return null
    return scanDDIPLFolder(dir)
  })

  ipcMain.handle('prepare:countPrepared', async (_e, path: string) => {
    if (!path || !existsSync(path)) return null
    const files = listDirDeep(path)
    let bytes = 0
    for (const f of files) {
      try {
        bytes += (await stat(f)).size
      } catch {
        // ignore
      }
    }
    return { files: files.length, bytes }
  })

  ipcMain.handle('format:run', async (e, opts: FormatOptions) => {
    const win = winOf(e)
    const elevated = await isElevated()
    if (!elevated) {
      await showAdminPrompt()
      return {
        ok: false,
        message: translate(opts.locale ?? 'en', 'format.elevationRequired')
      }
    }
    formatCancel = { cancelled: false }
    const req: FormatRequest = {
      device: opts.device,
      size: opts.size,
      label: opts.label,
      filesystem: opts.filesystem,
      fullFormat: opts.fullFormat,
      mountpoint: opts.mountpoint,
      locale: opts.locale
    }
    return formatDisk(req, {
      log: (level, message) => sendTo(win, { type: 'log', level, message }),
      progress: (p) => sendTo(win, { type: 'progress', value: p.bytesWritten, max: p.totalBytes || 0, label: p.stage }),
      cancel: formatCancel
    })
  })
  ipcMain.on('format:cancel', () => {
    formatCancel.cancelled = true
  })

  ipcMain.handle('app:reveal', (_e, path: string) => {
    shell.openPath(path)
  })

  ipcMain.handle('updates:check', () => {
    checkForUpdates()
  })
  ipcMain.handle('updates:install', () => {
    installUpdate()
  })

  ipcMain.handle('preview:list', async (_e, root: string, dir: string) => {
    if (!root || !existsSync(root)) return null
    return listPreviewDir(root, dir ?? '')
  })
  ipcMain.handle('preview:boxart', (_e, root: string, path: string) => {
    if (!root || !existsSync(root)) return null
    return loadPreviewBoxart(root, path)
  })
}
