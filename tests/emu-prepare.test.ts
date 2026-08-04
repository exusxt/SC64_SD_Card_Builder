import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepare } from '../src/main/prepare'
import type { PrepareOptions } from '../src/shared/types'

const NINTENDO_LOGO = Buffer.from(
  'ceed6666cc0d000b03730083000c000d0008111f8889000edccc6ee6ddddd999bbbb67636e0eecccdddc999fbbb9333e',
  'hex'
)

function fixGBHeaderChecksum(buf: Buffer): void {
  let sum = 0
  for (let i = 0x134; i <= 0x14c; i++) sum -= buf[i] + 1
  buf[0x14d] = sum & 0xff
}

function makeGB(title: string): Buffer {
  const buf = Buffer.alloc(0x150)
  NINTENDO_LOGO.copy(buf, 0x104)
  buf.write(title, 0x134, 'latin1')
  buf[0x14a] = 0x00
  fixGBHeaderChecksum(buf)
  return buf
}

function makeSwappedGB(title: string): Buffer {
  const raw = makeGB(title)
  const out = Buffer.alloc(raw.length)
  for (let i = 0; i + 2 <= out.length; i += 2) {
    out[i] = raw[i + 1]
    out[i + 1] = raw[i]
  }
  fixGBHeaderChecksum(out)
  return out
}

function makeSNES(title: string, offset: number, checksumState: 'valid' | 'bad' = 'valid'): Buffer {
  const size = Math.max(0x8000, offset + 0x8000)
  const buf = Buffer.alloc(size)
  buf.write(title, offset, 'latin1')
  buf[offset + 0x1a] = 0x01
  const checksum = 0x1234
  buf.writeUInt16LE(checksum, offset + 0x1c)
  buf.writeUInt16LE(checksumState === 'bad' ? 0x0000 : 0xffff ^ checksum, offset + 0x1e)
  return buf
}

function makeSMS(regionNib: number, sizeNib: number, headered = false): Buffer {
  const off = headered ? 0x81f0 : 0x7ff0
  const buf = Buffer.alloc(headered ? 0x8200 : 0x8000)
  buf.write('TMR SEGA', off, 'latin1')
  buf.writeUInt16LE(0x1234, off + 0x0a)
  buf.write('000000', off + 0x0c, 'hex')
  buf[off + 0x0f] = (sizeNib << 4) | regionNib
  return buf
}

async function makeOptions(source: string, dest: string, romTypes: string[]): Promise<PrepareOptions> {
  return {
    destination: dest,
    locale: 'en',
    mode: 'direct',
    downloadMenu: false,
    downloadMetadata: false,
    createFolders: false,
    downloadEmulators: false,
    emulators: { nes: false, snes: false, gb: false, sms: false, chf: false },
    installDDIPL: false,
    ddiplSource: null,
    copyRoms: true,
    romSources: [source],
    romTypes,
    createSaves: false,
    includeSubdirs: false,
    overwrite: false,
    organizeRoms: false,
    stockFolders: false,
    copyCheats: false,
    verify: false
  }
}

describe('prepare emulator ROM validation', () => {
  it('validates, dedupes and copies Game Boy/SNES ROMs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-emu-prep-'))
    try {
      const source = join(root, 'source')
      const dest = join(root, 'dest')
      await mkdir(source, { recursive: true })
      await mkdir(dest, { recursive: true })

      await writeFile(join(source, 'Tetris.gb'), makeGB('TETRIS'))
      await writeFile(join(source, 'Tetris_copy.gb'), makeGB('TETRIS'))
      await writeFile(join(source, 'Kirby.gbc'), makeGB('KIRBY'))
      await writeFile(join(source, 'Mario.smc'), makeSNES('SUPER MARIO WORLD', 0x81c0))

      const events: string[] = []
      const res = await prepare(await makeOptions(source, dest, ['gb', 'snes']), {
        emit: (ev) => {
          if (ev.type === 'log') events.push(ev.message)
        },
        cancel: { cancelled: false }
      })
      expect(res.ok).toBe(true)

      const copied = (await readdir(dest)).filter((n) => !n.startsWith('sc64-report'))
      expect(copied).toEqual(expect.arrayContaining(['Tetris.gb', 'Kirby.gbc', 'Mario.smc']))
      expect(copied).toHaveLength(3)
      expect(events.some((m) => m.includes('duplicate'))).toBe(true)
      expect(events.some((m) => m.includes('ROM(s) checked'))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('warns about byte-swapped, corrupt and misnamed emulator ROMs without blocking the copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-emu-prep-'))
    try {
      const source = join(root, 'source')
      const dest = join(root, 'dest')
      await mkdir(source, { recursive: true })
      await mkdir(dest, { recursive: true })

      await writeFile(join(source, 'Swapped.gb'), makeSwappedGB('SWAPPED'))
      await writeFile(join(source, 'Corrupt.sfc'), makeSNES('CORRUPT', 0x7fc0, 'bad'))
      await writeFile(join(source, 'Misnamed.sfc'), makeSNES('HEADERED', 0x81c0))
      await writeFile(join(source, 'NotArom.gb'), Buffer.alloc(0x150))

      const events: string[] = []
      const res = await prepare(await makeOptions(source, dest, ['gb', 'snes']), {
        emit: (ev) => {
          if (ev.type === 'log') events.push(ev.message)
        },
        cancel: { cancelled: false }
      })
      expect(res.ok).toBe(true)

      const copied = (await readdir(dest)).filter((n) => !n.startsWith('sc64-report'))
      expect(copied).toHaveLength(4)
      expect(events.some((m) => m.includes('byte-swapped'))).toBe(true)
      expect(events.some((m) => m.includes('bad dump'))).toBe(true)
      expect(events.some((m) => m.includes('copier header'))).toBe(true)
      expect(events.some((m) => m.includes('Game Boy ROM'))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('validates, dedupes and routes SMS/GG ROMs into smsPlus64/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-emu-prep-'))
    try {
      const source = join(root, 'source')
      const dest = join(root, 'dest')
      await mkdir(source, { recursive: true })
      await mkdir(dest, { recursive: true })

      await writeFile(join(source, 'Sonic.sms'), makeSMS(4, 0))
      await writeFile(join(source, 'Sonic_copy.sms'), makeSMS(4, 0))
      await writeFile(join(source, 'Sonic.gg'), makeSMS(6, 0))
      await writeFile(join(source, 'NotArom.sms'), Buffer.alloc(0x8000))

      const options = await makeOptions(source, dest, ['sms'])
      options.stockFolders = true

      const events: string[] = []
      const res = await prepare(options, {
        emit: (ev) => {
          if (ev.type === 'log') events.push(ev.message)
        },
        cancel: { cancelled: false }
      })
      expect(res.ok).toBe(true)

      const copied = (await readdir(dest)).filter((n) => !n.startsWith('sc64-report'))
      expect(copied).toEqual(['smsPlus64'])
      const smsFiles = await readdir(join(dest, 'smsPlus64'))
      expect(smsFiles).toEqual(expect.arrayContaining(['Sonic.sms', 'Sonic.gg', 'NotArom.sms']))
      expect(smsFiles).toHaveLength(3)
      expect(events.some((m) => m.includes('duplicate'))).toBe(true)
      expect(events.some((m) => m.includes('Sega Master System / Game Gear'))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
