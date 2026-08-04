import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { listPreviewDir, loadPreviewBoxart, isInside } from '../src/main/preview'

let roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sc64-preview-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
  roots = []
})

function makeHeader(title: string, gameCode: string, country: string): Buffer {
  const buf = Buffer.alloc(0x100)
  buf.write('80371240', 0, 'hex')
  buf.write(title.padEnd(20, ' '), 0x20, 'latin1')
  buf.write(gameCode[0] ?? 'N', 0x3b, 'latin1')
  buf.write(gameCode[1] ?? '?', 0x3c, 'latin1')
  buf.write(gameCode[2] ?? '?', 0x3d, 'latin1')
  buf.write(gameCode[3] ?? country, 0x3e, 'latin1')
  buf.write(country, 0x3e, 'latin1')
  buf.write('\x00', 0x3f, 'latin1')
  return buf
}

function makeGBHeader(title: string): Buffer {
  const buf = Buffer.alloc(0x150)
  buf.write(title, 0x134, 'latin1')
  return buf
}

function makeSNESHeader(title: string): Buffer {
  const buf = Buffer.alloc(0x8000)
  buf.write(title, 0x7fc0, 'latin1')
  return buf
}

describe('listPreviewDir', () => {
  it('lists files and folders, hiding system files and the menu folder', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'sc64menu.n64'), Buffer.alloc(1024))
    writeFileSync(join(root, '.hidden'), 'x')
    writeFileSync(join(root, 'readme.txt'), 'hello')
    mkdirSync(join(root, 'menu', 'metadata'), { recursive: true })
    mkdirSync(join(root, 'Games'), { recursive: true })

    const entries = await listPreviewDir(root, '')
    expect(entries).not.toBeNull()
    const names = entries!.map((e) => e.name)
    expect(names).not.toContain('sc64menu.n64')
    expect(names).not.toContain('.hidden')
    expect(names).not.toContain('menu')
    expect(names).toContain('Games')
    expect(names).toContain('readme.txt')
    expect(entries![0].isDir).toBe(true)
  })

  it('parses N64 headers and resolves boxart + description by game code', async () => {
    const root = makeRoot()
    const meta = join(root, 'menu', 'metadata', 'N', 'G', 'E', 'E')
    mkdirSync(meta, { recursive: true })
    writeFileSync(join(meta, 'boxart_front.png'), Buffer.from([1, 2, 3]))
    writeFileSync(join(meta, 'description.txt'), '  A short description.  ')
    const games = join(root, 'Games')
    mkdirSync(games, { recursive: true })
    writeFileSync(join(games, 'Mario.z64'), makeHeader('SUPER MARIO 64', 'NGEE', 'E'))
    mkdirSync(join(games, 'saves'), { recursive: true })

    const entries = await listPreviewDir(root, 'Games')
    expect(entries).toHaveLength(1)
    const mario = entries![0]
    expect(mario.isDir).toBe(false)
    expect(mario.kind).toBe('n64')
    expect(mario.title).toBe('SUPER MARIO 64')
    expect(mario.gameCode).toBe('NGEE')
    expect(mario.region).toBe('USA')
    expect(mario.description).toBe('A short description.')
    expect(mario.boxart).toBe(join(meta, 'boxart_front.png'))
    expect(mario.size).toBe(0x100)
  })

  it('falls back to the 3-character boxart folder for other regions', async () => {
    const root = makeRoot()
    const meta = join(root, 'menu', 'metadata', 'N', 'F', 'Z')
    mkdirSync(meta, { recursive: true })
    writeFileSync(join(meta, 'boxart_front.png'), Buffer.from([9, 9]))
    const games = join(root, 'Games')
    mkdirSync(games, { recursive: true })
    writeFileSync(join(games, 'F-Zero.z64'), makeHeader('F-ZERO', 'NFZP', 'P'))

    const entries = await listPreviewDir(root, 'Games')
    expect(entries).toHaveLength(1)
    expect(entries![0].kind).toBe('n64')
    expect(entries![0].region).toBe('PAL')
    expect(entries![0].boxart).toBe(join(meta, 'boxart_front.png'))
  })

  it('falls back to the flat menu/boxart/<cartid>.png file', async () => {
    const root = makeRoot()
    const box = join(root, 'menu', 'boxart')
    mkdirSync(box, { recursive: true })
    writeFileSync(join(box, 'GE.png'), Buffer.from([3, 3]))
    const games = join(root, 'Games')
    mkdirSync(games, { recursive: true })
    writeFileSync(join(games, 'Mario.z64'), makeHeader('SUPER MARIO 64', 'NGEE', 'E'))

    const entries = await listPreviewDir(root, 'Games')
    expect(entries![0].kind).toBe('n64')
    expect(entries![0].boxart).toBe(join(box, 'GE.png'))
  })

  it('resolves the flat boxart case-insensitively', async () => {
    const root = makeRoot()
    const box = join(root, 'menu', 'boxart')
    mkdirSync(box, { recursive: true })
    writeFileSync(join(box, 'ge.png'), Buffer.from([4, 4]))
    const games = join(root, 'Games')
    mkdirSync(games, { recursive: true })
    writeFileSync(join(games, 'Mario.z64'), makeHeader('SUPER MARIO 64', 'NGEE', 'E'))

    const entries = await listPreviewDir(root, 'Games')
    expect(entries![0].boxart).toBe(join(box, 'ge.png'))
  })

  it('shows Game Boy and SNES titles from their headers', async () => {
    const root = makeRoot()
    const games = join(root, 'Games')
    mkdirSync(games, { recursive: true })
    writeFileSync(join(games, 'Tetris.gb'), makeGBHeader('TETRIS'))
    writeFileSync(join(games, 'Kirby.gbc'), makeGBHeader('KIRBY'))
    writeFileSync(join(games, 'Mario.smc'), makeSNESHeader('SUPER MARIO WORLD'))

    const entries = await listPreviewDir(root, 'Games')
    const byName = Object.fromEntries(entries!.map((e) => [e.name, e]))
    expect(byName['Tetris.gb'].kind).toBe('gb')
    expect(byName['Tetris.gb'].title).toBe('TETRIS')
    expect(byName['Kirby.gbc'].kind).toBe('gbc')
    expect(byName['Kirby.gbc'].title).toBe('KIRBY')
    expect(byName['Mario.smc'].kind).toBe('snes')
    expect(byName['Mario.smc'].title).toBe('SUPER MARIO WORLD')
  })

  it('marks non-N64 files and 64DD disks as other kinds', async () => {
    const root = makeRoot()
    mkdirSync(join(root, 'Games'), { recursive: true })
    writeFileSync(join(root, 'Games', 'notes.txt'), 'hi')
    writeFileSync(join(root, 'Games', 'disk.ndd'), Buffer.alloc(64))
    const entries = await listPreviewDir(root, 'Games')
    expect(entries!.map((e) => e.kind)).toEqual(['dd', 'other'])
  })

  it('hides system folders and report files at the root', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'sc64-report.html'), '<html></html>')
    writeFileSync(join(root, 'sc64-report.csv'), 'a,b\n')
    writeFileSync(join(root, 'readme.txt'), 'x')
    mkdirSync(join(root, 'System Volume Information'), { recursive: true })
    mkdirSync(join(root, '$RECYCLE.BIN'), { recursive: true })
    mkdirSync(join(root, 'Games'), { recursive: true })

    const entries = await listPreviewDir(root, '')
    const names = entries!.map((e) => e.name)
    expect(names).not.toContain('sc64-report.html')
    expect(names).not.toContain('sc64-report.csv')
    expect(names).not.toContain('System Volume Information')
    expect(names).not.toContain('$RECYCLE.BIN')
    expect(names).toContain('readme.txt')
    expect(names).toContain('Games')
  })

  it('rejects paths that escape the card root', async () => {
    const root = makeRoot()
    const entries = await listPreviewDir(root, '../../../etc')
    expect(entries).toBeNull()
  })

  it('returns null for a missing root', async () => {
    const entries = await listPreviewDir(join(tmpdir(), 'does-not-exist-sc64'), '')
    expect(entries).toBeNull()
  })
})

describe('isInside', () => {
  const root = join(sep, 'Users', 'foo', 'prepared')

  it('matches subpaths of a normal folder root', () => {
    expect(isInside(root, join(root, 'Games'))).toBe(true)
    expect(isInside(root, root)).toBe(true)
    expect(isInside(root, `${root}2`)).toBe(false)
  })

  it('matches subpaths of a drive root that has a trailing separator', () => {
    if (process.platform !== 'win32') return
    expect(isInside('E:\\', 'E:\\menu\\metadata\\boxart_front.png')).toBe(true)
    expect(isInside('E:\\', 'E:\\')).toBe(true)
    expect(isInside('E:\\', 'F:\\other')).toBe(false)
  })
})

describe('loadPreviewBoxart', () => {
  it('returns a PNG data URL for art under menu/metadata', () => {
    const root = makeRoot()
    const art = join(root, 'menu', 'metadata', 'N', 'G', 'E', 'E', 'boxart_front.png')
    mkdirSync(join(root, 'menu', 'metadata', 'N', 'G', 'E', 'E'), { recursive: true })
    writeFileSync(art, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const out = loadPreviewBoxart(root, art)
    expect(out).toBe('data:image/png;base64,iVBORw==')
  })

  it('returns a PNG data URL for art under menu/boxart', () => {
    const root = makeRoot()
    const art = join(root, 'menu', 'boxart', 'GE.png')
    mkdirSync(join(root, 'menu', 'boxart'), { recursive: true })
    writeFileSync(art, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const out = loadPreviewBoxart(root, art)
    expect(out).toBe('data:image/png;base64,iVBORw==')
  })

  it('rejects paths outside menu/metadata', () => {
    const root = makeRoot()
    const outside = join(root, 'sc64menu.n64')
    writeFileSync(outside, Buffer.alloc(16))
    expect(loadPreviewBoxart(root, outside)).toBeNull()
    expect(loadPreviewBoxart(root, join(root, '..', 'x.png'))).toBeNull()
  })
})
