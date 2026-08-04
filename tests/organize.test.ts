import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseHeader } from '../src/main/n64validate'
import { cleanTitle, organizeBase, uniqueBase, chtNameOf } from '../src/main/organize'
import { prepare } from '../src/main/prepare'
import type { PrepareOptions } from '../src/shared/types'

function makeZ64Buffer(overrides?: { title?: string; gameCode?: string; country?: string }): Buffer {
  const buf = Buffer.alloc(0x800000)
  buf[0] = 0x80
  buf[1] = 0x37
  buf[2] = 0x12
  buf[3] = 0x40
  if (overrides?.title) buf.write(overrides.title, 0x20, 'latin1')
  if (overrides?.gameCode) buf.write(overrides.gameCode, 0x3b, 'latin1')
  if (overrides?.country) buf.write(overrides.country, 0x3e, 'latin1')
  return buf
}

describe('cleanTitle', () => {
  it('strips characters that are invalid in file names', () => {
    expect(cleanTitle('ZELDA <>:"/\\|?*')).toBe('ZELDA')
    expect(cleanTitle('A*B?C')).toBe('A B C')
  })

  it('collapses whitespace and trims trailing dots/spaces', () => {
    expect(cleanTitle('  SUPER   MARIO 64  ')).toBe('SUPER MARIO 64')
    expect(cleanTitle('MARIO...')).toBe('MARIO')
  })

  it('falls back to Unknown for empty titles', () => {
    expect(cleanTitle('')).toBe('Unknown')
    expect(cleanTitle('  ')).toBe('Unknown')
    expect(cleanTitle('***')).toBe('Unknown')
  })
})

describe('organizeBase', () => {
  it('builds a Title (Region) folder name from a header', () => {
    const header = parseHeader(makeZ64Buffer({ title: 'SUPER MARIO 64', gameCode: 'NSME', country: 'E' }), 0x800000)!
    expect(organizeBase(header)).toBe('SUPER MARIO 64 (USA)')
  })

  it('uses the display label for other regions', () => {
    const header = parseHeader(makeZ64Buffer({ title: 'MARIO', gameCode: 'NSMJ', country: 'J' }), 0x800000)!
    expect(organizeBase(header)).toBe('MARIO (Japan)')
    const pal = parseHeader(makeZ64Buffer({ title: 'MARIO', gameCode: 'NSMP', country: 'P' }), 0x800000)!
    expect(organizeBase(pal)).toBe('MARIO (PAL)')
  })
})

describe('uniqueBase', () => {
  it('keeps the first name and suffixes collisions', () => {
    const used = new Set<string>()
    expect(uniqueBase('MARIO (USA)', used)).toBe('MARIO (USA)')
    expect(uniqueBase('MARIO (USA)', used)).toBe('MARIO (USA) (2)')
    expect(uniqueBase('MARIO (USA)', used)).toBe('MARIO (USA) (3)')
  })

  it('treats names case-insensitively', () => {
    const used = new Set<string>()
    uniqueBase('mario (usa)', used)
    expect(uniqueBase('MARIO (USA)', used)).toBe('MARIO (USA) (2)')
  })
})

describe('chtNameOf', () => {
  it('swaps the extension for a .cht path', () => {
    expect(chtNameOf('/x/y/GAME.z64')).toBe('/x/y/GAME.cht')
    expect(chtNameOf('GAME.v64')).toBe('GAME.cht')
    expect(chtNameOf('noext')).toBe('noext.cht')
  })
})

describe('prepare organizer + cheats', () => {
  it('organizes N64 ROMs into Title (Region) folders, copies sibling .cht files, and leaves other types untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-test-'))
    const source = join(root, 'source')
    const dest = join(root, 'dest')
    await mkdir(source, { recursive: true })
    await mkdir(dest, { recursive: true })

    const mario = makeZ64Buffer({ title: 'SUPER MARIO 64', gameCode: 'NSM0', country: 'E' })
    await writeFile(join(source, 'Mario.z64'), mario)
    await writeFile(join(source, 'Mario.cht'), 'cheat-content')
    await writeFile(join(source, 'Mario_copy.z64'), mario)
    await writeFile(join(source, 'Sm64a.z64'), makeZ64Buffer({ title: 'SUPER MARIO 64', gameCode: 'NSN0', country: 'E' }))
    await writeFile(join(source, 'Sm64b.z64'), makeZ64Buffer({ title: 'SUPER MARIO 64', gameCode: 'NSO0', country: 'E' }))
    await writeFile(join(source, 'Zelda.z64'), makeZ64Buffer({ title: 'THE LEGEND OF ZELDA', gameCode: 'NZL0', country: 'E' }))
    await writeFile(join(source, 'Homebrew.nes'), 'nes-rom')

    const options: PrepareOptions = {
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
      romTypes: ['n64', 'nes'],
      createSaves: false,
      includeSubdirs: false,
      overwrite: false,
      organizeRoms: true,
      stockFolders: false,
      copyCheats: true,
      verify: false
    }

    const events: string[] = []
    const res = await prepare(options, {
      emit: (ev) => {
        if (ev.type === 'log') events.push(ev.message)
      },
      cancel: { cancelled: false }
    })

    expect(res.ok).toBe(true)

    expect(await readdir(join(dest, 'SUPER MARIO 64 (USA)'))).toEqual(
      expect.arrayContaining(['SUPER MARIO 64 (USA).z64', 'SUPER MARIO 64 (USA).cht'])
    )
    expect(await readdir(join(dest, 'SUPER MARIO 64 (USA) (2)'))).toContain('SUPER MARIO 64 (USA) (2).z64')
    expect(await readdir(join(dest, 'THE LEGEND OF ZELDA (USA)'))).toContain('THE LEGEND OF ZELDA (USA).z64')
    expect(await readdir(dest)).toContain('Homebrew.nes')

    expect(events.some((m) => m.includes('cheat'))).toBe(true)

    await rm(root, { recursive: true, force: true })
  })

  it('skips duplicates by identity even when organizing is on', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-test-'))
    const source = join(root, 'source')
    const dest = join(root, 'dest')
    await mkdir(source, { recursive: true })
    await mkdir(dest, { recursive: true })

    const rom = makeZ64Buffer({ title: 'BANJO', gameCode: 'NBK0', country: 'E' })
    await writeFile(join(source, 'Banjo.z64'), rom)
    await writeFile(join(source, 'Banjo_again.z64'), rom)

    const options: PrepareOptions = {
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
      romTypes: ['n64'],
      createSaves: false,
      includeSubdirs: false,
      overwrite: false,
      organizeRoms: true,
      stockFolders: false,
      copyCheats: false,
      verify: false
    }

    const res = await prepare(options, { emit: () => {}, cancel: { cancelled: false } })
    expect(res.ok).toBe(true)
    const folders = (await readdir(dest)).filter((n) => !n.startsWith('.') && n !== 'sc64-report.csv' && n !== 'sc64-report.html')
    expect(folders).toEqual(['BANJO (USA)'])
    expect(await readdir(join(dest, 'BANJO (USA)'))).toHaveLength(1)

    await rm(root, { recursive: true, force: true })
  })
})

describe('prepare stock-card routing', () => {
  it('places GB/GBC ROMs under GBC/ and SNES ROMs under snes_rom/, leaving others at the root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-test-'))
    const source = join(root, 'source')
    const dest = join(root, 'dest')
    await mkdir(source, { recursive: true })
    await mkdir(dest, { recursive: true })

    await writeFile(join(source, 'Tetris.gb'), 'gb-rom')
    await writeFile(join(source, 'Kirby.gbc'), 'gbc-rom')
    await writeFile(join(source, 'Mario.smc'), 'snes-rom')
    await writeFile(join(source, 'Zelda.sfc'), 'snes-rom')
    await writeFile(join(source, 'Jackal.nes'), 'nes-rom')

    const options: PrepareOptions = {
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
      romTypes: ['gb', 'snes', 'nes'],
      createSaves: false,
      includeSubdirs: false,
      overwrite: false,
      organizeRoms: false,
      stockFolders: true,
      copyCheats: false,
      verify: false
    }

    const res = await prepare(options, { emit: () => {}, cancel: { cancelled: false } })
    expect(res.ok).toBe(true)
    expect(await readdir(join(dest, 'GBC'))).toEqual(expect.arrayContaining(['Tetris.gb', 'Kirby.gbc']))
    expect(await readdir(join(dest, 'snes_rom'))).toEqual(expect.arrayContaining(['Mario.smc', 'Zelda.sfc']))
    expect(await readdir(dest)).toContain('Jackal.nes')

    await rm(root, { recursive: true, force: true })
  })

  it('does not double up when the source already uses GBC/ or snes_rom/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-test-'))
    const source = join(root, 'source')
    const dest = join(root, 'dest')
    await mkdir(join(source, 'GBC', 'sub'), { recursive: true })
    await mkdir(join(source, 'snes_rom'), { recursive: true })
    await mkdir(dest, { recursive: true })

    await writeFile(join(source, 'GBC', 'sub', 'Tetris.gb'), 'gb-rom')
    await writeFile(join(source, 'snes_rom', 'Mario.smc'), 'snes-rom')

    const options: PrepareOptions = {
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
      romTypes: ['gb', 'snes'],
      createSaves: false,
      includeSubdirs: true,
      overwrite: false,
      organizeRoms: false,
      stockFolders: true,
      copyCheats: false,
      verify: false
    }

    const res = await prepare(options, { emit: () => {}, cancel: { cancelled: false } })
    expect(res.ok).toBe(true)
    expect(await readdir(join(dest, 'GBC', 'sub'))).toContain('Tetris.gb')
    expect(await readdir(join(dest, 'snes_rom'))).toContain('Mario.smc')
    expect(await readdir(join(dest, 'GBC'))).toEqual(['sub'])
    expect(await readdir(join(dest, 'snes_rom'))).toEqual(['Mario.smc'])

    await rm(root, { recursive: true, force: true })
  })
})
