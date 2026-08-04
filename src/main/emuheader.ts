import { closeSync, openSync, readSync } from 'node:fs'

// Minimal header parsing for the Game Boy / Game Boy Color and SNES ROMs the
// card's bundled emulators run. Enough to show a title (and a region where the
// format actually carries one) in the file-browser preview, mirroring what the
// N64 path already does.

export type EmuKind = 'gb' | 'gbc' | 'snes'

export interface EmuHeaderInfo {
  kind: EmuKind
  title: string
  region: string | null
}

const GB_EXTS = new Set(['.gb', '.gbc'])
const SNES_EXTS = new Set(['.smc', '.sfc', '.fig'])

const SNES_REGIONS: Record<number, string> = {
  0: 'Japan',
  1: 'USA',
  2: 'Europe',
  3: 'Sweden',
  4: 'Finland',
  5: 'Denmark',
  6: 'France',
  7: 'Netherlands',
  8: 'Spain',
  9: 'Germany',
  10: 'Italy',
  11: 'China',
  12: 'Indonesia',
  13: 'Korea',
  14: 'Common',
  15: 'Canada',
  16: 'Brazil',
  17: 'Australia'
}

export function isGBExt(p: string): boolean {
  return GB_EXTS.has(extOf(p))
}

export function isSNESExt(p: string): boolean {
  return SNES_EXTS.has(extOf(p))
}

function extOf(p: string): string {
  const last = p.lastIndexOf('.')
  return last >= 0 ? p.slice(last).toLowerCase() : ''
}

function readHead(filePath: string, size: number): Buffer | null {
  try {
    const fd = openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(size)
      const bytesRead = readSync(fd, buf, 0, size, 0)
      return buf.subarray(0, bytesRead)
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

// Titles are fixed-width ASCII fields; cut at the first NUL (or 0x80, the
// version-marker convention on newer Game Boy carts) and trim padding.
function cleanTitle(raw: Buffer, maxLen: number): string {
  let end = raw.length
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0x00 || raw[i] === 0x80) {
      end = i
      break
    }
  }
  if (end > maxLen) end = maxLen
  return raw
    .subarray(0, end)
    .toString('latin1')
    .replace(/[^\x20-\x7e]/g, ' ')
    .trim()
}

// Game Boy / Color header lives in the cartridge header at 0x100-0x14F.
// Title: 0x134 (16 bytes), destination code: 0x14A (0 = Japan).
function parseGB(buf: Buffer, kind: EmuKind): EmuHeaderInfo | null {
  if (buf.length < 0x150) return null
  const title = cleanTitle(buf.subarray(0x134, 0x144), 16)
  if (!title) return null
  return { kind, title, region: buf[0x14a] === 0x00 ? 'Japan' : null }
}

// SNES internal headers sit at 0x7FC0 (LoROM) or 0xFFC0 (HiROM), shifted by
// 512 bytes when a copier header is present. Prefer a candidate whose checksum
// complement validates, otherwise fall back to the first printable title.
const SNES_OFFSETS = [0x7fc0, 0xffc0, 0x81c0, 0x101c0]

function parseSNES(buf: Buffer): EmuHeaderInfo | null {
  const candidates: Array<{ title: string; checksumOk: boolean; region: string | null }> = []
  for (const off of SNES_OFFSETS) {
    if (buf.length < off + 0x20) continue
    const title = cleanTitle(buf.subarray(off, off + 0x20), 21)
    if (!title) continue
    const checksum = buf.readUInt16LE(off + 0x1c)
    const complement = buf.readUInt16LE(off + 0x1e)
    const region = SNES_REGIONS[buf[off + 0x1a]] ?? null
    candidates.push({ title, checksumOk: (checksum ^ complement) === 0xffff, region })
  }
  const best = candidates.find((c) => c.checksumOk) ?? candidates[0]
  if (!best) return null
  return { kind: 'snes', title: best.title, region: best.region }
}

export function inspectEmuFile(filePath: string): EmuHeaderInfo | null {
  const ext = extOf(filePath)
  if (GB_EXTS.has(ext)) {
    const buf = readHead(filePath, 0x150)
    return buf ? parseGB(buf, ext === '.gbc' ? 'gbc' : 'gb') : null
  }
  if (SNES_EXTS.has(ext)) {
    const buf = readHead(filePath, 0x10200)
    return buf ? parseSNES(buf) : null
  }
  return null
}
