import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { inspectEmuFile, isGBExt, isSNESExt } from '../src/main/emuheader'

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

function makeGB(title: string, destCode = 0x00): Buffer {
  const buf = Buffer.alloc(0x150)
  buf.write(title, 0x134, 'latin1')
  buf[0x14a] = destCode
  return buf
}

function makeSNES(title: string, region: number, offset: number): Buffer {
  const size = Math.max(0x8000, offset + 0x8000)
  const buf = Buffer.alloc(size)
  buf.write(title, offset, 'latin1')
  buf[offset + 0x1a] = region
  return buf
}

describe('isGBExt / isSNESExt', () => {
  it('recognizes the supported extensions', () => {
    expect(isGBExt('Tetris.gb')).toBe(true)
    expect(isGBExt('Kirby.gbc')).toBe(true)
    expect(isGBExt('Mario.smc')).toBe(false)
    expect(isSNESExt('Mario.smc')).toBe(true)
    expect(isSNESExt('Zelda.sfc')).toBe(true)
    expect(isSNESExt('StarFox.fig')).toBe(true)
    expect(isSNESExt('Tetris.gb')).toBe(false)
  })
})

describe('inspectEmuFile', () => {
  it('parses a Game Boy title and region from the cartridge header', () => {
    const p = write('Tetris.gb', makeGB('TETRIS', 0x00))
    expect(inspectEmuFile(p)).toEqual({ kind: 'gb', title: 'TETRIS', region: 'Japan' })
  })

  it('labels a .gbc file as a Game Boy Color ROM', () => {
    const p = write('Kirby.gbc', makeGB('KIRBY'))
    expect(inspectEmuFile(p)).toEqual({ kind: 'gbc', title: 'KIRBY', region: 'Japan' })
  })

  it('parses a LoROM SNES header', () => {
    const p = write('Mario.smc', makeSNES('SUPER MARIO WORLD', 1, 0x7fc0))
    expect(inspectEmuFile(p)).toEqual({ kind: 'snes', title: 'SUPER MARIO WORLD', region: 'USA' })
  })

  it('parses a HiROM SNES header', () => {
    const p = write('Zelda.sfc', makeSNES('ZELDA NO DENSETSU', 0, 0xffc0))
    expect(inspectEmuFile(p)).toEqual({ kind: 'snes', title: 'ZELDA NO DENSETSU', region: 'Japan' })
  })

  it('returns null for files without a valid header', () => {
    const p = write('broken.gb', Buffer.alloc(0x150))
    expect(inspectEmuFile(p)).toBeNull()
    const p2 = write('notes.txt', Buffer.from('hello'))
    expect(inspectEmuFile(p2)).toBeNull()
  })
})
