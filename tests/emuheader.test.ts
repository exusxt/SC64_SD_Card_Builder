import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { inspectEmuFile, isGBExt, isSNESExt, isSMSExt, validateEmuFile, emuIdentity, EmuHeaderInfo } from '../src/main/emuheader'

let roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sc64-emu-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
  roots = []
})

function write(name: string, buf: Buffer): string {
  const root = makeRoot()
  const p = join(root, name)
  writeFileSync(p, buf)
  return p
}

const NINTENDO_LOGO = Buffer.from(
  'ceed6666cc0d000b03730083000c000d0008111f8889000edccc6ee6ddddd999bbbb67636e0eecccdddc999fbbb9333e',
  'hex'
)

function fixGBHeaderChecksum(buf: Buffer): void {
  let sum = 0
  for (let i = 0x134; i <= 0x14c; i++) sum -= buf[i] + 1
  buf[0x14d] = sum & 0xff
}

function makeGB(title: string, destCode = 0x00): Buffer {
  const buf = Buffer.alloc(0x150)
  NINTENDO_LOGO.copy(buf, 0x104)
  buf.write(title, 0x134, 'latin1')
  buf[0x14a] = destCode
  fixGBHeaderChecksum(buf)
  return buf
}

function byteSwap16(buf: Buffer): Buffer {
  const out = Buffer.alloc(buf.length)
  for (let i = 0; i + 2 <= out.length; i += 2) {
    out[i] = buf[i + 1]
    out[i + 1] = buf[i]
  }
  return out
}

function makeSwappedGB(title: string): Buffer {
  const out = byteSwap16(makeGB(title))
  fixGBHeaderChecksum(out)
  return out
}

function makeSMS(regionNib: number, sizeNib: number, headered = false, checksum = 0x1234): Buffer {
  const off = headered ? 0x81f0 : 0x7ff0
  const buf = Buffer.alloc(headered ? 0x8200 : 0x8000)
  buf.write('TMR SEGA', off, 'latin1')
  buf.writeUInt16LE(checksum, off + 0x0a)
  buf.write('000000', off + 0x0c, 'hex')
  buf[off + 0x0f] = (sizeNib << 4) | regionNib
  return buf
}

function makeSNES(title: string, region: number, offset: number, checksumState: 'valid' | 'bad' | 'unset' = 'valid', mapMode = 0x20): Buffer {
  const size = Math.max(0x8000, offset + 0x8000)
  const buf = Buffer.alloc(size)
  buf.write(title, offset, 'latin1')
  buf[offset + 0x15] = mapMode
  buf[offset + 0x1a] = region
  if (checksumState !== 'unset') {
    const checksum = 0x1234
    buf.writeUInt16LE(checksum, offset + 0x1c)
    buf.writeUInt16LE(checksumState === 'bad' ? 0x0000 : 0xffff ^ checksum, offset + 0x1e)
  }
  return buf
}

describe('isGBExt / isSNESExt / isSMSExt', () => {
  it('recognizes the supported extensions', () => {
    expect(isGBExt('Tetris.gb')).toBe(true)
    expect(isGBExt('Kirby.gbc')).toBe(true)
    expect(isGBExt('Mario.smc')).toBe(false)
    expect(isSNESExt('Mario.smc')).toBe(true)
    expect(isSNESExt('Zelda.sfc')).toBe(true)
    expect(isSNESExt('StarFox.fig')).toBe(true)
    expect(isSNESExt('Tetris.gb')).toBe(false)
    expect(isSMSExt('Sonic.sms')).toBe(true)
    expect(isSMSExt('Sonic.gg')).toBe(true)
    expect(isSMSExt('Sonic.sfc')).toBe(false)
    expect(isSMSExt('SONIC.SMS')).toBe(true)
  })
})

describe('validateEmuFile — Game Boy', () => {
  it('validates a good cartridge and reads its title and region', () => {
    const p = write('Tetris.gb', makeGB('TETRIS'))
    const v = validateEmuFile(p)
    expect(v.header).toMatchObject({ kind: 'gb', title: 'TETRIS', region: 'Japan', byteOrder: 'native', headerOk: true })
    expect(v.issues).toEqual([])
  })

  it('labels a .gbc file as a Game Boy Color ROM', () => {
    const p = write('Kirby.gbc', makeGB('KIRBY'))
    expect(validateEmuFile(p).header?.kind).toBe('gbc')
  })

  it('detects a byte-swapped dump', () => {
    const p = write('Tetris.gb', makeSwappedGB('TETRIS'))
    const v = validateEmuFile(p)
    expect(v.header?.byteOrder).toBe('swapped')
    expect(v.header?.title).toBe('TETRIS')
    expect(v.issues.map((i) => i.code)).toContain('byte-swapped')
  })

  it('flags a file without the Nintendo logo as not a Game Boy ROM', () => {
    const noLogo = Buffer.alloc(0x150)
    noLogo.write('TETRIS', 0x134, 'latin1')
    const p = write('fake.gb', noLogo)
    const v = validateEmuFile(p)
    expect(v.header).not.toBeNull()
    expect(v.issues.map((i) => i.code)).toContain('not-gb')
  })

  it('rejects files with no readable header at all', () => {
    const p = write('broken.gb', Buffer.alloc(0x150))
    const v = validateEmuFile(p)
    expect(v.header).toBeNull()
    expect(v.issues.map((i) => i.code)).toContain('not-gb')
  })

  it('warns about a bad header checksum', () => {
    const bad = makeGB('TETRIS')
    bad[0x14d] = (bad[0x14d] + 1) & 0xff
    const p = write('corrupt.gb', bad)
    expect(validateEmuFile(p).issues.map((i) => i.code)).toContain('bad-dump')
  })
})

describe('validateEmuFile — SNES', () => {
  it('validates a LoROM dump and reads its title and region', () => {
    const p = write('Mario.sfc', makeSNES('SUPER MARIO WORLD', 1, 0x7fc0))
    const v = validateEmuFile(p)
    expect(v.header).toMatchObject({ kind: 'snes', title: 'SUPER MARIO WORLD', region: 'USA', headerOk: true })
    expect(v.header?.layout).toBe('LoROM')
    expect(v.issues).toEqual([])
  })

  it('parses a HiROM header', () => {
    const p = write('Zelda.sfc', makeSNES('ZELDA NO DENSETSU', 0, 0xffc0, 'valid', 0x30))
    const v = validateEmuFile(p)
    expect(v.header?.title).toBe('ZELDA NO DENSETSU')
    expect(v.header?.region).toBe('Japan')
    expect(v.header?.layout).toBe('HiROM')
  })

  it('accepts a headered .smc and a raw .sfc with no complaints', () => {
    const headered = write('Dragon.smc', makeSNES('DRAGON QUEST', 0, 0x81c0))
    expect(validateEmuFile(headered).issues).toEqual([])
    const raw = write('Dragon.sfc', makeSNES('DRAGON QUEST', 0, 0x7fc0))
    expect(validateEmuFile(raw).issues).toEqual([])
  })

  it('warns when a headered ROM is named .sfc', () => {
    const p = write('Dragon.sfc', makeSNES('DRAGON QUEST', 0, 0x81c0))
    const v = validateEmuFile(p)
    expect(v.issues.map((i) => i.code)).toContain('ext-mismatch')
    expect(v.issues.find((i) => i.code === 'ext-mismatch')?.detail).toBe('headered')
  })

  it('warns when a raw ROM is named .smc', () => {
    const p = write('Dragon.smc', makeSNES('DRAGON QUEST', 0, 0x7fc0))
    const v = validateEmuFile(p)
    expect(v.issues.map((i) => i.code)).toContain('ext-mismatch')
    expect(v.issues.find((i) => i.code === 'ext-mismatch')?.detail).toBe('unheadered')
  })

  it('warns about a bad checksum but not an unset one', () => {
    const bad = write('Bad.sfc', makeSNES('GAME', 1, 0x7fc0, 'bad'))
    expect(validateEmuFile(bad).issues.map((i) => i.code)).toContain('bad-dump')
    const unset = write('Unset.sfc', makeSNES('GAME', 1, 0x7fc0, 'unset'))
    expect(validateEmuFile(unset).issues.map((i) => i.code)).not.toContain('bad-dump')
  })

  it('rejects files with no readable header', () => {
    const p = write('broken.sfc', Buffer.alloc(0x8000))
    const v = validateEmuFile(p)
    expect(v.header).toBeNull()
    expect(v.issues.map((i) => i.code)).toContain('not-snes')
  })
})

describe('validateEmuFile — SMS / Game Gear', () => {
  it('validates a .sms dump and reads its region from the size/region byte', () => {
    const p = write('Sonic.sms', makeSMS(4, 0))
    const v = validateEmuFile(p)
    expect(v.header).toMatchObject({ kind: 'sms', region: 'SMS Export', byteOrder: 'native', headerOk: true, layout: 'sms' })
    expect(v.header?.productCode).toBe('000000')
    expect(v.issues).toEqual([])
  })

  it('labels a .gg dump as a Game Gear ROM from its region nibble', () => {
    const p = write('Sonic.gg', makeSMS(6, 0))
    const v = validateEmuFile(p)
    expect(v.header?.kind).toBe('gg')
    expect(v.header?.region).toBe('GG Export')
    expect(v.issues).toEqual([])
  })

  it('parses a 512-byte-headered dump', () => {
    const p = write('Sonic.sms', makeSMS(4, 0, true))
    const v = validateEmuFile(p)
    expect(v.header?.layout).toBe('sms (copier header)')
    expect(v.issues).toEqual([])
  })

  it('recognizes a small 16K homebrew header at 0x3FF0', () => {
    const buf = Buffer.alloc(0x4000)
    buf.write('TMR SEGA', 0x3ff0, 'latin1')
    buf.writeUInt16LE(0x5678, 0x3ffa)
    buf[0x3fff] = 0x24
    const p = write('homebrew.sms', buf)
    expect(validateEmuFile(p).header?.region).toBe('SMS Export')
  })

  it('rejects files without the TMR SEGA signature', () => {
    const p = write('fake.sms', Buffer.alloc(0x8000))
    const v = validateEmuFile(p)
    expect(v.header).toBeNull()
    expect(v.issues.map((i) => i.code)).toContain('not-sms')
  })
})

describe('emuIdentity', () => {
  it('dedupes by kind, title and checksum', () => {
    const a: EmuHeaderInfo = { kind: 'gb', title: 'TETRIS', region: null, byteOrder: 'native', checksum: '1a2b', headerOk: true, layout: null }
    const b: EmuHeaderInfo = { kind: 'gb', title: 'Tetris', region: null, byteOrder: 'native', checksum: '1a2b', headerOk: true, layout: null }
    const c: EmuHeaderInfo = { kind: 'gb', title: 'TETRIS', region: null, byteOrder: 'native', checksum: '1a2c', headerOk: true, layout: null }
    expect(emuIdentity(a, 0)).toBe(emuIdentity(b, 0))
    expect(emuIdentity(a, 0)).not.toBe(emuIdentity(c, 0))
  })

  it('falls back to the file size when the checksum is unset', () => {
    const a: EmuHeaderInfo = { kind: 'snes', title: 'GAME', region: null, byteOrder: 'native', checksum: '0000', headerOk: false, layout: 'LoROM' }
    const b: EmuHeaderInfo = { kind: 'snes', title: 'GAME', region: null, byteOrder: 'native', checksum: '0000', headerOk: false, layout: 'LoROM' }
    expect(emuIdentity(a, 1024)).not.toBe(emuIdentity(b, 2048))
    expect(emuIdentity(a, 1024)).toBe(emuIdentity({ ...b }, 1024))
  })

  it('uses the product code as the title stand-in for SMS/GG ROMs', () => {
    const a: EmuHeaderInfo = { kind: 'sms', title: '', region: 'SMS Export', byteOrder: 'native', checksum: '1234', headerOk: true, layout: 'sms', productCode: '000000' }
    const b: EmuHeaderInfo = { kind: 'sms', title: '', region: 'SMS Export', byteOrder: 'native', checksum: '1234', headerOk: true, layout: 'sms', productCode: '000001' }
    expect(emuIdentity(a, 0)).toContain('000000')
    expect(emuIdentity(a, 0)).not.toBe(emuIdentity(b, 0))
  })
})

describe('inspectEmuFile', () => {
  it('parses a Game Boy title and region from the cartridge header', () => {
    const p = write('Tetris.gb', makeGB('TETRIS', 0x00))
    const info = inspectEmuFile(p)
    expect(info).toMatchObject({ kind: 'gb', title: 'TETRIS', region: 'Japan' })
  })

  it('labels a .gbc file as a Game Boy Color ROM', () => {
    const p = write('Kirby.gbc', makeGB('KIRBY'))
    expect(inspectEmuFile(p)).toMatchObject({ kind: 'gbc', title: 'KIRBY', region: 'Japan' })
  })

  it('parses a LoROM SNES header', () => {
    const p = write('Mario.smc', makeSNES('SUPER MARIO WORLD', 1, 0x7fc0))
    expect(inspectEmuFile(p)).toMatchObject({ kind: 'snes', title: 'SUPER MARIO WORLD', region: 'USA' })
  })

  it('parses an SMS header and exposes the product code', () => {
    const p = write('Sonic.sms', makeSMS(4, 0))
    expect(inspectEmuFile(p)).toMatchObject({ kind: 'sms', region: 'SMS Export', productCode: '000000' })
  })

  it('returns null for files without a valid header', () => {
    const p = write('broken.gb', Buffer.alloc(0x150))
    expect(inspectEmuFile(p)).toBeNull()
    const p2 = write('notes.txt', Buffer.from('hello'))
    expect(inspectEmuFile(p2)).toBeNull()
  })
})
