import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CancelToken, FormatProgress } from './fat32'

// Streams a prebuilt structure (and optionally zeroes the rest of the disk)
// into a physical drive through an exclusively opened handle.
//
// Node's fs.open opens with shared access, and Windows (KB 942448) refuses raw
// writes into a mounted file system. Every volume on the target disk must be
// locked + dismounted via FSCTL on its drive letter, and those volume handles
// are kept open (locked) for the whole write: closing them would release the
// lock and let Windows remount the volume, which blocks the physical write
// with ERROR_ACCESS_DENIED. The physical drive handle is then opened
// exclusively and written. Opening exclusively can briefly fail with a
// sharing violation while the storage stack or antivirus still hold the
// drive, so the exclusive open is retried with backoff. The drive letter is
// deliberately left in place (format.ts does not run mountvol /p, which would
// remove the letter the writer needs to address the volume).
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
  '$DESIRED_ACCESS = [uint32]3221225472',
  '$VOLUME_SHARE = [uint32]3',
  '$OPEN_EXISTING = [uint32]3',
  '$FILE_FLAG_WRITE_THROUGH = [uint32]2147483648',
  '$FSCTL_LOCK_VOLUME = [uint32]589848',
  '$FSCTL_DISMOUNT_VOLUME = [uint32]589856',
  'function Write-DeviceBytes([IntPtr]$Handle, [byte[]]$Data) {',
  '  $written = [uint32]0',
  '  if (-not [RawWin32]::WriteFile($Handle, $Data, [uint32]$Data.Length, [ref]$written, [IntPtr]::Zero)) {',
  '    throw ("WriteFile failed: Win32 error " + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error())',
  '  }',
  '  if ($written -ne $Data.Length) { throw "WriteFile wrote $written of $($Data.Length) bytes" }',
  '}',
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
  '  [void][RawWin32]::FlushFileBuffers($h)',
  "  Write-Output 'DONE'",
  '} finally {',
  '  if ($h.ToInt64() -ne -1) { [void][RawWin32]::CloseHandle($h) }',
  '  foreach ($vh in $held) { [void][RawWin32]::CloseHandle($vh) }',
  '}'
].join('\n')

export interface WindowsFormatOptions {
  device: string
  structure: Buffer
  totalBytes: number
  fullFormat: boolean
  letter?: string | null
  cancel?: CancelToken
  onProgress?: (p: FormatProgress) => void
}

export async function formatWindows(opts: WindowsFormatOptions): Promise<void> {
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
