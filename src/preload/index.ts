import { contextBridge, ipcRenderer, webUtils, IpcRendererEvent } from 'electron'
import type {
  AppEvent,
  AppSettings,
  CardInspection,
  DdIplValidation,
  DriveInfo,
  EmulatorsInfo,
  FormatOptions,
  FormatResult,
  MenuReleaseInfo,
  MetadataReleaseInfo,
  PrepareOptions,
  PrepareResult,
  PreviewEntry
} from '../shared/types'
const api = {
  listDrives: (): Promise<DriveInfo[]> => ipcRenderer.invoke('drives:list'),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:chooseFolder'),
  chooseFolders: (): Promise<string[]> => ipcRenderer.invoke('dialog:chooseFolders'),
  chooseRomFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:chooseRomFiles'),
  chooseArchives: (): Promise<string[]> => ipcRenderer.invoke('dialog:chooseArchives'),
  classifyDropped: (paths: string[]): Promise<{ folders: string[]; archives: string[] }> =>
    ipcRenderer.invoke('dialog:classifyDropped', paths),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('settings:set', patch),
  getMenuRelease: (): Promise<MenuReleaseInfo> => ipcRenderer.invoke('releases:menu'),
  getMetadataRelease: (): Promise<MetadataReleaseInfo> => ipcRenderer.invoke('releases:metadata'),
  getEmulatorsInfo: (): Promise<EmulatorsInfo> => ipcRenderer.invoke('releases:emulators'),
  isAdmin: (): Promise<boolean> => ipcRenderer.invoke('app:isAdmin'),
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  relaunchAdmin: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('app:relaunchAdmin'),
  openDocs: (): Promise<void> => ipcRenderer.invoke('app:openDocs'),
  reveal: (path: string): Promise<void> => ipcRenderer.invoke('app:reveal', path),
  prepare: (options: PrepareOptions): Promise<PrepareResult> => ipcRenderer.invoke('prepare:run', options),
  cancelPrepare: (): void => ipcRenderer.send('prepare:cancel'),
  countPreparedFolder: (path: string): Promise<{ files: number; bytes: number } | null> =>
    ipcRenderer.invoke('prepare:countPrepared', path),
  inspectCard: (path: string): Promise<CardInspection | null> => ipcRenderer.invoke('inspect:card', path),
  listPreviewDir: (root: string, dir: string): Promise<PreviewEntry[] | null> => ipcRenderer.invoke('preview:list', root, dir),
  loadPreviewBoxart: (root: string, path: string): Promise<string | null> => ipcRenderer.invoke('preview:boxart', root, path),
  validateDDIPL: (dir: string): Promise<DdIplValidation | null> => ipcRenderer.invoke('ddipl:validate', dir),
  format: (options: FormatOptions): Promise<FormatResult> => ipcRenderer.invoke('format:run', options),
  cancelFormat: (): void => ipcRenderer.send('format:cancel'),
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('win:minimize'),
  windowToggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('win:toggleMaximize'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('win:isMaximized'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('win:close'),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('updates:check'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('updates:install'),
  onWindowMaximized: (cb: (maximized: boolean) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, maximized: boolean): void => cb(maximized)
    ipcRenderer.on('win:maximized', listener)
    return () => ipcRenderer.removeListener('win:maximized', listener)
  },
  onEvent: (cb: (ev: AppEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, ev: AppEvent): void => cb(ev)
    ipcRenderer.on('main:event', listener)
    return () => ipcRenderer.removeListener('main:event', listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
