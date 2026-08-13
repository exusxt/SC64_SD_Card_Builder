// IPC channel registry for the main process. Every channel the preload script
// invokes is mapped to a handler here, and long-running jobs (prepare/format)
// stream AppEvents to the renderer over 'main:event'. The renderer gets no raw
// Node or Electron access - all of its filesystem/OS operations flow through
// these handlers.

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
import { listPreviewDir, loadPreviewBoxart, previewEntry } from './preview'
import { backupSaves, restoreSaves } from './saves'
import { translate, type Locale } from '../shared/i18n'

/** Mutable cancellation flag shared between a run handler and its cancel channel. */
interface CancelToken {
  cancelled: boolean
}

// Current cancel tokens for the long-running prepare/format jobs. Each new
// run replaces its token so a stale cancel never aborts the next run.
let prepareCancel: CancelToken = { cancelled: false }
let formatCancel: CancelToken = { cancelled: false }

/**
 * Pushes an AppEvent to a window's renderer via webContents.send. The
 * destroyed-window guard keeps job progress from throwing after the user
 * closes the window mid-run.
 */
function sendTo(win: BrowserWindow | null, ev: AppEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send('main:event', ev)
}

/** Resolves the BrowserWindow that sent an IPC call, so dialogs open as its children. */
function winOf(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

// Native dialog helpers. The sender window is passed through so every dialog
// stays modal to it. Results are raw paths, not File objects, because the
// renderer cannot see the filesystem directly.

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
  // The filter mirrors the extensions the copy step accepts (see EXTENSIONS
  // in prepare.ts), so the dialog cannot offer files the pipeline would skip.
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

/**
 * Splits drag-and-dropped paths into folders and archive files (zip/7z). The
 * try/catch skips entries that cannot be stat'd instead of failing the drop.
 */
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

/**
 * Registers every IPC channel once at startup. Channel names are the contract
 * with the preload script (src/preload/index.ts); each block below covers one
 * feature area of the UI.
 */
export function registerIpc(): void {
  // Drives: candidate SD cards / removable media for the drive picker.
  ipcMain.handle('drives:list', () => listDrives())

  // Window controls: the frameless window has no native title bar, so these
  // are driven by buttons the renderer draws.
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

  // Dialogs: native pickers for folders, ROM files, and archives.
  ipcMain.handle('dialog:chooseFolder', (e) => pickFolder(winOf(e)))
  ipcMain.handle('dialog:chooseFolders', (e) => pickFolders(winOf(e)))
  ipcMain.handle('dialog:chooseRomFiles', (e) => pickRomFiles(winOf(e)))
  ipcMain.handle('dialog:chooseArchives', (e) => pickArchives(winOf(e)))
  ipcMain.handle('dialog:classifyDropped', (_e, paths: string[]) => classifyDroppedPaths(Array.isArray(paths) ? paths : []))

  // Settings: the persisted JSON config is read/written wholesale.
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: unknown) => saveSettings(patch as never))

  // Releases: latest menu, metadata, and emulator info from GitHub.
  ipcMain.handle('releases:menu', () => getMenuRelease())
  ipcMain.handle('releases:metadata', () => getMetadataRelease())
  ipcMain.handle('releases:emulators', () => getEmulatorsInfo())

  // App-level queries and out-of-process actions.
  ipcMain.handle('app:isAdmin', () => isElevated())
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:relaunchAdmin', () => showAdminPrompt())
  ipcMain.handle('app:openDocs', () => {
    void shell.openExternal('https://github.com/exusxt/SC64_SD_Card_Builder/wiki')
  })

  // Each run starts with a fresh cancel token so the previous run's
  // cancellation flag cannot leak into the new one. The run streams
  // step/progress/log events to the sender's window and returns the final
  // PrepareResult (ok, summary, report).
  ipcMain.handle('prepare:run', async (e, options: PrepareOptions) => {
    const win = winOf(e)
    prepareCancel = { cancelled: false }
    return prepare(options, {
      emit: (ev) => sendTo(win, ev),
      cancel: prepareCancel,
      version: app.getVersion()
    })
  })
  // fire-and-forget: sets the flag the running job polls via checkCancel().
  ipcMain.on('prepare:cancel', () => {
    prepareCancel.cancelled = true
  })

  // Read-only scan of an existing card; unknown or missing paths yield null.
  ipcMain.handle('inspect:card', async (_e, path: string) => {
    if (!path || !existsSync(path)) return null
    return inspectCard(path)
  })

  // Pre-flight check that a selected folder holds valid 64DD IPL dumps.
  ipcMain.handle('ddipl:validate', async (_e, dir: string) => {
    if (!dir || !existsSync(dir)) return null
    return scanDDIPLFolder(dir)
  })

  // Sums the files/bytes of a previously staged folder so the UI can show how
  // much the final copy step will move.
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

  // Formatting a raw device (e.g. \\.\PHYSICALDRIVE1) requires elevation on
  // Windows; bail out with a localized message instead of failing deep inside
  // the format machinery. Progress and log lines flow back over the same
  // 'main:event' stream used by prepare.
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

  // Open a file/folder in the OS file manager (or its default application).
  ipcMain.handle('app:reveal', (_e, path: string) => {
    shell.openPath(path)
  })

  // Manual triggers for the auto-updater.
  ipcMain.handle('updates:check', () => {
    checkForUpdates()
  })
  ipcMain.handle('updates:install', () => {
    installUpdate()
  })

  // Saves backup/restore: mirror the card's saves/ trees into a folder on the
  // computer (run before reformatting) and write them back afterwards. Both
  // sides return a localized SavesResult for the destination-step UI.
  ipcMain.handle('saves:backup', async (_e, cardRoot: string, backupDir: string, locale: Locale) => {
    if (!cardRoot || !backupDir || !existsSync(cardRoot)) {
      return { ok: false, message: translate(locale ?? 'en', 'saves.backupError', { message: 'Missing path' }), files: 0, folders: 0, bytes: 0 }
    }
    return backupSaves(cardRoot, backupDir, locale ?? 'en')
  })
  ipcMain.handle('saves:restore', async (_e, cardRoot: string, backupDir: string, locale: Locale) => {
    if (!cardRoot || !backupDir || !existsSync(cardRoot)) {
      return { ok: false, message: translate(locale ?? 'en', 'saves.restoreError', { message: 'Missing path' }), files: 0, folders: 0, bytes: 0 }
    }
    return restoreSaves(cardRoot, backupDir, locale ?? 'en')
  })

  // On-screen N64FlashcartMenu preview; both calls are guarded so a path
  // outside the preview root (or a missing root) can never be read.
  ipcMain.handle('preview:list', async (_e, root: string, dir: string) => {
    if (!root || !existsSync(root)) return null
    return listPreviewDir(root, dir ?? '')
  })
  ipcMain.handle('preview:boxart', (_e, root: string, path: string) => {
    if (!root || !existsSync(root)) return null
    return loadPreviewBoxart(root, path)
  })
  ipcMain.handle('preview:entry', (_e, root: string, rel: string) => {
    if (!root || !existsSync(root)) return null
    return previewEntry(root, rel)
  })
}
