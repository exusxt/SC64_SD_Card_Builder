import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { formatDevice, CancelToken, FormatProgress } from './fat32'
import type { FormatResult, Locale } from '../shared/types'
import { translate } from '../shared/i18n'

const execFileAsync = promisify(execFile)

function run(cmd: string, args: string[]): Promise<string> {
  return execFileAsync(cmd, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }).then(
    (r) => r.stdout,
    (e) => {
      const msg = e?.stderr ?? e?.message ?? 'unknown error'
      throw new Error(msg.trim())
    }
  )
}

export interface FormatRequest {
  device: string
  size: number
  label: string
  fullFormat: boolean
  mountpoint: string | null
  locale?: Locale
}

export interface FormatCallbacks {
  log: (level: 'info' | 'success' | 'warn' | 'error', message: string) => void
  progress: (p: FormatProgress) => void
  cancel?: CancelToken
}

function diskNumberFromWindowsDevice(device: string): number | null {
  const m = /PhysicalDrive(\d+)/i.exec(device)
  return m ? Number(m[1]) : null
}

async function remountWindows(device: string): Promise<void> {
  const diskNumber = diskNumberFromWindowsDevice(device)
  if (diskNumber === null) return
  const script = [
    '$ErrorActionPreference = "SilentlyContinue";',
    'Update-HostStorageCache;',
    'Start-Sleep -Milliseconds 800;',
    `$d = Get-Disk -Number ${diskNumber};`,
    'if ($d) {',
    '  $part = Get-Partition -DiskNumber $d.Number | Select-Object -First 1;',
    '  if ($part) {',
    '    if ($part.DriveLetter) { Remove-PartitionAccessPath -DiskNumber $d.Number -PartitionNumber $part.PartitionNumber -AccessPath "$($part.DriveLetter):\\" -ErrorAction SilentlyContinue };',
    '    Add-PartitionAccessPath -DiskNumber $d.Number -PartitionNumber $part.PartitionNumber -AssignDriveLetter -ErrorAction SilentlyContinue;',
    '  }',
    '}'
  ].join(' ')
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
  } catch {
    // best-effort
  }
}

async function unmountLinux(device: string): Promise<void> {
  // unmount any mounted partitions of the disk
  const out = await run('lsblk', ['-n', '-o', 'MOUNTPOINT', device]).catch(() => '')
  const mounts = out.split('\n').map((s) => s.trim()).filter(Boolean)
  for (const m of mounts) {
    await run('umount', [m]).catch(() => undefined)
  }
}

async function remountLinux(device: string): Promise<void> {
  try {
    await run('partprobe', [device])
  } catch {
    // partprobe may be unavailable; harmless
  }
}

async function unmountMacos(device: string): Promise<void> {
  await run('diskutil', ['unmountDisk', device]).catch(() => undefined)
}

async function remountMacos(device: string): Promise<void> {
  await run('diskutil', ['mountDisk', device]).catch(() => undefined)
}

export async function formatDisk(req: FormatRequest, cb: FormatCallbacks): Promise<FormatResult> {
  const device = req.device
  const platform = process.platform
  const locale = req.locale ?? 'en'
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>): string =>
    translate(locale, key, vars)
  let writeDevice = device

  try {
    cb.log('info', t('format.start', { device, size: (req.size / 1024 / 1024 / 1024).toFixed(2) }))

    if (platform === 'darwin') {
      await unmountMacos(device)
      writeDevice = device.replace(/^\/dev\/disk/, '/dev/rdisk')
    } else {
      await unmountLinux(device)
    }

    let lastStage = ''
    cb.log('info', t('format.structures', { device: writeDevice }))
    await formatDevice(writeDevice, req.size, {
      label: req.label,
      fullFormat: req.fullFormat,
      mountpoint: req.mountpoint,
      cancel: req.fullFormat ? cb.cancel : undefined,
      onProgress: (p) => {
        const stageKey =
          p.stage === 'Writing partition table'
            ? 'format.partitionTable'
            : p.stage === 'Writing file allocation tables'
              ? 'format.fats'
              : p.stage === 'Root directory created'
                ? 'format.root'
                : 'format.full'
        const stage = t(stageKey)
        if (p.stage !== lastStage) {
          cb.log('info', stage)
          lastStage = p.stage
        }
        cb.progress({ ...p, stage })
      }
    })

    cb.log('info', t('format.refresh'))
    if (platform === 'win32') {
      await remountWindows(device)
    } else if (platform === 'darwin') {
      await remountMacos(device)
    } else {
      await remountLinux(device)
    }

    cb.log('success', t('format.complete'))
    const done = t('format.done') + (platform === 'win32' ? ' ' + t('format.doneWindows') : '')
    return { ok: true, message: done }
  } catch (e: any) {
    if (e?.message === 'Format cancelled') {
      cb.log('warn', t('format.cancelled'))
      return { ok: false, message: t('format.cancelled') }
    }
    cb.log('error', t('format.failed', { message: e?.message ?? String(e) }))
    return { ok: false, message: t('format.failed', { message: e?.message ?? String(e) }) }
  }
}
