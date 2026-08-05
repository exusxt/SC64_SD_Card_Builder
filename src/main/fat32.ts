// FAT32 on-disk structure builder for the formatting flow.
//
// Computes FAT32 geometry and assembles the byte-level layout (MBR, VBR/BPB,
// FSInfo, backup boot, both FATs, root directory cluster) that format.ts
// writes straight to the raw device on macOS/Linux. On Windows the filesystem
// is created by Format-Volume instead; only zeroDevice() is shared there.
import { open } from 'node:fs/promises'

// Geometry constants for a FAT32 layout on a 512-byte-sector device.
// PARTITION_START (LBA 2048 = 1 MiB) is the standard partition alignment for
// modern media. RESERVED is the boot region in sectors: the VBR at LBA 0,
// FSInfo at LBA 1, backup boot at LBA 6 and the rest padding.
const SECTOR_SIZE = 512
const PARTITION_START = 2048
const RESERVED = 32
const NUM_FATS = 2
const ROOT_CLUSTER = 2 // first data cluster; clusters 0 and 1 are reserved
const FSINFO_SECTOR = 1
const BACKUP_BOOT = 6
const ZERO_CHUNK = 4 * 1024 * 1024

/**
 * FAT32 geometry for a single primary partition that spans the whole card.
 * All fields are derived in computeLayout() and drive the byte-level layout
 * written to disk.
 */
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

/**
 * Computes the FAT32 geometry for a partition that fills the whole card,
 * starting at the 1 MiB mark (PARTITION_START).
 *
 * Cluster size is picked logarithmically from the partition size, clamped to
 * 4 KiB..32 KiB. It must grow with capacity so the FAT32 cluster count stays
 * below the spec limit of 0x0FFFFFF4 (268,435,444) entries, which is what
 * caps the practical FAT32 volume size at roughly 2 TB.
 *
 * fatSize is the size of one FAT in sectors. It depends on the cluster count,
 * but the FAT itself consumes data sectors and so shrinks the cluster count,
 * so the value is iterated to a fixed point rather than solved directly.
 *
 * @param sizeBytes total device size in bytes
 * @returns Fat32Layout with cluster size, FAT size and region boundaries
 * @throws if the device is too small to hold a FAT32 partition
 */
export function computeLayout(sizeBytes: number): Fat32Layout {
  // Reject anything that cannot fit the 1 MiB partition offset plus padding
  // and a root directory cluster.
  if (!Number.isFinite(sizeBytes) || sizeBytes < PARTITION_START * SECTOR_SIZE + 1024 * 1024) {
    throw new Error(`Drive size (${sizeBytes} bytes) is too small to format as FAT32.`)
  }
  const partSectors = Math.floor((sizeBytes - PARTITION_START * SECTOR_SIZE) / SECTOR_SIZE)
  const partBytes = partSectors * SECTOR_SIZE

  // ceil(log2(partBytes / 4 MiB)) clamped to 12..15 yields 4 KiB clusters up
  // to 16 GiB and doubles the cluster size with every doubling of capacity
  // after that (8 KiB / 16 KiB / 32 KiB), keeping the cluster count bounded.
  let clusterBytes = Math.ceil(Math.log2(Math.max(partBytes / 2 ** 22, 4096)) / Math.log2(2))
  clusterBytes = Math.max(12, Math.min(clusterBytes, 15)) // 4KB .. 32KB
  const bytesPerCluster = 2 ** clusterBytes
  const spc = bytesPerCluster / SECTOR_SIZE

  // Each FAT entry is 4 bytes and the +2 covers the reserved entries for
  // clusters 0 and 1. Iterate: a bigger FAT leaves fewer data sectors, which
  // reduces the cluster count and therefore the FAT size that is needed.
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

/**
 * Normalises a volume label for FAT32: uppercase, printable-ASCII only,
 * padded to exactly 11 characters (the size of the FAT label field) and
 * falling back to 'SUMMERCART' when nothing usable remains.
 */
export function sanitizeLabel(label: string): string {
  const cleaned = (label || 'SUMMERCART').toUpperCase().replace(/[^\x20-\x7E]/g, '').trim()
  return (cleaned || 'SUMMERCART').padEnd(11, ' ').slice(0, 11)
}

/**
 * Normalises a volume label for exFAT: strips the characters Windows forbids
 * in file names plus control chars, capped at 15 chars (exFAT's label limit).
 * No padding is applied because exFAT labels are not length-padded.
 */
export function sanitizeExfatLabel(label: string): string {
  const cleaned = (label || 'SUMMERCART')
    .replace(/["*:<>?\\/|]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
  return (cleaned || 'SUMMERCART').slice(0, 15)
}

// One partition table entry at offset 446 (LBA start at 454, size in sectors
// at 458) with boot signature 0xAA55 at 510. The CHS fields are best-effort;
// the partition is addressed by LBA and CHS is ignored.
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

// Builds the FAT32 BIOS Parameter Block. Offsets are relative to the start of
// the VBR at LBA PARTITION_START. The FAT12/16-only fields (root entry count,
// totalSectors16, fatSize16) are zeroed: FAT32 always uses the 32-bit fields
// and has no fixed root directory size.
function buildBPB(layout: Fat32Layout, label: string): Buffer {
  const b = Buffer.alloc(SECTOR_SIZE)
  b[0] = 0xeb
  b[1] = 0x58
  b[2] = 0x90
  b.write('MSDOS5.0', 3, 'ascii')
  b.writeUInt16LE(SECTOR_SIZE, 11) // bytes per sector
  b[13] = layout.spc // sectors per cluster
  b.writeUInt16LE(RESERVED, 14) // reserved boot region, in sectors
  b[16] = NUM_FATS
  b.writeUInt16LE(0, 17) // root entry count (0 for FAT32)
  b.writeUInt16LE(0, 19) // totalSectors16
  b[21] = 0xf8 // media descriptor (fixed disk)
  b.writeUInt16LE(0, 22) // fatSize16
  b.writeUInt16LE(32, 24) // sectors per track
  b.writeUInt16LE(64, 26) // number of heads
  b.writeUInt32LE(PARTITION_START, 28) // hidden sectors = partition LBA start
  b.writeUInt32LE(layout.partSectors, 32) // totalSectors32
  b.writeUInt32LE(layout.fatSize, 36) // fatSize32
  b.writeUInt16LE(0, 40) // ext flags
  b.writeUInt16LE(0, 42) // fs version
  b.writeUInt32LE(ROOT_CLUSTER, 44) // first cluster of the root directory
  b.writeUInt16LE(FSINFO_SECTOR, 48)
  b.writeUInt16LE(BACKUP_BOOT, 50)
  b[64] = 0x80 // drive number
  b[66] = 0x29 // extended boot signature
  b.writeUInt32LE((Math.random() * 0xffffffff) >>> 0, 67) // volume serial
  b.write(sanitizeLabel(label), 71, 'ascii')
  b.write('FAT32   ', 82, 'ascii')
  b.writeUInt16LE(0xaa55, 510)
  return b
}

// FSInfo sector: the 'RRaA'/'rrAa' signatures tell the OS where to read the
// cached free-cluster count (488) and next-free-cluster hint (492), so
// allocation does not have to scan the whole FAT. Values are best-effort;
// OSes re-derive them on first mount.
function buildFSInfo(totalClusters: number): Buffer {
  const f = Buffer.alloc(SECTOR_SIZE)
  f.write('RRaA', 0, 'ascii')
  f.write('rrAa', 484, 'ascii')
  f.writeUInt32LE(Math.max(0, totalClusters - 1), 488) // free cluster count
  f.writeUInt32LE(ROOT_CLUSTER, 492) // next free cluster hint
  f.writeUInt16LE(0xaa55, 510)
  return f
}

// First FAT. Entries are 32-bit and cluster numbers are relative to the data
// region: entry 0 holds the media descriptor, entry 1 is reserved, and entry
// 2 (the first data cluster, which is the root directory in FAT32) is marked
// end-of-chain. Everything else stays 0, i.e. free.
function buildFAT(fatSize: number): Buffer {
  const fat = Buffer.alloc(fatSize * SECTOR_SIZE)
  fat.writeUInt32LE(0x0ffffff8, 0) // media descriptor
  fat.writeUInt32LE(0x0fffffff, 4) // reserved
  fat.writeUInt32LE(0x0fffffff, 8) // root directory cluster = EOC
  return fat
}

/** Progress of a byte-level format: current stage name plus bytes written/total. */
export interface FormatProgress {
  stage: string
  bytesWritten: number
  totalBytes: number
}

/** Cooperative cancellation flag shared with the renderer via the IPC layer. */
export interface CancelToken {
  cancelled: boolean
}

/** Options for formatDevice(): label, quick vs full format, and progress/cancel hooks. */
export interface FormatDeviceOptions {
  label: string
  fullFormat: boolean
  onProgress?: (p: FormatProgress) => void
  cancel?: CancelToken
}

// Writes a buffer at an absolute byte offset, looping on partial writes.
// Positioned writes (pwrite semantics) are used so a shared handle never
// depends on a shared file offset.
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
  // Layout inside the reserved region: VBR at sector 0, FSInfo at sector 1,
  // backup boot at sector 6, then the two FATs. One cluster is appended past
  // the FATs so the root directory cluster already exists on disk.
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
  // Opening through a Buffer path passes the name to the kernel verbatim, so
  // device nodes such as /dev/rdisk4 never get mangled by path decoding.
  const devicePath = Buffer.from(device.replace(/[\\/]+$/, ''))
  const handle = await open(devicePath, 'r+')
  try {
    emit('Writing partition table', 0, structure.length)
    await writeAt(handle, structure, 0)
    emit('Writing partition table', structure.length, structure.length)

    if (opts.fullFormat) {
      const chunk = Buffer.alloc(ZERO_CHUNK)
      // Zero only the data region in 4 MiB chunks: the boot region was already
      // overwritten by the structure buffer. The first data cluster is zeroed
      // again here, which is harmless - it is just the empty root directory.
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

/**
 * Writes a FAT32 partition table and filesystem structure onto a raw device
 * (macOS/Linux only; see format.ts for the platform dispatch, and winraw.ts
 * for the Windows full-format zero pass).
 *
 * @param device raw device path, e.g. /dev/rdisk4 (macOS) or /dev/sdb (Linux)
 * @param sizeBytes total device size in bytes
 * @param opts label, quick/full flag, and progress/cancel hooks
 */
export async function formatDevice(device: string, sizeBytes: number, opts: FormatDeviceOptions): Promise<void> {
  const layout = computeLayout(sizeBytes)
  const label = sanitizeLabel(opts.label)
  const emit = (stage: string, bytesWritten: number, totalBytes: number): void =>
    opts.onProgress?.({ stage, bytesWritten, totalBytes })
  const structure = buildStructure(layout, label)

  await formatDevicePosix(device, layout, structure, opts, emit)
}

/**
 * Zeroes the entire device in one sequential pass. Used by the full-format
 * step on macOS/Linux before the native tools build an exFAT filesystem, so
 * every old partition table and filesystem is erased.
 *
 * @param device raw device path
 * @param totalBytes number of bytes to zero from the start of the device
 * @param opts progress and cancellation callbacks
 */
// Writes zeros across the entire device. Used for the full-format zero pass of
// exFAT on macOS/Linux, where the native tools build the filesystem afterwards.
export async function zeroDevice(device: string, totalBytes: number, opts: ZeroDeviceOptions): Promise<void> {
  const devicePath = Buffer.from(device.replace(/[\\/]+$/, ''))
  const handle = await open(devicePath, 'r+')
  try {
    const chunk = Buffer.alloc(ZERO_CHUNK)
    let pos = 0
    while (pos < totalBytes) {
      if (opts.cancel?.cancelled) throw new Error('Format cancelled')
      const len = Math.min(chunk.length, totalBytes - pos)
      await writeAt(handle, chunk, pos, len)
      pos += len
      opts.emit('Full format', pos, totalBytes)
    }
  } finally {
    await handle.close()
  }
}

/** Options for zeroDevice(): a mandatory progress emitter and an optional cancel token. */
export interface ZeroDeviceOptions {
  cancel?: CancelToken
  emit: (stage: string, bytesWritten: number, totalBytes: number) => void
}
