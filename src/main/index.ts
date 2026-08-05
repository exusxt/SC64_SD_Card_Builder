// Electron main-process entry point: app lifecycle and the app's only window.
// Registers the IPC handlers (registerIpc), sets up the auto-updater, and
// loads either the Vite dev server or the built renderer depending on how the
// app was launched.

import { app, BrowserWindow, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { initUpdater, checkForUpdates } from './updater'

// The app's single window. Null while no window exists, so the macOS
// 'activate' handler knows when it must recreate one.
let mainWindow: BrowserWindow | null = null

/**
 * Creates the frameless main window. The renderer draws its own title bar, so
 * the native maximized state is mirrored back to it over 'win:maximized'.
 * The webPreferences keep Node and the filesystem away from the renderer:
 * everything the UI needs goes through the contextBridge IPC API.
 */
function createWindow(): void {
  const devIcon = join(__dirname, '../../build/icon.ico')
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 940,
    minHeight: 680,
    title: 'SC64 SD Card Builder',
    backgroundColor: '#0b1020',
    frame: false,
    show: false,
    icon: existsSync(devIcon) ? devIcon : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // The window is frameless, so the renderer's custom title bar needs to know
  // when the OS maximizes/unmaximizes the window (e.g. via the taskbar).
  mainWindow.on('maximize', () => mainWindow?.webContents.send('win:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('win:maximized', false))

  // No in-app windows: every target=_blank link is handed to the OS browser
  // and the window creation is denied, so pages cannot spawn pop-ups.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Dev builds (electron-vite) serve the renderer over HTTP; production loads
  // the prebuilt index.html next to the compiled main bundle.
  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // IPC handlers must be registered before the window loads, otherwise the
  // renderer's first invokes could race the handlers and fail.
  registerIpc()
  createWindow()
  if (mainWindow) {
    initUpdater(mainWindow)
    // Only auto-check for updates in packaged builds; the delay lets the
    // window settle before the network request goes out.
    setTimeout(() => {
      if (app.isPackaged) checkForUpdates()
    }, 5000)
  }

  // macOS convention: re-create the window when the dock icon is clicked and
  // none is open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Standard desktop behavior: quit when every window closes, except on macOS
// where apps stay alive until the user quits explicitly.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
