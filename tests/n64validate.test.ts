import { describe, expect, it } from 'vitest'
import {
  detectByteOrder,
  parseHeader,
  regionOf,
  inspectN64,
  romIdentity,
  expectedByteOrder,
  N64_REGION_LABELS,
  type N64ByteOrder
} from '../src/main/n64validate'

function makeZ64(overrides?: {
  title?: string
  gameCode?: string
  country?: string
  version?: number
  crc1?: number
  crc2?: number
}): Buffer {
  const buf = Buffer.alloc(0x100)
  buf[0] = 0x80
  buf[1] = 0x37
  buf[2] = 0x12
  buf[3] = 0x40
  if (overrides?.title) buf.write(overrides.title, 0x20, 'latin1')
  if (overrides?.gameCode) buf.write(overrides.gameCode, 0x3b, 'latin1')
  if (overrides?.country) buf.write(overrides.country, 0x3e, 'latin1')
  if (overrides?.version !== undefined) buf.writeUInt8(overrides.version, 0x3f)
  if (overrides?.crc1 !== undefined) buf.writeUInt32BE(overrides.crc1, 0x10)
  if (overrides?.crc2 !== undefined) buf.writeUInt32BE(overrides.crc2, 0x14)
  return buf
}

function swap(buf: Buffer, order: N64ByteOrder): Buffer {
  const out = Buffer.alloc(buf.length)
  if (order === 'v64') {
    for (let i = 0; i + 2 <= buf.length; i += 2) {
      out[i] = buf[i + 1]
      out[i + 1] = buf[i]
    }
  } else if (order === 'n64') {
    for (let i = 0; i + 4 <= buf.length; i += 4) {
      out[i] = buf[i + 3]
      out[i + 1] = buf[i + 2]
      out[i + 2] = buf[i + 1]
      out[i + 3] = buf[i]
    }
  } else {
    buf.copy(out)
  }
  return out
}

describe('detectByteOrder', () => {
  it('detects z64 (big-endian)', () => {
    expect(detectByteOrder(makeZ64())).toBe('z64')
  })

  it('detects v64 (byte-swapped)', () => {
    expect(detectByteOrder(swap(makeZ64(), 'v64'))).toBe('v64')
  })

  it('detects n64 (little-endian)', () => {
    expect(detectByteOrder(swap(makeZ64(), 'n64'))).toBe('n64')
  })

  it('returns null for non-N64 data', () => {
    expect(detectByteOrder(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).toBeNull()
    expect(detectByteOrder(Buffer.from([0x80, 0x37]))).toBeNull()
  })
})

describe('parseHeader', () => {
  it('parses title, game code, region, CRC and version', () => {
    const header = parseHeader(
      makeZ64({
        title: 'SUPER MARIO 64',
        gameCode: 'NSME',
        country: 'E',
        version: 1,
        crc1: 0x0123abcd,
        crc2: 0xdeadbeef
      }),
      0x800000
    )
    expect(header).not.toBeNull()
    expect(header!.byteOrder).toBe('z64')
    expect(header!.title).toBe('SUPER MARIO 64')
    expect(header!.gameCode).toBe('NSME')
    expect(header!.cartId).toBe('SM')
    expect(header!.region).toBe('usa')
    expect(header!.version).toBe('1')
    expect(header!.crc1).toBe('0123ABCD')
    expect(header!.crc2).toBe('DEADBEEF')
    expect(header!.size).toBe(0x800000)
  })

  it('parses v64 and n64 byte orders to the same logical header', () => {
    const base = makeZ64({ title: 'TEST GAME', gameCode: 'NTGJ', country: 'J', crc1: 0x11111111, crc2: 0x22222222 })
    for (const order of ['v64', 'n64'] as const) {
      const header = parseHeader(swap(base, order), 0x1000000)
      expect(header).not.toBeNull()
      expect(header!.byteOrder).toBe(order)
      expect(header!.title).toBe('TEST GAME')
      expect(header!.gameCode).toBe('NTGJ')
      expect(header!.region).toBe('japan')
      expect(header!.crc1).toBe('11111111')
    }
  })

  it('returns null for non-N64 data', () => {
    expect(parseHeader(Buffer.alloc(0x100), 0x800000)).toBeNull()
  })
})

describe('regionOf', () => {
  it('maps known destination codes', () => {
    expect(regionOf('E')).toBe('usa')
    expect(regionOf('N')).toBe('usa')
    expect(regionOf('J')).toBe('japan')
    expect(regionOf('P')).toBe('pal')
    expect(regionOf('U')).toBe('pal')
    expect(regionOf('W')).toBe('pal')
    expect(regionOf('K')).toBe('korea')
    expect(regionOf('C')).toBe('china')
    expect(regionOf('B')).toBe('brazil')
  })

  it('falls back to other for unmapped codes', () => {
    expect(regionOf('Q')).toBe('other')
    expect(regionOf('')).toBe('other')
    expect(regionOf('\x00')).toBe('other')
  })

  it('exposes display labels', () => {
    expect(N64_REGION_LABELS.usa).toBe('USA')
    expect(N64_REGION_LABELS.japan).toBe('Japan')
    expect(N64_REGION_LABELS.pal).toBe('PAL')
    expect(N64_REGION_LABELS.other).toBe('Other')
  })
})

describe('expectedByteOrder', () => {
  it('maps extensions to byte orders', () => {
    expect(expectedByteOrder('.z64')).toBe('z64')
    expect(expectedByteOrder('.v64')).toBe('v64')
    expect(expectedByteOrder('.n64')).toBe('n64')
    expect(expectedByteOrder('.NES')).toBeNull()
    expect(expectedByteOrder('noext')).toBeNull()
  })
})

describe('inspectN64', () => {
  it('accepts a clean z64 ROM at a standard size', () => {
    const v = inspectN64(makeZ64(), 0x800000, '.z64')
    expect(v.header).not.toBeNull()
    expect(v.issues).toEqual([])
  })

  it('accepts the other standard sizes', () => {
    for (const size of [0x400000, 0xc00000, 0x1000000, 0x2000000, 0x4000000]) {
      expect(inspectN64(makeZ64(), size, '.z64').issues).toEqual([])
    }
  })

  it('flags a byte-order mismatch against the extension', () => {
    const v = inspectN64(swap(makeZ64(), 'v64'), 0x800000, '.z64')
    expect(v.header?.byteOrder).toBe('v64')
    expect(v.issues.map((i) => i.code)).toContain('ext-mismatch')
  })

  it('flags a non-standard size as a likely bad dump', () => {
    const v = inspectN64(makeZ64(), 0x600000, '.z64')
    expect(v.issues.map((i) => i.code)).toContain('bad-size')
  })

  it('reports non-N64 content', () => {
    const v = inspectN64(Buffer.from('definitely not a rom'), 100, '.z64')
    expect(v.header).toBeNull()
    expect(v.issues.map((i) => i.code)).toContain('not-n64')
  })
})

describe('romIdentity', () => {
  it('is stable across byte orders of the same dump', () => {
    const base = makeZ64({ gameCode: 'NSME', crc1: 0x0123abcd, crc2: 0xdeadbeef })
    const z = parseHeader(base, 0x800000)!
    const v = parseHeader(swap(base, 'v64'), 0x800000)!
    const n = parseHeader(swap(base, 'n64'), 0x800000)!
    expect(romIdentity(z)).toBe(romIdentity(v))
    expect(romIdentity(z)).toBe(romIdentity(n))
  })

  it('differs for a different dump of the same game', () => {
    const a = parseHeader(makeZ64({ gameCode: 'NSME', crc1: 0x0123abcd, crc2: 0xdeadbeef }), 0x800000)!
    const b = parseHeader(makeZ64({ gameCode: 'NSME', crc1: 0x9999aaaa, crc2: 0xdeadbeef }), 0x800000)!
    expect(romIdentity(a)).not.toBe(romIdentity(b))
  })
})
