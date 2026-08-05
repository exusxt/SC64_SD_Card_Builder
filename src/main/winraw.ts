// Windows raw physical-disk I/O for the full-format zero pass.
//
// Embeds a PowerShell script that opens \\.\PhysicalDriveN exclusively with
// CreateFileW, locks/dismounts any volume on it, then streams the structure
// or zeros straight to the disk via WriteFile. It runs as a child process so
// progress lines stream back and the process can be killed on cancel. The
// FAT32 layout on Windows is made by Format-Volume, not by this helper.
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CancelToken, FormatProgress } from './fat32'

// Streams zeros over a physical drive through an exclusively opened handle.
//
// This is only used on Windows for the optional full-format zero pass, and it
// runs right after Clear-Disk has removed every volume from the disk. With no
// mounted file system the kernel allows direct writes to the physical device
// (KB 942448 only restricts writes into a mounted file system), so the volume
// locking/FSCTL section below is a no-op in practice but is kept as a safety
// net in case a volume lingers. Opening the device exclusively can briefly
// fail with a sharing violation while the storage stack or antivirus still
// hold the drive, so the open is retried with backoff. The FAT32 layout on
// Windows is created by Format-Volume afterwards, not by this helper.
const RAW_WRITE_SCRIPT = [
  'param(',
  '  [string]$Device,',
  '  [string]$Prefix,',
  '  [long]$StructureBytes,',
  '  [long]$TotalBytes,',
  '  [string]$Letter,',
  '  [switch]$FullFormat',
  ')',
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class RawWin32 {',
  '  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]',
  '  public static extern IntPtr CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode, IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);',
  '  [DllImport("kernel32.dll", SetLastError=true)]',
  '  public static extern bool DeviceIoControl(IntPtr hDevice, uint dwIoControlCode, IntPtr lpInBuffer, uint nInBufferSize, IntPtr lpOutBuffer, uint nOutBufferSize, out uint lpBytesReturned, IntPtr lpOverlapped);',
  '  [DllImport("kernel32.dll", SetLastError=true)]',
  '  public static extern bool SetFilePointerEx(IntPtr hFile, long liDistanceToMove, out long lpNewFilePointer, uint dwMoveMethod);',
  '  [DllImport("kernel32.dll", SetLastError=true)]',
  '  public static extern bool WriteFile(IntPtr hFile, byte[] lpBuffer, uint nNumberOfBytesToWrite, out uint lpNumberOfBytesWritten, IntPtr lpOverlapped);',
  '  [DllImport("kernel32.dll", SetLastError=true)]',
  '  public static extern bool FlushFileBuffers(IntPtr hFile);',
  '  [DllImport("kernel32.dll", SetLastError=true)]',
  '  public static extern bool CloseHandle(IntPtr hObject);',
  '}',
  "'@",
  '$DESIRED_ACCESS = [uint32]3221225472', // GENERIC_READ | GENERIC_WRITE (0xC0000000); devices cannot be opened read-only
  '$VOLUME_SHARE = [uint32]3', // FILE_SHARE_READ | FILE_SHARE_WRITE so the lock handle can open even while Explorer has the volume
  '$OPEN_EXISTING = [uint32]3', // OPEN_EXISTING is required for device handles
  '$FILE_FLAG_WRITE_THROUGH = [uint32]2147483648', // bypass the OS cache so the writes actually reach the media
  '$FSCTL_LOCK_VOLUME = [uint32]589848', // 0x00090018 - excludes other I/O on the volume
  '$FSCTL_DISMOUNT_VOLUME = [uint32]589856', // 0x00090020 - forces the volume offline
  'function Write-DeviceBytes([IntPtr]$Handle, [byte[]]$Data) {',
  '  $written = [uint32]0',
  '  if (-not [RawWin32]::WriteFile($Handle, $Data, [uint32]$Data.Length, [ref]$written, [IntPtr]::Zero)) {',
  '    throw ("WriteFile failed: Win32 error " + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error())',
  '  }',
  '  if ($written -ne $Data.Length) { throw "WriteFile wrote $written of $($Data.Length) bytes" }',
  '}',
  // Locks and dismounts one volume by drive letter. Returns a zero handle when
  // the volume has no file system yet (ERROR_FILE_NOT_FOUND, 2) - there is
  // nothing to lock in that case.
  'function Open-LockedVolume([string]$letter) {',
  '  $volPath = "\\\\.\\$($letter):"',
  '  $vh = [RawWin32]::CreateFileW($volPath, $DESIRED_ACCESS, $VOLUME_SHARE, [IntPtr]::Zero, $OPEN_EXISTING, 0, [IntPtr]::Zero)',
  '  if ($vh.ToInt64() -eq -1) {',
  '    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()',
  '    if ($err -eq 2) { return [IntPtr]::Zero }',
  '    throw ("Cannot open volume " + $volPath + " for locking: Win32 error " + $err)',
  '  }',
  '  $ret = [uint32]0',
  '  if (-not [RawWin32]::DeviceIoControl($vh, $FSCTL_LOCK_VOLUME, [IntPtr]::Zero, 0, [IntPtr]::Zero, 0, [ref]$ret, [IntPtr]::Zero)) {',
  '    [void][RawWin32]::CloseHandle($vh)',
  '    throw ("FSCTL_LOCK_VOLUME failed on " + $volPath + ": Win32 error " + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error())',
  '  }',
  '  $dismounted = $false',
  '  $lastErr = [int]0',
  // Dismount can fail with ERROR_NOT_READY (21) while the file system is
  // still finishing I/O, so it is retried briefly before giving up.
  '  for ($i = 0; $i -lt 5; $i++) {',
  '    if ([RawWin32]::DeviceIoControl($vh, $FSCTL_DISMOUNT_VOLUME, [IntPtr]::Zero, 0, [IntPtr]::Zero, 0, [ref]$ret, [IntPtr]::Zero)) {',
  '      $dismounted = $true',
  '      break',
  '    }',
  '    $lastErr = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()',
  '    if ($lastErr -ne 21) { break }',
  '    Start-Sleep -Milliseconds 200',
  '  }',
  '  if (-not $dismounted) {',
  '    [void][RawWin32]::CloseHandle($vh)',
  '    throw ("FSCTL_DISMOUNT_VOLUME failed on " + $volPath + ": Win32 error " + $lastErr)',
  '  }',
  '  return $vh',
  '}',
  '$held = New-Object System.Collections.Generic.List[object]',
  '$seen = New-Object System.Collections.Generic.HashSet[string]',
  '$mm = [regex]::Match($Device, "(?i)PhysicalDrive(\\d+)")',
  '$diskNum = ""',
  'if ($mm.Success) { $diskNum = $mm.Groups[1].Value }',
  'if ($diskNum -ne "") {',
  '  $partLetters = @(Get-Partition -DiskNumber ([int]$diskNum) -ErrorAction SilentlyContinue | Where-Object { "$($_.DriveLetter)" -match "^[a-zA-Z]$" })',
  '  foreach ($p in $partLetters) {',
  '    $pl = ("{0}:" -f $p.DriveLetter)',
  '    if ($seen.Add($pl)) {',
  '      $vh = Open-LockedVolume ("{0}" -f $p.DriveLetter)',
  '      if ($vh.ToInt64() -ne 0) { $held.Add($vh) }',
  '    }',
  '  }',
  '}',
  'if ($Letter) {',
  '  if ($seen.Add(("{0}:" -f $Letter))) {',
  '    $vh = Open-LockedVolume $Letter',
  '    if ($vh.ToInt64() -ne 0) { $held.Add($vh) }',
  '  }',
  '}',
  '$h = [IntPtr]::Zero',
  'try {',
  // The physical drive is opened with dwShareMode 0 (exclusive) so nothing
  // else can touch the disk while we write. Error 32 is ERROR_SHARING_VIOLATION
  // - Explorer or antivirus may still hold the drive briefly, so retry before
  // failing rather than after.
  '  for ($i = 0; $i -lt 20; $i++) {',
  '    $h = [RawWin32]::CreateFileW($Device, $DESIRED_ACCESS, 0, [IntPtr]::Zero, $OPEN_EXISTING, $FILE_FLAG_WRITE_THROUGH, [IntPtr]::Zero)',
  '    if ($h.ToInt64() -ne -1) { break }',
  '    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()',
  '    if ($err -ne 32) { break }',
  '    Start-Sleep -Milliseconds 500',
  '  }',
  '  if ($h.ToInt64() -eq -1) {',
  '    throw ("Cannot open " + $Device + " exclusively: Win32 error " + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error())',
  '  }',
  '  $src = [System.IO.File]::OpenRead($Prefix)',
  '  try {',
  '    $buffer = New-Object byte[] 1048576',
  '    $offset = [long]0',
  '    while ($true) {',
  '      $read = $src.Read($buffer, 0, $buffer.Length)',
  '      if ($read -le 0) { break }',
  '      $data = $buffer',
  '      if ($read -lt $buffer.Length) {',
  '        $data = New-Object byte[] $read',
  '        [Array]::Copy($buffer, 0, $data, 0, $read)',
  '      }',
  // Seek explicitly before every write: SetFilePointerEx takes a 64-bit long
  // offset, which is what keeps writes at byte positions beyond the 2 GiB
  // (32-bit) limit possible on large cards.
  '      $newPos = [long]0',
  '      [void][RawWin32]::SetFilePointerEx($h, $offset, [ref]$newPos, 0)',
  '      Write-DeviceBytes $h $data',
  '      $offset += $read',
  "      Write-Output ('PROGRESS {0} {1}' -f $offset, $StructureBytes)",
  '    }',
  '  } finally {',
  '    $src.Close()',
  '  }',
  '  if ($FullFormat) {',
  // Zero from wherever the structure write stopped to the end of the device,
  // rounded down to a whole sector so no partial final sector is written.
  '    $zeroEnd = $TotalBytes - ($TotalBytes % 512)',
  '    $zero = New-Object byte[] 16777216',
  '    while ($offset -lt $zeroEnd) {',
  '      $len = [int]([Math]::Min([long]$zero.Length, $zeroEnd - $offset))',
  '      $chunk = New-Object byte[] $len',
  '      $newPos = [long]0',
  '      [void][RawWin32]::SetFilePointerEx($h, $offset, [ref]$newPos, 0)',
  '      Write-DeviceBytes $h $chunk',
  '      $offset += $len',
  "      Write-Output ('PROGRESS {0} {1}' -f $offset, $TotalBytes)",
  '    }',
  '  }',
  // FlushFileBuffers pushes the write-through I/O out of the storage stack so
  // the device is fully committed before we report success.
  '  [void][RawWin32]::FlushFileBuffers($h)',
  "  Write-Output 'DONE'",
  '} finally {',
  '  if ($h.ToInt64() -ne -1) { [void][RawWin32]::CloseHandle($h) }',
  '  foreach ($vh in $held) { [void][RawWin32]::CloseHandle($vh) }',
  '}'
].join('\n')

/**
 * Inputs for formatWindows(). `structure` is the byte-level layout to stream
 * first (empty for the zero-only full-format pass); `letter` optionally names
 * a volume to lock/dismount; `fullFormat` triggers the whole-device zero pass.
 */
export interface WindowsFormatOptions {
  device: string
  structure: Buffer
  totalBytes: number
  fullFormat: boolean
  letter?: string | null
  cancel?: CancelToken
  onProgress?: (p: FormatProgress) => void
}

/**
 * Streams a structure prefix to a Windows physical drive and optionally zeroes
 * the whole device. The work runs in a child PowerShell process so progress
 * lines can be parsed as they arrive and the child can be killed on cancel;
 * the structure is staged to a temp file because the script reads it as a
 * byte stream.
 *
 * @param opts device path, structure, size, flags and progress/cancel hooks
 */
export async function formatWindows(opts: WindowsFormatOptions): Promise<void> {
  // Stage the script and structure in a temp dir so the child process can
  // read them as plain files; the dir is removed once the child exits.
  const dir = await mkdtemp(path.join(tmpdir(), 'sc64-format-'))
  const prefixFile = path.join(dir, 'structure.bin')
  const scriptFile = path.join(dir, 'raw-write.ps1')
  try {
    await writeFile(prefixFile, opts.structure)
    await writeFile(scriptFile, RAW_WRITE_SCRIPT)
    await spawnRawWriter(scriptFile, prefixFile, opts)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

// Spawns the embedded PowerShell script. Progress lines are parsed from
// stdout ('PROGRESS <bytes> <total>'), and a poller checks the cancel token
// so an in-flight raw write can be aborted by killing the child.
function spawnRawWriter(
  scriptFile: string,
  prefixFile: string,
  opts: WindowsFormatOptions
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptFile,
      '-Device',
      opts.device,
      '-Prefix',
      prefixFile,
      '-StructureBytes',
      String(opts.structure.length),
      '-TotalBytes',
      String(opts.totalBytes)
    ]
    // Only accept a well-formed drive letter like 'D:' for the volume lock.
    const letter = opts.letter?.trim().replace(/[\\/]+$/, '')
    if (letter && /^[a-zA-Z]:$/.test(letter)) args.push('-Letter', letter[0])
    if (opts.fullFormat) args.push('-FullFormat')

    const child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let pending = ''

    const cancelTimer = setInterval(() => {
      if (opts.cancel?.cancelled) {
        clearInterval(cancelTimer)
        child.kill()
        reject(new Error('Format cancelled'))
      }
    }, 150)

    child.stdout.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8')
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const m = /^PROGRESS (\d+) (\d+)/.exec(line)
        if (!m) continue
        const bytesWritten = Number(m[1])
        const totalBytes = Number(m[2])
        // The first phase (writing the structure prefix) reports the prefix
        // length as its total, which is how we tell it apart from the zero pass.
        opts.onProgress?.({
          stage: totalBytes === opts.structure.length ? 'Writing partition table' : 'Full format',
          bytesWritten,
          totalBytes
        })
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (err) => {
      clearInterval(cancelTimer)
      reject(err)
    })

    child.on('close', (code) => {
      clearInterval(cancelTimer)
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `Raw device write failed (exit code ${code})`))
    })
  })
}
