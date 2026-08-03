import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectCard, parseMenuVersion } from '../src/main/inspect'

function makeMenuBinary(version: string | null, timestamp = '2026-08-03 12:00:00'): Buffer {
  const buf = Buffer.alloc(0x400)
  buf[0] = 0x80
  buf[1] = 0x37
  buf[2] = 0x12
  buf[3] = 0x40
  buf.write('N64FlashcartMenu', 0x20, 'latin1')
  buf.write(timestamp, 0x100, 'latin1')
  if (version) buf.write(version, 0x100 + timestamp.length + 29, 'latin1')
  return buf
}

describe('parseMenuVersion', () => {
  it('reads the version of a release build', () => {
    expect(parseMenuVersion(makeMenuBinary('V0.3.2'))).toBe('V0.3.2')
  })

  it('reads a version that is placed before the timestamp', () => {
    const buf = Buffer.alloc(0x400)
    buf.write('V0.3.0', 0x100, 'latin1')
    buf.write('2025-11-15 16:17:01', 0x180, 'latin1')
    expect(parseMenuVersion(buf)).toBe('V0.3.0')
  })

  it('detects a lowercase v prefix', () => {
    expect(parseMenuVersion(makeMenuBinary('v1.2.3'))).toBe('v1.2.3')
  })

  it('reports dev builds (no version string, but a timestamp) as Preview release', () => {
    expect(parseMenuVersion(makeMenuBinary(null))).toBe('Preview release')
  })

  it('returns null when there is no build timestamp', () => {
    expect(parseMenuVersion(Buffer.alloc(0x200))).toBeNull()
    expect(parseMenuVersion(Buffer.from('no useful metadata here'))).toBeNull()
  })

  it('ignores a version string far away from any timestamp', () => {
    const buf = Buffer.alloc(0x4000)
    buf.write('V9.9.9', 0x100, 'latin1')
    buf.write('2026-01-01 00:00:00', 0x3800, 'latin1')
    expect(parseMenuVersion(buf)).toBe('Preview release')
  })
})

async function makeCard(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sc64-inspect-'))
  const menuDir = join(root, 'menu')
  const emuDir = join(menuDir, 'emulators')
  const metaDir = join(menuDir, 'metadata')
  const saves = join(root, 'saves')
  await mkdir(menuDir, { recursive: true })
  await mkdir(emuDir, { recursive: true })
  await mkdir(metaDir, { recursive: true })
  await mkdir(saves, { recursive: true })
  await writeFile(join(root, 'sc64menu.n64'), makeMenuBinary('V0.3.2'))
  await writeFile(join(emuDir, 'sodium64.z64'), Buffer.alloc(0x100))
  await writeFile(join(root, 'Super Mario 64.z64'), Buffer.alloc(0x800000))
  await writeFile(join(root, 'A Game.nes'), Buffer.alloc(0x10))
  await writeFile(join(root, 'notes.txt'), Buffer.alloc(0x10))
  await writeFile(join(metaDir, 'index.json'), Buffer.from('{}'))
  return root
}

describe('inspectCard', () => {
  it('reports null for a missing destination', async () => {
    expect(await inspectCard(join(tmpdir(), 'does-not-exist-sc64'))).toBeNull()
  })

  it('reports null for a file path', async () => {
    const dir = await makeCard()
    try {
      expect(await inspectCard(join(dir, 'sc64menu.n64'))).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('inspects a card and parses the installed menu version', async () => {
    const root = await makeCard()
    try {
      const info = await inspectCard(root)
      expect(info).not.toBeNull()
      expect(info!.menu.present).toBe(true)
      expect(info!.menu.version).toBe('V0.3.2')
      expect(info!.menu.size).toBeGreaterThan(0)
      expect(info!.roms.n64).toBe(1)
      expect(info!.roms.other).toBe(1)
      expect(info!.saves).toBe(1)
      expect(info!.files).toBe(6)
      expect(info!.bytes).toBeGreaterThan(0)
      expect(typeof info!.freeBytes).toBe('number')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not count the root menu file as a game ROM', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-inspect-'))
    try {
      await writeFile(join(root, 'sc64menu.n64'), makeMenuBinary('V0.3.2'))
      const info = await inspectCard(root)
      expect(info!.roms.n64).toBe(0)
      expect(info!.menu.present).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('ignores ROMs inside the reserved menu/ folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-inspect-'))
    try {
      const emu = join(root, 'menu', 'emulators')
      await mkdir(emu, { recursive: true })
      await writeFile(join(emu, 'sodium64.z64'), Buffer.alloc(0x100))
      const info = await inspectCard(root)
      expect(info!.roms.n64).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
