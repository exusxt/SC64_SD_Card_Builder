import { afterEach, describe, expect, it, vi } from 'vitest'
import { cn, formatBytes, moveSelection, restoreSelection, SelectionHistory, nextBackgroundIndex, DEFAULT_SETTINGS } from '../src/renderer/src/lib'

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

describe('restoreSelection', () => {
  it('returns the top when nothing was remembered', () => {
    expect(restoreSelection(undefined, 5)).toBe(0)
  })

  it('restores the remembered index', () => {
    expect(restoreSelection(3, 5)).toBe(3)
  })

  it('clamps to the new listing length', () => {
    expect(restoreSelection(10, 5)).toBe(4)
    expect(restoreSelection(3, 0)).toBe(0)
  })
})

describe('SelectionHistory', () => {
  it('remembers the selection when entering folders and restores LIFO on leave', () => {
    const h = new SelectionHistory()
    h.enter(3)
    h.enter(7)
    expect(h.leave()).toBe(7)
    expect(h.leave()).toBe(3)
    expect(h.leave()).toBeUndefined()
  })
})

describe('nextBackgroundIndex', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when there are no backgrounds', () => {
    expect(nextBackgroundIndex(null, 0)).toBeNull()
    expect(nextBackgroundIndex(3, 0)).toBeNull()
  })

  it('always picks index 0 when there is exactly one background', () => {
    expect(nextBackgroundIndex(null, 1)).toBe(0)
    expect(nextBackgroundIndex(0, 1)).toBe(0)
  })

  it('picks a random index when there was no previous background', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(nextBackgroundIndex(null, 5)).toBe(2)
  })

  it('avoids repeating the previously shown background', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.5).mockReturnValueOnce(0.0)
    expect(nextBackgroundIndex(2, 5)).toBe(0)
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
