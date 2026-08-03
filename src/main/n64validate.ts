import { open, stat } from 'node:fs/promises'

export type N64ByteOrder = 'z64' | 'v64' | 'n64'

export type N64Region = 'usa' | 'japan' | 'pal' | 'korea' | 'china' | 'brazil' | 'other' | 'unknown'

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

export type N64IssueCode = 'not-n64' | 'ext-mismatch' | 'bad-size'

export interface N64Issue {
  code: N64IssueCode
  severity: 'warn' | 'error'
}

export interface N64Validation {
  header: N64Header | null
  issues: N64Issue[]
}

const STANDARD_SIZES = new Set([0x400000, 0x800000, 0x1000000, 0x2000000, 0x4000000])

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

export function detectByteOrder(buf: Buffer): N64ByteOrder | null {
  if (buf.length < 4) return null
  if (buf[0] === 0x80 && buf[1] === 0x37 && buf[2] === 0x12 && buf[3] === 0x40) return 'z64'
  if (buf[0] === 0x37 && buf[1] === 0x80 && buf[2] === 0x40 && buf[3] === 0x12) return 'v64'
  if (buf[0] === 0x40 && buf[1] === 0x12 && buf[2] === 0x37 && buf[3] === 0x80) return 'n64'
  return null
}

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
  // n64 (little-endian): each 32-bit word is stored reversed.
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

export function parseHeader(buf: Buffer, size: number): N64Header | null {
  const order = detectByteOrder(buf)
  if (!order) return null
  const h = normalize(buf, order)
  if (h.length < 0x40) return null
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

export function expectedByteOrder(ext: string): N64ByteOrder | null {
  const e = ext.toLowerCase()
  if (e === '.z64') return 'z64'
  if (e === '.v64') return 'v64'
  if (e === '.n64') return 'n64'
  return null
}

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

export function romIdentity(header: N64Header): string {
  return `${header.gameCode}|${header.crc1}|${header.crc2}`.toLowerCase()
}

const HEADER_LEN = 0x100

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

export function isN64Ext(p: string): boolean {
  return expectedByteOrder(extOf(p)) !== null
}

export function extOf(p: string): string {
  const last = p.lastIndexOf('.')
  return last >= 0 ? p.slice(last).toLowerCase() : ''
}
