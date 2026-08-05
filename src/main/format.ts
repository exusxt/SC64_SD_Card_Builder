// Orchestrates formatting of a physical volume across platforms.
//
// Quick format writes only the filesystem structure; full format first zeroes
// the whole device. Windows delegates to the Storage module (Clear-Disk /
// Initialize-Disk / New-Partition / Format-Volume) so the OS handles volume
// locking, while macOS uses diskutil and Linux uses sfdisk + mkfs.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { formatDevice, sanitizeLabel, sanitizeExfatLabel, zeroDevice, CancelToken, FormatProgress } from './fat32'
import { formatWindows } from './winraw'
import type { FormatResult, Filesystem, Locale } from '../shared/types'
import { translate, TranslationKey, TranslationVars } from '../shared/i18n'

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

/**
 * Everything formatDisk() needs about the disk and the requested format.
 * `mountpoint` is carried through from the renderer for diagnostics; the
 * format logic itself re-derives the volume from the disk number.
 */
export interface FormatRequest {
  device: string
  size: number
  label: string
  filesystem: Filesystem
  fullFormat: boolean
  mountpoint: string | null
  locale?: Locale
}

/**
 * Callbacks formatDisk() fires into the IPC layer (ipc.ts) so the renderer
 * can show log lines and a live progress bar, and cancel a running format.
 */
export interface FormatCallbacks {
  log: (level: 'info' | 'success' | 'warn' | 'error', message: string) => void
  progress: (p: FormatProgress) => void
  cancel?: CancelToken
}

// Pulls the trailing disk number out of a \\.\PhysicalDriveN path; the
// Windows Storage module cmdlets address disks by number, not by path.
function diskNumberFromWindowsDevice(device: string): number | null {
  const m = /PhysicalDrive(\d+)/i.exec(device)
  return m ? Number(m[1]) : null
}

// After Clear-Disk/Format-Volume the partition has no drive letter, so the
// volume is invisible until Explorer picks it up. Detach and re-add the
// partition access path to force Windows to (re)assign a letter.
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

// Windows formatting goes through the Storage module (the same stack Windows
// Disk Management uses) so the OS itself handles locking/dismounting volumes.
// This avoids the raw-write restrictions of KB 942448 entirely. The only raw
// device write left is the optional full-format zero pass, which runs right
// after Clear-Disk removes every volume - with no mounted file system the
// kernel allows the physical drive write and we keep byte-level progress and
// cancellation for the slow part. The filesystem itself is created by Windows'
// own Format-Volume rather than by our byte-level structure builder.
async function formatWindowsDisk(
  req: FormatRequest,
  cb: FormatCallbacks,
  t: (key: TranslationKey, vars?: TranslationVars) => string
): Promise<void> {
  const diskNumber = diskNumberFromWindowsDevice(req.device)
  if (diskNumber === null) {
    throw new Error(`Cannot determine Windows disk number from ${req.device}`)
  }
  const fsName = req.filesystem === 'exfat' ? 'exFAT' : 'FAT32'
  // Single quotes are doubled so the label survives the PowerShell string
  // literal below instead of terminating it early.
  const label = (req.filesystem === 'exfat' ? sanitizeExfatLabel(req.label) : sanitizeLabel(req.label)).replace(/'/g, "''")

  cb.log('info', t('format.partitionTable'))
  cb.progress({ stage: t('format.partitionTable'), bytesWritten: 0, totalBytes: 0 })
  // Clear-Disk drops every partition/OEM signature. With no mounted file
  // system left, the kernel permits the raw zero pass below (KB 942448 only
  // blocks writes into mounted volumes).
  await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$ErrorActionPreference = 'Stop'; Clear-Disk -Number ${diskNumber} -RemoveData -RemoveOEM -Confirm:$false`
  ])

  if (req.fullFormat) {
    cb.log('info', t('format.full'))
    await formatWindows({
      device: req.device,
      structure: Buffer.alloc(0),
      totalBytes: req.size,
      fullFormat: true,
      letter: null,
      cancel: cb.cancel,
      onProgress: (p) =>
        cb.progress({ stage: t('format.full'), bytesWritten: p.bytesWritten, totalBytes: p.totalBytes })
    })
  }

  cb.log('info', t('format.fats'))
  cb.progress({ stage: t('format.fats'), bytesWritten: 0, totalBytes: 0 })
  // A cleared disk has no partition style, so it must be initialised as MBR
  // before New-Partition can create the single FAT32/exFAT partition.
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    `$d = Get-Disk -Number ${diskNumber}`,
    `if ($d.PartitionStyle -eq 'RAW') { Initialize-Disk -Number ${diskNumber} -PartitionStyle MBR }`,
    `$p = New-Partition -DiskNumber ${diskNumber} -UseMaximumSize -AssignDriveLetter`,
    `Format-Volume -Partition $p -FileSystem ${fsName} -NewFileSystemLabel '${label}' -Confirm:$false`
  ].join('; ')
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps])
}

// exFAT on macOS/Linux is created with the platform's native tools rather than
// our FAT32 structure builder (exFAT's layout is too complex to hand-build):
// macOS uses diskutil, Linux uses sfdisk to create one MBR partition followed
// by mkfs.exfat. The optional full-format pass zeroes the whole device first.
async function formatExfatPosix(
  req: FormatRequest,
  cb: FormatCallbacks,
  t: (key: TranslationKey, vars?: TranslationVars) => string,
  writeDevice: string
): Promise<void> {
  const label = sanitizeExfatLabel(req.label)
  const platform = process.platform

  if (req.fullFormat) {
    cb.log('info', t('format.full'))
    await zeroDevice(writeDevice, req.size, {
      cancel: cb.cancel,
      emit: (_stage, bytesWritten, totalBytes) =>
        cb.progress({ stage: t('format.full'), bytesWritten, totalBytes })
    })
  }

  if (platform === 'darwin') {
    cb.log('info', t('format.fats'))
    cb.progress({ stage: t('format.fats'), bytesWritten: 0, totalBytes: 0 })
    // eraseDisk rebuilds the whole disk (partition map + exFAT volume) in a
    // single call, so no separate partition-table step is needed on macOS.
    await run('diskutil', ['eraseDisk', 'EXFAT', label, req.device])
  } else {
    cb.log('info', t('format.partitionTable'))
    cb.progress({ stage: t('format.partitionTable'), bytesWritten: 0, totalBytes: 0 })
    // sfdisk input ',,L' means: whole disk, any start, type L (Linux). The
    // MBR is created here because mkfs.exfat formats a partition, not a disk;
    // --wipe=always clears any leftover signatures first.
    await run('bash', ['-c', `printf ',,L\\n' | sfdisk --wipe=always --label dos '${req.device}'`])
    cb.log('info', t('format.fats'))
    cb.progress({ stage: t('format.fats'), bytesWritten: 0, totalBytes: 0 })
    const part = partitionDeviceFor(req.device)
    await run('mkfs.exfat', ['-n', label, part])
  }
}

// Converts a whole-disk path to its first partition. mmcblk/NVMe-style nodes
// already end in a digit, so the partition suffix is 'p1' rather than '1'.
function partitionDeviceFor(device: string): string {
  const d = device.replace(/[\\/]+$/, '')
  return /\d$/.test(d) ? `${d}p1` : `${d}1`
}

// mkfs and raw writes need the device entirely unmounted, so every mountpoint
// reported by lsblk for the disk is unmounted (best-effort per partition).
async function unmountLinux(device: string): Promise<void> {
  // unmount any mounted partitions of the disk
  const out = await run('lsblk', ['-n', '-o', 'MOUNTPOINT', device]).catch(() => '')
  const mounts = out.split('\n').map((s) => s.trim()).filter(Boolean)
  for (const m of mounts) {
    await run('umount', [m]).catch(() => undefined)
  }
}

// Re-reads the partition table so the new partition appears without a reboot.
async function remountLinux(device: string): Promise<void> {
  try {
    await run('partprobe', [device])
  } catch {
    // partprobe may be unavailable; harmless
  }
}

// diskutil unmountDisk/mountDisk unmount and remount every volume on the
// device; unmounting is required before the raw zero/write pass below.
async function unmountMacos(device: string): Promise<void> {
  await run('diskutil', ['unmountDisk', device]).catch(() => undefined)
}

// Brings the freshly formatted volume back online so the copy step can use it.
async function remountMacos(device: string): Promise<void> {
  await run('diskutil', ['mountDisk', device]).catch(() => undefined)
}

/**
 * Formats a physical volume. Entry point for the 'format' step of the app
 * flow (IPC handler 'format:run' in ipc.ts). Dispatch by platform:
 *
 * - Windows: Storage module cmdlets, with an optional raw zero pass first.
 * - macOS/Linux: unmount the device, then either the in-house FAT32 writer or
 *   the native exFAT tools.
 *
 * @param req device path, size, label, filesystem and quick/full flag
 * @param cb logging/progress/cancel callbacks wired to the renderer
 * @returns FormatResult describing success or the failure message
 */
export async function formatDisk(req: FormatRequest, cb: FormatCallbacks): Promise<FormatResult> {
  const device = req.device
  const platform = process.platform
  const locale = req.locale ?? 'en'
  const t = (key: TranslationKey, vars?: TranslationVars): string => translate(locale, key, vars)
  let writeDevice = device

  try {
    cb.log('info', t('format.start', { device, size: (req.size / 1024 / 1024 / 1024).toFixed(2) }))

    if (platform === 'win32') {
      await formatWindowsDisk(req, cb, t)
    } else {
      if (platform === 'darwin') {
        await unmountMacos(device)
        // Raw writes use the character device /dev/rdisk* (unbuffered, faster);
        // diskutil and the file system still use the buffered /dev/disk* node.
        writeDevice = device.replace(/^\/dev\/disk/, '/dev/rdisk')
      } else {
        await unmountLinux(device)
      }

      if (req.filesystem === 'exfat') {
        await formatExfatPosix(req, cb, t, writeDevice)
      } else {
        let lastStage = ''
        cb.log('info', t('format.structures', { device: writeDevice }))
        await formatDevice(writeDevice, req.size, {
          label: req.label,
          fullFormat: req.fullFormat,
          // A quick format is too fast to need cancellation, so the token is
          // only passed through for the slow full-format zero pass.
          cancel: req.fullFormat ? cb.cancel : undefined,
          onProgress: (p) => {
            // Map the writer's English stage names to translated UI strings;
            // a couple of names below are legacy stages the current writer no
            // longer emits, kept so older progress events still render.
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
      }
    }

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
