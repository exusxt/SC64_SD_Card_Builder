import { describe, expect, it } from 'vitest'
import { sanitizeLabel, sanitizeExfatLabel } from '../src/main/fat32'

describe('sanitizeLabel', () => {
  it('uppercases, strips invalid chars and pads/truncates to 11', () => {
    expect(sanitizeLabel('summer cart')).toBe('SUMMER CART')
    expect(sanitizeLabel('')).toBe('SUMMERCART ')
    expect(sanitizeLabel('ABCDEFGHIJKLMNOP')).toBe('ABCDEFGHIJK')
    expect(sanitizeLabel('a: b<c>')).toBe('A: B<C>    ')
  })
})

describe('sanitizeExfatLabel', () => {
  it('strips Windows-invalid chars, keeps case, truncates to 15', () => {
    expect(sanitizeExfatLabel('SummerCart64')).toBe('SummerCart64')
    expect(sanitizeExfatLabel('')).toBe('SUMMERCART')
    expect(sanitizeExfatLabel('12345678901234567890')).toBe('123456789012345')
    expect(sanitizeExfatLabel('a"b*c:d<e>f?g\\h/i|j')).toBe('abcdefghij')
  })
})
