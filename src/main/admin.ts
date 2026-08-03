import { execFile, spawn } from 'node:child_process'
import { app, dialog } from 'electron'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function isElevated(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await execFileAsync('net', ['session'], { windowsHide: true })
      return true
    }
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const { execSync } = await import('node:child_process')
      const uid = execSync('id -u', { encoding: 'utf-8' }).trim()
      return uid === '0'
    }
    return true
  } catch {
    return false
  }
}

export async function relaunchElevated(): Promise<{ ok: boolean; message: string }> {
  const exe = process.execPath
  try {
    if (process.platform === 'win32') {
      const portableExe = process.env.PORTABLE_EXECUTABLE_FILE
      const target = portableExe ?? exe
      const args = portableExe ? '' : process.argv.slice(1).join(' ')
      const command = [
        `Start-Process -FilePath '${target.replace(/'/g, "''")}'`,
        args ? `-ArgumentList '${args.replace(/'/g, "''")}'` : '',
        '-Verb RunAs'
      ]
        .filter(Boolean)
        .join(' ')
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true
      })
      return { ok: true, message: 'Elevated instance started. If a permission prompt appeared, approve it and re-run the format.' }
    }
    if (process.platform === 'darwin') {
      await execFileAsync('osascript', ['-e', `do shell script "open -n -a \\"${exe.replace(/"/g, '\\"')}\\"" with administrator privileges`], {
        windowsHide: true
      })
      return { ok: true, message: 'A macOS prompt may ask for administrator access.' }
    }
    // Linux: pkexec drops Chromium's sandbox for the root process, so the
    // elevated instance must start with --no-sandbox or it aborts immediately
    // with "Running as root without --no-sandbox is not supported". pkexec
    // exec()s the program and waits for it, so spawn detached to avoid
    // blocking this instance; if pkexec exits within the grace window the
    // user dismissed the authorization prompt.
    return await new Promise((resolve) => {
      const child = spawn('pkexec', [exe, '--no-sandbox'], { detached: true, stdio: 'ignore' })
      child.unref()
      let settled = false
      const settle = (res: { ok: boolean; message: string }): void => {
        if (settled) return
        settled = true
        resolve(res)
      }
      child.on('error', (e) => settle({ ok: false, message: `pkexec failed: ${e.message}` }))
      child.on('exit', (code) =>
        settle({ ok: false, message: `Authorization declined (pkexec exited with code ${code}).` })
      )
      setTimeout(() => settle({ ok: true, message: 'Elevated instance started via pkexec.' }), 3000)
    })
  } catch (e: any) {
    return { ok: false, message: `Could not relaunch as administrator: ${e?.message ?? e}` }
  }
}

export async function showAdminPrompt(): Promise<{ ok: boolean; message: string }> {
  const res = await relaunchElevated()
  if (res.ok) {
    // The elevated instance is starting (UAC / macOS / pkexec prompt was
    // approved) — hand over and close this instance so the user ends up with a
    // single admin window instead of two copies of the app.
    setTimeout(() => app.quit(), 2000)
    return { ok: true, message: 'The app is restarting as administrator.' }
  }
  await dialog.showMessageBox({
    type: 'error',
    title: 'Administrator privileges required',
    message: 'Could not restart the app as administrator.',
    detail: `${res.message}\n\nAlternatively, close this app and run it as administrator, then try again.`
  })
  return res
}
