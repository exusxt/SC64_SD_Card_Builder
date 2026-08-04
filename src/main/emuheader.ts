import { closeSync, openSync, readSync } from 'node:fs'

// Header validation for the Game Boy / Game Boy Color, SNES and Sega Master
// System / Game Gear ROMs the card's bundled emulators run. Mirrors
// n64validate.ts: parse a header, then report issues (unrecognized format,
// byte-swapped dump, checksum failure, header layout mismatches) without ever
// blocking the copy.

export type EmuKind = 'gb' | 'gbc' | 'snes' | 'sms' | 'gg'

export type EmuByteOrder = 'native' | 'swapped'

export type EmuIssueCode =
  | 'not-gb'
  | 'not-snes'
  | 'not-sms'
  | 'byte-swapped'
  | 'ext-mismatch'
  | 'bad-dump'

export interface EmuIssue {
  code: EmuIssueCode
  severity: 'warn' | 'error'
  // 'ext-mismatch' distinguishes a ROM carrying a 512-byte copier header from
  // a raw one so the message can say which way the extension is wrong.
  detail?: 'headered' | 'unheadered'
}

export interface EmuHeaderInfo {
  kind: EmuKind
  title: string
  region: string | null
  byteOrder: EmuByteOrder
  // Dump checksum (hex) used for duplicate identity; '0000' means unset.
  checksum: string
  headerOk: boolean
  // SMS/GG only: the 4 product-code bytes (BCD, includes the version nibble).
  productCode?: string
  // SNES only: LoROM/HiROM/ExHiROM, plus "(copier header)" when the internal
  // header sits at the 512-byte-shifted offsets.
  layout: string | null
}

export interface EmuValidation {
  header: EmuHeaderInfo | null
  issues: EmuIssue[]
}

const GB_EXTS = new Set(['.gb', '.gbc'])
const SNES_EXTS = new Set(['.smc', '.sfc', '.fig'])
const SMS_EXTS = new Set(['.sms', '.gg'])

// Fixed 48-byte Nintendo logo all commercial Game Boy cartridges carry at
// 0x104. Byte-swapped dumps have the logo with every 16-bit word reversed.
const NINTENDO_LOGO = Buffer.from(
  'ceed6666cc0d000b03730083000c000d0008111f8889000edccc6ee6ddddd999bbbb67636e0eecccdddc999fbbb9333e',
  'hex'
)

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

// SNES internal headers: 0x7FC0 LoROM, 0xFFC0 HiROM, both +0x200 with the
// 512-byte copier header some ROMs carry.
const SNES_OFFSETS = [0x7fc0, 0xffc0, 0x81c0, 0x101c0]

// SMS/GG header: 16 bytes of "TMR SEGA" metadata at 0x7FF0 (0x81F0 with the
// 512-byte copier header). The emulator only checks those two offsets, but
// small homebrew ROMs use 0x3FF0 (16K) or 0x1FF0 (8K), so scan for those too.
const SMS_HEADER_OFFSETS = [0x7ff0, 0x81f0, 0x3ff0, 0x41f0, 0x1ff0, 0x21f0]
// Read enough of the file to cover every offset above.
const SMS_HEADER_HEAD = 0x8200

// Region is the low nibble of sizeAndRegion (0x7FFF); the high nibble is the
// cart size (0x80..0x200). Nibbles 3-7 pick the platform: SMS or Game Gear.
const SMS_REGIONS: Record<number, string> = {
  3: 'SMS Japan',
  4: 'SMS Export',
  5: 'GG Japan',
  6: 'GG Export',
  7: 'GG International'
}

export function isGBExt(p: string): boolean {
  return GB_EXTS.has(extOf(p))
}

export function isSNESExt(p: string): boolean {
  return SNES_EXTS.has(extOf(p))
}

export function isSMSExt(p: string): boolean {
  return SMS_EXTS.has(extOf(p))
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

function swapBytes16(buf: Buffer): Buffer {
  const out = Buffer.alloc(buf.length)
  for (let i = 0; i + 2 <= buf.length; i += 2) {
    out[i] = buf[i + 1]
    out[i + 1] = buf[i]
  }
  return out
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

// Game Boy / Color cartridge header at 0x100-0x14F. Logo at 0x104 (48 bytes),
// title at 0x134 (16 bytes), destination code at 0x14A, header checksum at
// 0x14D (sum of 0x134..0x14D mod 256 must be 0), global checksum at 0x14E.
function parseGB(buf: Buffer, kind: EmuKind): EmuValidation | null {
  if (buf.length < 0x150) return null
  const logo = buf.subarray(0x104, 0x134)
  let byteOrder: EmuByteOrder = 'native'
  let logoState: 'ok' | 'swapped' | 'missing' = 'missing'
  if (logo.equals(NINTENDO_LOGO)) {
    logoState = 'ok'
  } else if (swapBytes16(logo).equals(NINTENDO_LOGO)) {
    logoState = 'swapped'
    byteOrder = 'swapped'
  }

  const titleRaw = buf.subarray(0x134, 0x144)
  const title = cleanTitle(byteOrder === 'swapped' ? swapBytes16(titleRaw) : titleRaw, 16)

  // Header checksum (0x14D): -(sum of each byte 0x134..0x14C, each + 1) mod 256
  // must equal the stored byte. Plain sum-of-bytes is wrong for real carts.
  let sum = 0
  for (let i = 0x134; i <= 0x14c; i++) sum -= buf[i] + 1
  const checksumOk = (sum & 0xff) === buf[0x14d]

  const issues: EmuIssue[] = []
  if (logoState === 'swapped') issues.push({ code: 'byte-swapped', severity: 'warn' })
  if (logoState === 'missing') issues.push({ code: 'not-gb', severity: 'warn' })
  if (!checksumOk) issues.push({ code: 'bad-dump', severity: 'warn' })

  if (!title && logoState === 'missing') return null

  return {
    header: {
      kind,
      title,
      region: buf[0x14a] === 0x00 ? 'Japan' : null,
      byteOrder,
      checksum: buf.readUInt16LE(0x14e).toString(16).padStart(4, '0'),
      headerOk: logoState === 'ok',
      layout: null
    },
    issues
  }
}

function mapModeLabel(mode: number): string {
  if (mode >= 0x60 && mode <= 0x6f) return 'ExHiROM'
  if (mode >= 0x50 && mode <= 0x5f) return 'ExLoROM'
  if (mode >= 0x30 && mode <= 0x3f) return 'HiROM'
  return 'LoROM'
}

// SNES internal header: title at +0 (21 bytes), map mode +0x15, region +0x1A,
// checksum +0x1C / complement +0x1E (valid when checksum ^ complement = 0xFFFF).
// Prefer a candidate whose complement validates, otherwise the first printable
// title. Zeroed checksums are "unset", not a failure.
function parseSNES(buf: Buffer): EmuValidation | null {
  const candidates: Array<{
    off: number
    title: string
    checksum: number
    complement: number
    mapMode: number
    region: string | null
  }> = []
  for (const off of SNES_OFFSETS) {
    if (buf.length < off + 0x20) continue
    const title = cleanTitle(buf.subarray(off, off + 0x20), 21)
    if (!title) continue
    candidates.push({
      off,
      title,
      checksum: buf.readUInt16LE(off + 0x1c),
      complement: buf.readUInt16LE(off + 0x1e),
      mapMode: buf[off + 0x15],
      region: SNES_REGIONS[buf[off + 0x1a]] ?? null
    })
  }
  if (candidates.length === 0) return null

  const best = candidates.find((c) => (c.checksum ^ c.complement) === 0xffff) ?? candidates[0]
  const valid = (best.checksum ^ best.complement) === 0xffff
  const unset = best.checksum === 0 && best.complement === 0

  const issues: EmuIssue[] = []
  if (!valid && !unset) issues.push({ code: 'bad-dump', severity: 'warn' })

  const headered = best.off === 0x81c0 || best.off === 0x101c0
  const layout = `${mapModeLabel(best.mapMode)}${headered ? ' (copier header)' : ''}`

  return {
    header: {
      kind: 'snes',
      title: best.title,
      region: best.region,
      byteOrder: 'native',
      checksum: best.checksum.toString(16).padStart(4, '0'),
      headerOk: valid,
      layout
    },
    issues
  }
}

function validateGB(buf: Buffer, kind: EmuKind): EmuValidation {
  const v = parseGB(buf, kind)
  return v ?? { header: null, issues: [{ code: 'not-gb', severity: 'warn' }] }
}

function validateSNES(buf: Buffer, ext: string): EmuValidation {
  const v = parseSNES(buf)
  if (!v) return { header: null, issues: [{ code: 'not-snes', severity: 'warn' }] }
  // .smc conventionally carries the 512-byte copier header, .sfc/.fig are raw.
  const headered = v.header?.layout?.includes('copier header') ?? false
  if (headered && ext !== '.smc') v.issues.push({ code: 'ext-mismatch', severity: 'warn', detail: 'headered' })
  if (!headered && ext === '.smc') v.issues.push({ code: 'ext-mismatch', severity: 'warn', detail: 'unheadered' })
  return v
}

// Sega Master System / Game Gear header at the offsets above: an 8-byte
// "TMR SEGA" signature, reserved word at +0x08, checksum (LE) at +0x0A,
// product code (3 bytes BCD) at +0x0C, version nibble + sizeAndRegion at
// +0x0F (region nibble is used for the platform/region labels).
function validateSMS(buf: Buffer, kind: EmuKind): EmuValidation {
  for (const off of SMS_HEADER_OFFSETS) {
    if (buf.length < off + 0x10) continue
    if (buf.toString('latin1', off, off + 8) !== 'TMR SEGA') continue
    const headered = off === 0x81f0 || off === 0x41f0 || off === 0x21f0
    const regionNib = buf[off + 0x0f] & 0x0f
    return {
      header: {
        kind,
        title: '',
        region: SMS_REGIONS[regionNib] ?? null,
        byteOrder: 'native',
        checksum: buf.readUInt16LE(off + 0x0a).toString(16).padStart(4, '0'),
        headerOk: true,
        layout: headered ? 'sms (copier header)' : 'sms',
        productCode: buf.subarray(off + 0x0c, off + 0x0f).toString('hex')
      },
      issues: []
    }
  }
  return { header: null, issues: [{ code: 'not-sms', severity: 'warn' }] }
}

export function validateEmuFile(filePath: string): EmuValidation {
  const ext = extOf(filePath)
  if (GB_EXTS.has(ext)) {
    const buf = readHead(filePath, 0x150)
    if (!buf) return { header: null, issues: [{ code: 'not-gb', severity: 'warn' }] }
    return validateGB(buf, ext === '.gbc' ? 'gbc' : 'gb')
  }
  if (SNES_EXTS.has(ext)) {
    const buf = readHead(filePath, 0x10200)
    if (!buf) return { header: null, issues: [{ code: 'not-snes', severity: 'warn' }] }
    return validateSNES(buf, ext)
  }
  if (SMS_EXTS.has(ext)) {
    const buf = readHead(filePath, SMS_HEADER_HEAD)
    if (!buf) return { header: null, issues: [{ code: 'not-sms', severity: 'warn' }] }
    return validateSMS(buf, ext === '.gg' ? 'gg' : 'sms')
  }
  return { header: null, issues: [] }
}

// Preview only needs the parsed title/kind/region, so this stays light.
export function inspectEmuFile(filePath: string): EmuHeaderInfo | null {
  const ext = extOf(filePath)
  if (GB_EXTS.has(ext)) {
    const buf = readHead(filePath, 0x150)
    return buf ? parseGB(buf, ext === '.gbc' ? 'gbc' : 'gb')?.header ?? null : null
  }
  if (SNES_EXTS.has(ext)) {
    const buf = readHead(filePath, 0x10200)
    return buf ? parseSNES(buf)?.header ?? null : null
  }
  if (SMS_EXTS.has(ext)) {
    const buf = readHead(filePath, SMS_HEADER_HEAD)
    return buf ? validateSMS(buf, ext === '.gg' ? 'gg' : 'sms').header ?? null : null
  }
  return null
}

// Identity for duplicate detection. The header carries a dump checksum (GB
// global checksum, SNES internal checksum, SMS/GG header checksum); fall back
// to size when it is unset. SMS/GG ROMs have no title field, so the product
// code stands in for it.
export function emuIdentity(header: EmuHeaderInfo, size: number): string {
  const checksum = header.checksum !== '0000' ? header.checksum : `size:${size}`
  const tag = header.title || header.productCode || 'untitled'
  return `${header.kind}|${tag.toLowerCase()}|${checksum}`.toLowerCase()
}
