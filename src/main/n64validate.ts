// N64 ROM header parsing and validation for the main process. Reads only the
// first 256 bytes of a file to classify byte order (.z64/.v64/.n64), title,
// game code and region, and flags non-N64 files, extension/byte-order
// mismatches and non-standard sizes. Used during the ROM copy step, duplicate
// detection and card inspection.

import { open, stat } from 'node:fs/promises'

/** Endianness of a dump: .z64 is big-endian, .v64 is 16-bit byte-swapped, .n64 is little-endian with each 32-bit word reversed. */
export type N64ByteOrder = 'z64' | 'v64' | 'n64'

/** Logical region derived from the destination-code byte (offset 0x3E); 'other'/'unknown' cover unmapped codes. */
export type N64Region = 'usa' | 'japan' | 'pal' | 'korea' | 'china' | 'brazil' | 'other' | 'unknown'

/** Display labels for the region codes, used for the "Title (Region)" folder naming. */
export const N64_REGION_LABELS: Record<N64Region, string> = {
  usa: 'USA',
  japan: 'Japan',
  pal: 'PAL',
  korea: 'Korea',
  china: 'China',
  brazil: 'Brazil',
  other: 'Other',
  unknown: 'Unknown'
}

/** Parsed N64 header fields. title is the 20-byte ASCII field at 0x20; gameCode the 4 bytes at 0x3B-0x3E; crc1/crc2 are the header CRCs used for duplicate identity. */
export interface N64Header {
  byteOrder: N64ByteOrder
  title: string
  gameCode: string
  cartId: string
  countryCode: string
  region: N64Region
  version: string
  crc1: string
  crc2: string
  size: number
}

/** Non-blocking issues that validation may attach to a ROM. */
export type N64IssueCode = 'not-n64' | 'ext-mismatch' | 'bad-size'

export interface N64Issue {
  code: N64IssueCode
  severity: 'warn' | 'error'
}

export interface N64Validation {
  header: N64Header | null
  issues: N64Issue[]
}

// Standard mask-ROM sizes, 4Mbit..64Mbit. 12 Mbit (0xC00000) is uncommon but
// legal; anything outside this set is likely truncated or padded, worth a
// warning even though it may still boot.
const STANDARD_SIZES = new Set([0x400000, 0x800000, 0xc00000, 0x1000000, 0x2000000, 0x4000000])

// N64 destination codes (offset 0x3E), see n64brew.dev/wiki/ROM_Header.
const REGION_BY_CODE: Record<string, N64Region> = {
  E: 'usa',
  N: 'usa',
  J: 'japan',
  D: 'pal',
  F: 'pal',
  H: 'pal',
  I: 'pal',
  L: 'pal',
  P: 'pal',
  S: 'pal',
  U: 'pal',
  W: 'pal',
  X: 'pal',
  Y: 'pal',
  Z: 'pal',
  K: 'korea',
  C: 'china',
  B: 'brazil'
}

/**
 * Detect endianness from the initial PI-BSEL/status word at offset 0x00. The
 * canonical big-endian value is 0x80371240; the 16-bit byte-swapped form is
 * 0x37804012 and the word-reversed little-endian form is 0x40123780. Returns
 * null when the file starts with none of the three.
 */
export function detectByteOrder(buf: Buffer): N64ByteOrder | null {
  if (buf.length < 4) return null
  if (buf[0] === 0x80 && buf[1] === 0x37 && buf[2] === 0x12 && buf[3] === 0x40) return 'z64'
  if (buf[0] === 0x37 && buf[1] === 0x80 && buf[2] === 0x40 && buf[3] === 0x12) return 'v64'
  if (buf[0] === 0x40 && buf[1] === 0x12 && buf[2] === 0x37 && buf[3] === 0x80) return 'n64'
  return null
}

// Normalize a swapped dump back to big-endian so every later offset read is
// consistent regardless of the source byte order.
function normalize(buf: Buffer, order: N64ByteOrder): Buffer {
  const out = Buffer.alloc(buf.length)
  if (order === 'z64') {
    buf.copy(out)
    return out
  }
  if (order === 'v64') {
    // Byte-swapped: each 16-bit half-word has its bytes swapped.
    for (let i = 0; i + 2 <= buf.length; i += 2) {
      out[i] = buf[i + 1]
      out[i + 1] = buf[i]
    }
    return out
  }
  // n64 (little-endian): each 32-bit word is stored reversed, i.e. two nested
  // byte swaps. Reversing the word again reproduces the big-endian bytes.
  for (let i = 0; i + 4 <= buf.length; i += 4) {
    out[i] = buf[i + 3]
    out[i + 1] = buf[i + 2]
    out[i + 2] = buf[i + 1]
    out[i + 3] = buf[i]
  }
  return out
}

function ascii(buf: Buffer, start: number, len: number): string {
  return buf
    .toString('latin1', start, start + len)
    .replace(/[^\x20-\x7E]/g, ' ')
    .trim()
}

export function regionOf(code: string): N64Region {
  return REGION_BY_CODE[code.toUpperCase()] ?? 'other'
}

/**
 * Normalize the dump to big-endian and read the fixed header fields. Returns
 * null when the bytes are not a recognized N64 dump or the buffer is shorter
 * than 0x40 bytes. The region label and version come from the destination-code
 * byte at 0x3E and the version byte at 0x3F.
 */
export function parseHeader(buf: Buffer, size: number): N64Header | null {
  const order = detectByteOrder(buf)
  if (!order) return null
  const h = normalize(buf, order)
  if (h.length < 0x40) return null
  // 0x3B: cartridge category, 0x3C-0x3D: unique game ID, 0x3E: destination.
  const gameCode = ascii(h, 0x3b, 4)
  return {
    byteOrder: order,
    title: ascii(h, 0x20, 20),
    gameCode,
    cartId: gameCode.slice(1, 3),
    countryCode: h.toString('latin1', 0x3e, 0x3f),
    region: regionOf(h.toString('latin1', 0x3e, 0x3f)),
    version: String(h.readUInt8(0x3f)),
    crc1: h.readUInt32BE(0x10).toString(16).toUpperCase().padStart(8, '0'),
    crc2: h.readUInt32BE(0x14).toString(16).toUpperCase().padStart(8, '0'),
    size
  }
}

/**
 * The byte order implied by the file extension (.z64 -> z64, etc.), used to
 * warn when a dump's actual byte order disagrees with its filename.
 */
export function expectedByteOrder(ext: string): N64ByteOrder | null {
  const e = ext.toLowerCase()
  if (e === '.z64') return 'z64'
  if (e === '.v64') return 'v64'
  if (e === '.n64') return 'n64'
  return null
}

/**
 * Validate a parsed header against the file extension and size. 'ext-mismatch'
 * and 'bad-size' are warnings only: a renamed or resized dump usually still
 * boots, so the copy proceeds while the issue is surfaced in the report.
 */
export function inspectN64(buf: Buffer, size: number, ext: string): N64Validation {
  const header = parseHeader(buf, size)
  if (!header) return { header: null, issues: [{ code: 'not-n64', severity: 'error' }] }
  const issues: N64Issue[] = []
  const expected = expectedByteOrder(ext)
  if (expected && expected !== header.byteOrder) {
    issues.push({ code: 'ext-mismatch', severity: 'warn' })
  }
  if (!STANDARD_SIZES.has(size)) {
    issues.push({ code: 'bad-size', severity: 'warn' })
  }
  return { header, issues }
}

/**
 * Stable lowercase identity for duplicate detection: game code + the two
 * header CRCs. Distinct files of the same ROM share this value, so duplicates
 * are caught even when their filenames or byte orders differ.
 */
export function romIdentity(header: N64Header): string {
  return `${header.gameCode}|${header.crc1}|${header.crc2}`.toLowerCase()
}

// Only the header prefix is ever inspected; the rest of a multi-MB dump is
// irrelevant to validation and would be wasteful to read into memory.
const HEADER_LEN = 0x100

/**
 * Read the first 0x100 bytes of a file and validate them as an N64 ROM. A stat
 * failure or unreadable file is reported as 'not-n64' rather than thrown.
 */
export async function inspectN64File(filePath: string): Promise<N64Validation> {
  let size = 0
  try {
    size = (await stat(filePath)).size
  } catch {
    return { header: null, issues: [{ code: 'not-n64', severity: 'error' }] }
  }
  const handle = await open(filePath, 'r')
  const buf = Buffer.alloc(HEADER_LEN)
  let read = 0
  try {
    const { bytesRead } = await handle.read(buf, 0, HEADER_LEN, 0)
    read = bytesRead
  } finally {
    await handle.close()
  }
  return inspectN64(buf.subarray(0, read), size, extOf(filePath))
}

/** True when the path's extension is a recognized N64 ROM extension. */
export function isN64Ext(p: string): boolean {
  return expectedByteOrder(extOf(p)) !== null
}

/** Lowercased extension of a path, including the leading dot ('' when none). */
export function extOf(p: string): string {
  const last = p.lastIndexOf('.')
  return last >= 0 ? p.slice(last).toLowerCase() : ''
}
