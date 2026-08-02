import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DriveInfo } from '../shared/types'

const execFileAsync = promisify(execFile)

function run(cmd: string, args: string[]): Promise<string> {
  return execFileAsync(cmd, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }).then(
    (r) => r.stdout,
    (e) => {
      throw new Error(`${cmd} failed: ${e.message}`)
    }
  )
}

async function listWindows(): Promise<DriveInfo[]> {
  const script = [
    '$ErrorActionPreference = "SilentlyContinue";',
    'Get-Volume | Where-Object { $_.DriveLetter } | ForEach-Object {',
    '  $v = $_;',
    '  $p = Get-Partition -DriveLetter $v.DriveLetter;',
    '  if (-not $p) { return };',
    '  $d = Get-Disk -Number $p.DiskNumber;',
    '  if (-not $d) { return };',
    '  $rem = $false;',
    '  try { $rem = $d.BusType -in @("USB","SD","FireWire","Thunderbolt") } catch {};',
    '  [pscustomobject]@{',
    '    id = "disk$($d.Number)";',
    '    name = $d.FriendlyName;',
    '    device = "\\\\.\\PhysicalDrive$($d.Number)";',
    '    mountpoint = "$($v.DriveLetter):\\";',
    '    size = $d.Size;',
    '    free = $v.SizeRemaining;',
    '    filesystem = $v.FileSystem;',
    '    volumeLabel = $v.FileSystemLabel;',
    '    removable = $rem;',
    '    isSystem = $d.IsSystem;',
    '    diskNumber = $d.Number',
    '  }',
    '} | ConvertTo-Json -Compress'
  ].join(' ')
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
  return parseJsonList<DriveInfo>(out)
}

async function listLinux(): Promise<DriveInfo[]> {
  const out = await run('lsblk', ['-b', '-J', '-o', 'NAME,SIZE,TYPE,RM,PATH,MOUNTPOINTS,MODEL,FSTYPE,LABEL'])
  let data: any
  try {
    data = JSON.parse(out)
  } catch {
    return []
  }
  const drives: DriveInfo[] = []
  const blocks = data.blockdevices ?? []
  for (const b of blocks) {
    if (b.type !== 'part') continue
    if (!b.path) continue
    const mount = Array.isArray(b.mountpoints) ? b.mountpoints.find(Boolean) : b.mountpoints
    if (!mount) continue
    const parentName = b.name.replace(/p?\d+$/, '')
    const parent = blocks.find((x: any) => x.name === parentName)
    drives.push({
      id: b.path,
      name: (b.model ?? parentName).trim(),
      device: parent?.path ?? `/dev/${parentName}`,
      mountpoint: mount,
      size: Number(b.size ?? 0),
      free: null,
      filesystem: b.fstype ?? null,
      volumeLabel: b.label ?? null,
      removable: parent ? Number(parent.rm ?? 0) === 1 : false,
      isSystem: false
    })
  }
  return drives
}

async function listMacos(): Promise<DriveInfo[]> {
  const out = await run('diskutil', ['list', '-plist'])
  const plist = parsePlist(out)
  const drives: DriveInfo[] = []
  const all = plist.AllDisksAndPartitions ?? []
  for (const disk of all) {
    const wholePath = `/dev/${disk.DeviceIdentifier}`
    const info = parsePlist(await run('diskutil', ['info', '-plist', wholePath]))
    const isInternal = info.Internal === true
    if (isInternal) continue
    const size = Number(disk.Size ?? 0)
    for (const part of disk.Partitions ?? []) {
      const partId = part.DeviceIdentifier
      const partInfo = parsePlist(await run('diskutil', ['info', '-plist', `/dev/${partId}`]))
      const mount = partInfo.MountPoint
      if (!mount) continue
      drives.push({
        id: `/dev/${partId}`,
        name: `${info.DeviceNode ?? wholePath} ${disk.DeviceIdentifier}`,
        device: wholePath,
        mountpoint: mount,
        size,
        free: null,
        filesystem: partInfo.FileSystemType ?? null,
        volumeLabel: partInfo.VolumeName ?? null,
        removable: true,
        isSystem: false
      })
    }
  }
  return drives
}

export async function listDrives(): Promise<DriveInfo[]> {
  try {
    if (process.platform === 'win32') {
      const drives = await listWindows()
      return drives.filter((d) => d.mountpoint)
    }
    if (process.platform === 'darwin') {
      const drives = await listMacos()
      return drives
    }
    const drives = await listLinux()
    return drives
  } catch {
    return []
  }
}

export function freeSpaceOf(path: string): Promise<number | null> {
  return import('node:fs').then((fs) => {
    try {
      const s = fs.statfsSync(path)
      return s.bavail * s.bsize
    } catch {
      return null
    }
  })
}

function parseJsonList<T>(text: string): T[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const parsed = JSON.parse(trimmed)
  return Array.isArray(parsed) ? (parsed as T[]) : [parsed as T]
}

function parsePlist(xml: string): Record<string, any> {
  const result: Record<string, any> = {}
  const re = /<key>([^<]+)<\/key>\s*(<true\/>|<false\/>|<(?:string|integer|real)>([^<]*)<\/)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    let val: any = m[2] === '<true/>' ? true : m[2] === '<false/>' ? false : m[3]
    const block = m[2]
    if (block.includes('<integer>')) val = Number(val)
    else if (block.includes('<real>')) val = Number(val)
    result[m[1]] = val
  }
  return result
}
