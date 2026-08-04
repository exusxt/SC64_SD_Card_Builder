import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CancelToken, FormatProgress } from './fat32'

// Streams a prebuilt structure (and optionally zeroes the rest of the disk)
// into a physical drive using an exclusive handle. Node's fs.open opens with
// shared access, and Windows (KB 942448) rejects raw writes past the MBR unless
// the device is opened with no sharing (dwShareMode = 0). .NET's FileStream
// with FileShare.None does exactly that.
const RAW_WRITE_SCRIPT = [
  'param(',
  '  [string]$Device,',
  '  [string]$Prefix,',
  '  [long]$StructureBytes,',
  '  [long]$TotalBytes,',
  '  [switch]$FullFormat',
  ')',
  "$ErrorActionPreference = 'Stop'",
  '$options = [System.IO.FileOptions]::WriteThrough -bor [System.IO.FileOptions]::RandomAccess',
  '$stream = [System.IO.FileStream]::new($Device, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None, 1048576, $options)',
  'try {',
  '  $src = [System.IO.File]::OpenRead($Prefix)',
  '  try {',
  '    $buffer = New-Object byte[] 1048576',
  '    while ($true) {',
  '      $read = $src.Read($buffer, 0, $buffer.Length)',
  '      if ($read -le 0) { break }',
  '      $stream.Write($buffer, 0, $read)',
  "      Write-Output ('PROGRESS {0} {1}' -f $stream.Position, $StructureBytes)",
  '    }',
  '  } finally {',
  '    $src.Close()',
  '  }',
  '  if ($FullFormat) {',
  '    $zero = New-Object byte[] 16777216',
  '    while ($stream.Position -lt $TotalBytes) {',
  '      $remaining = $TotalBytes - $stream.Position',
  '      if ($remaining -lt $zero.Length) {',
  '        $stream.Write($zero, 0, [int]$remaining)',
  '      } else {',
  '        $stream.Write($zero, 0, $zero.Length)',
  '      }',
  "      Write-Output ('PROGRESS {0} {1}' -f $stream.Position, $TotalBytes)",
  '    }',
  '  }',
  '  $stream.Flush($true)',
  "  Write-Output 'DONE'",
  '} finally {',
  '  $stream.Close()',
  '}'
].join('\n')

export interface WindowsFormatOptions {
  device: string
  structure: Buffer
  totalBytes: number
  fullFormat: boolean
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
