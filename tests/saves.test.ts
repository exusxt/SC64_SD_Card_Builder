import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupSaves, restoreSaves } from '../src/main/saves'

let roots: string[] = []

afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
  roots = []
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sc64-saves-'))
  roots.push(root)
  return root
}

describe('backupSaves', () => {
  it('mirrors every saves/ tree (including nested ones) into the backup folder', async () => {
    const card = makeRoot()
    const backup = makeRoot()
    mkdirSync(join(card, 'Zelda (USA)', 'saves'), { recursive: true })
    mkdirSync(join(card, 'GBC', 'Tetris', 'saves'), { recursive: true })
    writeFileSync(join(card, 'Zelda (USA)', 'saves', 'ZELDA.sav'), 'save-data')
    writeFileSync(join(card, 'GBC', 'Tetris', 'saves', 'TETRIS.sav'), 'gb-data')

    const res = await backupSaves(card, backup, 'en')
    expect(res.ok).toBe(true)
    expect(res.files).toBe(2)
    expect(res.folders).toBe(2)
    expect(res.bytes).toBeGreaterThan(0)

    expect(readFileSync(join(backup, 'Zelda (USA)', 'saves', 'ZELDA.sav'), 'utf8')).toBe('save-data')
    expect(readFileSync(join(backup, 'GBC', 'Tetris', 'saves', 'TETRIS.sav'), 'utf8')).toBe('gb-data')
  })

  it('reports no saves found when the card has none', async () => {
    const card = makeRoot()
    const backup = makeRoot()
    mkdirSync(join(card, 'Game (USA)'), { recursive: true })

    const res = await backupSaves(card, backup, 'en')
    expect(res.ok).toBe(true)
    expect(res.files).toBe(0)
    expect(res.message).toContain('No save files')
  })

  it('rejects a backup folder inside the card root', async () => {
    const card = makeRoot()
    const res = await backupSaves(card, join(card, 'saves-backup'), 'en')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('outside the destination')
  })
})

describe('restoreSaves', () => {
  it('writes the backup layout back onto the card', async () => {
    const card = makeRoot()
    const backup = makeRoot()
    mkdirSync(join(backup, 'Zelda (USA)', 'saves'), { recursive: true })
    writeFileSync(join(backup, 'Zelda (USA)', 'saves', 'ZELDA.sav'), 'restored')

    const res = await restoreSaves(card, backup, 'en')
    expect(res.ok).toBe(true)
    expect(res.files).toBe(1)
    expect(res.folders).toBe(2)
    expect(readFileSync(join(card, 'Zelda (USA)', 'saves', 'ZELDA.sav'), 'utf8')).toBe('restored')
  })

  it('never overwrites a save the menu already recreated', async () => {
    const card = makeRoot()
    const backup = makeRoot()
    mkdirSync(join(card, 'Game', 'saves'), { recursive: true })
    mkdirSync(join(backup, 'Game', 'saves'), { recursive: true })
    writeFileSync(join(card, 'Game', 'saves', 'GAME.sav'), 'existing')
    writeFileSync(join(backup, 'Game', 'saves', 'GAME.sav'), 'from-backup')

    const res = await restoreSaves(card, backup, 'en')
    expect(res.ok).toBe(true)
    expect(res.files).toBe(0)
    expect(readFileSync(join(card, 'Game', 'saves', 'GAME.sav'), 'utf8')).toBe('existing')
  })

  it('reports when the backup folder is missing', async () => {
    const card = makeRoot()
    const res = await restoreSaves(card, join(tmpdir(), 'no-such-backup-sc64'), 'en')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('Nothing to restore')
  })

  it('rejects a restore folder inside the card root', async () => {
    const card = makeRoot()
    const res = await restoreSaves(card, join(card, 'some-saves'), 'en')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('outside the destination')
  })
})
