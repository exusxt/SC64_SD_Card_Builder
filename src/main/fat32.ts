import { open } from 'node:fs/promises'
import { formatWindows } from './winraw'

const SECTOR_SIZE = 512
const PARTITION_START = 2048
const RESERVED = 32
const NUM_FATS = 2
const ROOT_CLUSTER = 2
const FSINFO_SECTOR = 1
const BACKUP_BOOT = 6
const ZERO_CHUNK = 4 * 1024 * 1024

export interface Fat32Layout {
  spc: number
  bytesPerCluster: number
  fatSize: number
  totalClusters: number
  partSectors: number
  partBytes: number
  dataStartSector: number
  partStartSector: number
}

export function computeLayout(sizeBytes: number): Fat32Layout {
  if (!Number.isFinite(sizeBytes) || sizeBytes < PARTITION_START * SECTOR_SIZE + 1024 * 1024) {
    throw new Error(`Drive size (${sizeBytes} bytes) is too small to format as FAT32.`)
  }
  const partSectors = Math.floor((sizeBytes - PARTITION_START * SECTOR_SIZE) / SECTOR_SIZE)
  const partBytes = partSectors * SECTOR_SIZE

  let clusterBytes = Math.ceil(Math.log2(Math.max(partBytes / 2 ** 22, 4096)) / Math.log2(2))
  clusterBytes = Math.max(12, Math.min(clusterBytes, 15)) // 4KB .. 32KB
  const bytesPerCluster = 2 ** clusterBytes
  const spc = bytesPerCluster / SECTOR_SIZE

  let fatSize = 0
  let totalClusters = 0
  for (let i = 0; i < 8; i++) {
    const dataSectors = partSectors - (RESERVED + NUM_FATS * fatSize)
    totalClusters = Math.floor(dataSectors / spc)
    const nextFatSize = Math.ceil(((totalClusters + 2) * 4) / SECTOR_SIZE)
    if (nextFatSize === fatSize) break
    fatSize = nextFatSize
  }

  const dataStartSector = PARTITION_START + RESERVED + NUM_FATS * fatSize
  return {
    spc,
    bytesPerCluster,
    fatSize,
    totalClusters,
    partSectors,
    partBytes,
    dataStartSector,
    partStartSector: PARTITION_START
  }
}

function sanitizeLabel(label: string): string {
  const cleaned = (label || 'SUMMERCART').toUpperCase().replace(/[^\x20-\x7E]/g, '').trim()
  return (cleaned || 'SUMMERCART').padEnd(11, ' ').slice(0, 11)
}

function buildMBR(partSectors: number): Buffer {
  const mbr = Buffer.alloc(SECTOR_SIZE)
  // status 0x00 (not bootable)
  mbr[446] = 0x00
  // start CHS (head, sector, cylinder) — LBA addressing used, these are best-effort
  mbr[447] = 0x00
  mbr[448] = 0x08
  mbr[449] = 0x00
  mbr[450] = 0x0c // partition type: FAT32 LBA
  mbr[451] = 0xfe
  mbr[452] = 0xff
  mbr[453] = 0xff
  mbr.writeUInt32LE(PARTITION_START, 454)
  mbr.writeUInt32LE(partSectors, 458)
  mbr.writeUInt16LE(0xaa55, 510)
  return mbr
}

function buildBPB(layout: Fat32Layout, label: string): Buffer {
  const b = Buffer.alloc(SECTOR_SIZE)
  b[0] = 0xeb
  b[1] = 0x58
  b[2] = 0x90
  b.write('MSDOS5.0', 3, 'ascii')
  b.writeUInt16LE(SECTOR_SIZE, 11)
  b[13] = layout.spc
  b.writeUInt16LE(RESERVED, 14)
  b[16] = NUM_FATS
  b.writeUInt16LE(0, 17) // root entry count (0 for FAT32)
  b.writeUInt16LE(0, 19) // totalSectors16
  b[21] = 0xf8
  b.writeUInt16LE(0, 22) // fatSize16
  b.writeUInt16LE(32, 24) // sectors per track
  b.writeUInt16LE(64, 26) // number of heads
  b.writeUInt32LE(PARTITION_START, 28) // hidden sectors
  b.writeUInt32LE(layout.partSectors, 32) // totalSectors32
  b.writeUInt32LE(layout.fatSize, 36) // fatSize32
  b.writeUInt16LE(0, 40) // ext flags
  b.writeUInt16LE(0, 42) // fs version
  b.writeUInt32LE(ROOT_CLUSTER, 44)
  b.writeUInt16LE(FSINFO_SECTOR, 48)
  b.writeUInt16LE(BACKUP_BOOT, 50)
  b[64] = 0x80 // drive number
  b[66] = 0x29 // extended boot signature
  b.writeUInt32LE((Math.random() * 0xffffffff) >>> 0, 67)
  b.write(sanitizeLabel(label), 71, 'ascii')
  b.write('FAT32   ', 82, 'ascii')
  b.writeUInt16LE(0xaa55, 510)
  return b
}

function buildFSInfo(totalClusters: number): Buffer {
  const f = Buffer.alloc(SECTOR_SIZE)
  f.write('RRaA', 0, 'ascii')
  f.write('rrAa', 484, 'ascii')
  f.writeUInt32LE(Math.max(0, totalClusters - 1), 488)
  f.writeUInt32LE(ROOT_CLUSTER, 492)
  f.writeUInt16LE(0xaa55, 510)
  return f
}

function buildFAT(fatSize: number): Buffer {
  const fat = Buffer.alloc(fatSize * SECTOR_SIZE)
  fat.writeUInt32LE(0x0ffffff8, 0) // media descriptor
  fat.writeUInt32LE(0x0fffffff, 4) // reserved
  fat.writeUInt32LE(0x0fffffff, 8) // root directory cluster = EOC
  return fat
}

export interface FormatProgress {
  stage: string
  bytesWritten: number
  totalBytes: number
}

export interface CancelToken {
  cancelled: boolean
}

export interface FormatDeviceOptions {
  label: string
  fullFormat: boolean
  onProgress?: (p: FormatProgress) => void
  cancel?: CancelToken
}

async function writeAt(handle: Awaited<ReturnType<typeof open>>, buffer: Buffer, offset: number, length?: number): Promise<void> {
  let written = 0
  const total = length ?? buffer.length
  while (written < total) {
    const res = await handle.write(buffer, written, total - written, offset + written)
    if (res.bytesWritten <= 0) throw new Error('Write failed (0 bytes written)')
    written += res.bytesWritten
  }
}

// Builds the whole FAT32 structure (MBR, boot sector, FSInfo, backup boot
// sector, both FATs and the root directory cluster) as one zero-filled prefix
// of the disk. The rest of the disk is left untouched unless fullFormat.
function buildStructure(layout: Fat32Layout, label: string): Buffer {
  const bootStart = layout.partStartSector * SECTOR_SIZE
  const structureEnd = layout.dataStartSector * SECTOR_SIZE + layout.bytesPerCluster
  const buf = Buffer.alloc(structureEnd)
  buildMBR(layout.partSectors).copy(buf, 0)
  const bpb = buildBPB(layout, label)
  bpb.copy(buf, bootStart)
  buildFSInfo(layout.totalClusters).copy(buf, bootStart + FSINFO_SECTOR * SECTOR_SIZE)
  bpb.copy(buf, bootStart + BACKUP_BOOT * SECTOR_SIZE)
  const fat = buildFAT(layout.fatSize)
  fat.copy(buf, bootStart + RESERVED * SECTOR_SIZE)
  fat.copy(buf, bootStart + (RESERVED + layout.fatSize) * SECTOR_SIZE)
  return buf
}

async function formatDevicePosix(
  device: string,
  layout: Fat32Layout,
  structure: Buffer,
  opts: FormatDeviceOptions,
  emit: (stage: string, bytesWritten: number, totalBytes: number) => void
): Promise<void> {
  const devicePath = Buffer.from(device.replace(/[\\/]+$/, ''))
  const handle = await open(devicePath, 'r+')
  try {
    emit('Writing partition table', 0, structure.length)
    await writeAt(handle, structure, 0)
    emit('Writing partition table', structure.length, structure.length)

    if (opts.fullFormat) {
      const chunk = Buffer.alloc(ZERO_CHUNK)
      const start = layout.dataStartSector * SECTOR_SIZE
      const end = (layout.partStartSector + layout.partSectors) * SECTOR_SIZE
      let pos = start
      while (pos < end) {
        if (opts.cancel?.cancelled) throw new Error('Format cancelled')
        const len = Math.min(chunk.length, end - pos)
        await writeAt(handle, chunk, pos, len)
        pos += len
        emit('Full format', pos - start, end - start)
      }
    }
  } finally {
    await handle.close()
  }
}

export async function formatDevice(device: string, sizeBytes: number, opts: FormatDeviceOptions): Promise<void> {
  const layout = computeLayout(sizeBytes)
  const label = sanitizeLabel(opts.label)
  const emit = (stage: string, bytesWritten: number, totalBytes: number): void =>
    opts.onProgress?.({ stage, bytesWritten, totalBytes })
  const structure = buildStructure(layout, label)

  if (process.platform === 'win32') {
    // Node's fs.open opens physical drives with shared access, which Windows
    // refuses for writes past the MBR (KB 942448). On Windows the structure is
    // streamed to the device by a PowerShell helper that opens it exclusively.
    await formatWindows({
      device,
      structure,
      totalBytes: sizeBytes,
      fullFormat: opts.fullFormat,
      cancel: opts.fullFormat ? opts.cancel : undefined,
      onProgress: (p) => emit(p.stage, p.bytesWritten, p.totalBytes)
    })
    return
  }

  await formatDevicePosix(device, layout, structure, opts, emit)
}
