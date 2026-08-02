import { describe, expect, it } from 'vitest'
import { pathContains } from '../src/main/pathguard'

describe('pathContains', () => {
  it('detects a child inside a parent', () => {
    expect(pathContains('/data/roms', '/data/roms/n64')).toBe(true)
    expect(pathContains('C:\\Games', 'C:\\Games\\roms')).toBe(true)
  })

  it('rejects a parent inside a child', () => {
    expect(pathContains('/data/roms/n64', '/data/roms')).toBe(false)
    expect(pathContains('C:\\Games\\roms', 'C:\\Games')).toBe(false)
  })

  it('treats equal paths as contained', () => {
    expect(pathContains('/data/roms', '/data/roms')).toBe(true)
  })

  it('normalizes trailing separators', () => {
    expect(pathContains('/data/roms/', '/data/roms/n64')).toBe(true)
    expect(pathContains('/data/roms', '/data/roms/n64/')).toBe(true)
  })

  it('is case-insensitive on Windows only', () => {
    if (process.platform === 'win32') {
      expect(pathContains('C:\\Games', 'c:\\games\\n64')).toBe(true)
    } else {
      expect(pathContains('/Data/Roms', '/data/roms')).toBe(false)
    }
  })
})
