import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import AdmZip from 'adm-zip'
import SevenZip from '7z-wasm'
import { extractArchive, extract7z, extractZip } from '../src/main/unzip'

function fsMkdirP(fs: SevenZip['FS'], path: string): void {
  try {
    fs.mkdir(path)
  } catch {
    /* already exists */
  }
}

async function create7z(sourceFile: string, archivePath: string): Promise<void> {
  const sz = await SevenZip({ noExitRuntime: true, print: () => {}, printErr: () => {} })
  fsMkdirP(sz.FS, '/sc64')
  fsMkdirP(sz.FS, '/sc64/in')
  fsMkdirP(sz.FS, '/sc64/out')
  sz.FS.mount(sz.NODEFS, { root: dirname(sourceFile) }, '/sc64/in')
  sz.FS.mount(sz.NODEFS, { root: dirname(archivePath) }, '/sc64/out')
  const code = (sz.callMain as unknown as (args: string[]) => number)([
    'a',
    `/sc64/out/${basename(archivePath)}`,
    `/sc64/in/${basename(sourceFile)}`,
    '-y'
  ])
  if (code !== 0) throw new Error(`7z create failed with exit code ${code}`)
}

let crcTable: number[] | null = null
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function buildZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const crc = crc32(e.data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0, 8)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(e.data.length, 18)
    lh.writeUInt32LE(e.data.length, 22)
    lh.writeUInt16LE(name.length, 26)
    parts.push(lh, name, e.data)

    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0, 10)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(e.data.length, 20)
    ch.writeUInt32LE(e.data.length, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([ch, name]))
    offset += 30 + name.length + e.data.length
  }
  const cd = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, eocd])
}

describe('archive extraction', () => {
  it('extracts ZIP archives into the destination directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-zip-'))
    try {
      const zipPath = join(root, 'roms.zip')
      const destDir = join(root, 'out')
      const zip = new AdmZip()
      zip.addFile('roms/Game.z64', Buffer.from('N64ROMDATA'))
      await zip.writeZipPromise(zipPath)

      const count = await extractZip(zipPath, destDir)
      expect(count).toBe(1)
      expect(await readFile(join(destDir, 'roms', 'Game.z64'), 'utf8')).toBe('N64ROMDATA')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('skips unsafe ZIP entries such as ../, absolute and drive-letter paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-safe-'))
    try {
      const zipPath = join(root, 'evil.zip')
      const destDir = join(root, 'out')
      await mkdir(destDir, { recursive: true })
      await writeFile(
        zipPath,
        buildZip([
          { name: 'safe/z64.bin', data: Buffer.from('ok') },
          { name: '../escape.txt', data: Buffer.from('nope') },
          { name: '..\\backslash.txt', data: Buffer.from('nope') },
          { name: '/abs.txt', data: Buffer.from('nope') },
          { name: 'C:/drive.txt', data: Buffer.from('nope') }
        ])
      )

      await extractZip(zipPath, destDir)
      expect(existsSync(join(destDir, 'safe', 'z64.bin'))).toBe(true)
      expect(existsSync(join(destDir, 'escape.txt'))).toBe(false)
      expect(existsSync(join(destDir, 'backslash.txt'))).toBe(false)
      expect(existsSync(join(destDir, 'abs.txt'))).toBe(false)
      expect(existsSync(join(destDir, 'drive.txt'))).toBe(false)
      expect(existsSync(join(root, 'escape.txt'))).toBe(false)
      expect(existsSync(join(root, 'drive.txt'))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('extracts 7z archives via extract7z', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-7z-'))
    try {
      const srcDir = join(root, 'src')
      await mkdir(srcDir, { recursive: true })
      const payload = join(srcDir, 'Game.z64')
      await writeFile(payload, Buffer.from('N64ROMDATA'))
      const archivePath = join(root, 'games.7z')
      await create7z(payload, archivePath)
      expect(existsSync(archivePath)).toBe(true)

      const destDir = join(root, 'out')
      const count = await extract7z(archivePath, destDir)
      expect(count).toBe(1)
      expect(await readFile(join(destDir, 'Game.z64'), 'utf8')).toBe('N64ROMDATA')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('dispatches .7z to 7z and everything else to ZIP via extractArchive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc64-dispatch-'))
    try {
      const srcDir = join(root, 'src')
      await mkdir(srcDir, { recursive: true })
      const payload = join(srcDir, 'Game.z64')
      await writeFile(payload, Buffer.from('N64ROMDATA'))
      const zipPath = join(root, 'games.zip')
      const sevenZipPath = join(root, 'games.7z')
      await create7z(payload, sevenZipPath)
      const zip = new AdmZip()
      zip.addFile('Game.z64', Buffer.from('N64ROMDATA'))
      await zip.writeZipPromise(zipPath)

      const zipOut = join(root, 'zip-out')
      await extractArchive(zipPath, zipOut)
      expect(await readFile(join(zipOut, 'Game.z64'), 'utf8')).toBe('N64ROMDATA')

      const szOut = join(root, 'sz-out')
      await extractArchive(sevenZipPath, szOut)
      expect(await readFile(join(szOut, 'Game.z64'), 'utf8')).toBe('N64ROMDATA')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
