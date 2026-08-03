import { describe, expect, it } from 'vitest'
import { cn, formatBytes, moveSelection, DEFAULT_SETTINGS } from '../src/renderer/src/lib'

describe('formatBytes', () => {
  it('handles empty values', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(0)).toBe('—')
  })

  it('formats byte counts', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(10 * 1024 * 1024 * 1024)).toBe('10.0 GB')
  })
})

describe('cn', () => {
  it('joins truthy parts only', () => {
    expect(cn('a', 'b')).toBe('a b')
    expect(cn('a', false, null, undefined, 'b')).toBe('a b')
    expect(cn()).toBe('')
  })
})

describe('moveSelection', () => {
  it('steps up and down', () => {
    expect(moveSelection(2, 5, 'up')).toBe(1)
    expect(moveSelection(2, 5, 'down')).toBe(3)
  })

  it('wraps around the ends', () => {
    expect(moveSelection(0, 5, 'up')).toBe(4)
    expect(moveSelection(4, 5, 'down')).toBe(0)
  })

  it('handles empty lists', () => {
    expect(moveSelection(0, 0, 'up')).toBe(0)
    expect(moveSelection(0, 0, 'down')).toBe(0)
  })
})

describe('DEFAULT_SETTINGS', () => {
  it('has sane defaults', () => {
    expect(DEFAULT_SETTINGS.downloadMenu).toBe(true)
    expect(DEFAULT_SETTINGS.language).toBe('en')
    expect(DEFAULT_SETTINGS.verify).toBe(true)
    expect(DEFAULT_SETTINGS.volumeLabel).toBe('SUMMERCART')
  })

  it('defaults to the Gallery Glass theme', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('gallery')
  })
})
