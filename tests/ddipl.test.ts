import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanDDIPLFolder, installDDIPL, DD_IPL_IDS } from '../src/main/ddipl'
import { DD_IPL_SIZE } from '../src/shared/types'

function makeIpl(id: string, opts: { swapped?: boolean; size?: number; idAt?: number } = {}): Buffer {
  const buf = Buffer.alloc(opts.size ?? DD_IPL_SIZE)
  if (opts.swapped) {
    buf[0] = 0x27
    buf[1] = 0x80
    buf[2] = 0x07
    buf[3] = 0x40
  } else {
    buf[0] = 0x80
    buf[1] = 0x27
    buf[2] = 0x07
    buf[3] = 0x40
  }
  buf.write(id, opts.idAt ?? 0x3b, 'latin1')
  return buf
}

describe('scanDDIPLFolder', () => {
  it('returns null for a missing directory', async () => {
    expect(await scanDDIPLFolder(join(tmpdir(), 'does-not-exist-64ddipl'))).toBeNull()
  })

  it('returns null for a file path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-ddipl-'))
    try {
      await writeFile(join(root, 'NDDJ0.n64'), makeIpl('NDDJ'))
      expect(await scanDDIPLFolder(join(root, 'NDDJ0.n64'))).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports every canonical ID as missing in an empty folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-ddipl-'))
    try {
      const res = await scanDDIPLFolder(root)
      expect(res).not.toBeNull()
      expect(res!.files).toHaveLength(DD_IPL_IDS.length)
      for (const f of res!.files) {
        expect(f.present).toBe(false)
        expect(f.valid).toBe(false)
        expect(f.name).toBeNull()
      }
      expect(res!.unrecognized).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('detects valid big-endian dumps for Japanese and US drives', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-ddipl-'))
    try {
      await writeFile(join(root, 'NDDJ0.n64'), makeIpl('NDDJ'))
      await writeFile(join(root, 'NDDE0.n64'), makeIpl('NDDE'))
      const res = await scanDDIPLFolder(root)
      const byId = new Map(res!.files.map((f) => [f.id, f]))
      expect(byId.get('NDDJ0')).toMatchObject({ present: true, valid: true, byteOrder: 'be', idOk: true, size: DD_IPL_SIZE })
      expect(byId.get('NDDE0')).toMatchObject({ present: true, valid: true, byteOrder: 'be', idOk: true })
      expect(byId.get('NDXJ0')!.present).toBe(false)
      expect(res!.unrecognized).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts the dev-drive ID and lowercase extensions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-ddipl-'))
    try {
      await writeFile(join(root, 'ndxj0.z64'), makeIpl('NDXJ'))
      const res = await scanDDIPLFolder(root)
      const f = res!.files.find((x) => x.id === 'NDXJ0')!
      expect(f.present).toBe(true)
      expect(f.valid).toBe(true)
      expect(res!.unrecognized).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('flags byte-swapped .v64 dumps as invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-ddipl-'))
    try {
      await writeFile(join(root, 'NDDE0.v64'), makeIpl('NDDE', { swapped: true }))
      const res = await scanDDIPLFolder(root)
      const f = res!.files.find((x) => x.id === 'NDDE0')!
      expect(f.present).toBe(true)
      expect(f.byteOrder).toBe('swapped')
      expect(f.valid).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('flags wrong-size files as invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-ddipl-'))
    try {
      await writeFile(join(root, 'NDDJ1.n64'), makeIpl('NDDJ', { size: 4096 }))
      const res = await scanDDIPLFolder(root)
      const f = res!.files.find((x) => x.id === 'NDDJ1')!
      expect(f.present).toBe(true)
      expect(f.valid).toBe(false)
      expect(f.size).toBe(4096)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('flags a disk-ID mismatch as invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-ddipl-'))
    try {
      await writeFile(join(root, 'NDDJ0.n64'), makeIpl('ZZZZ'))
      const res = await scanDDIPLFolder(root)
      const f = res!.files.find((x) => x.id === 'NDDJ0')!
      expect(f.present).toBe(true)
      expect(f.idOk).toBe(false)
      expect(f.valid).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports unrecognized files that do not match any canonical ID', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-ddipl-'))
    try {
      await writeFile(join(root, 'NDDJ0.n64'), makeIpl('NDDJ'))
      await writeFile(join(root, 'random-game.n64'), Buffer.alloc(8))
      await writeFile(join(root, 'notes.txt'), Buffer.alloc(8))
      const res = await scanDDIPLFolder(root)
      expect(res!.unrecognized).toEqual(['random-game.n64'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('installDDIPL', () => {
  it('copies only valid dumps as canonical <ID>.n64 files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-ddipl-'))
    try {
      const src = join(root, 'src')
      const dest = join(root, 'dest')
      await mkdir(src)
      const jp = makeIpl('NDDJ')
      await writeFile(join(src, 'NDDJ0.n64'), jp)
      await writeFile(join(src, 'NDDE0.v64'), makeIpl('NDDE', { swapped: true }))

      const res = await installDDIPL(src, dest)
      expect(res.installed).toEqual(['NDDJ0'])
      expect(res.invalid).toEqual(['NDDE0'])
      expect(res.missing).toEqual(['NDDJ1', 'NDDJ2', 'NDXJ0'])

      const copied = await readFile(join(dest, 'NDDJ0.n64'))
      expect(copied.length).toBe(DD_IPL_SIZE)
      expect(copied.equals(jp)).toBe(true)
      await expect(access(join(dest, 'NDDE0.n64'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports every ID as missing when the source does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-ddipl-'))
    try {
      const res = await installDDIPL(join(root, 'nope'), join(root, 'dest'))
      expect(res.installed).toEqual([])
      expect(res.invalid).toEqual([])
      expect(res.missing).toEqual([...DD_IPL_IDS])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
