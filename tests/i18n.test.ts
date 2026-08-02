import { describe, expect, it } from 'vitest'
import { LOCALES, getLocaleName, translate } from '../src/shared/i18n'

describe('translate', () => {
  it('returns a non-empty title for every locale', () => {
    for (const locale of LOCALES) {
      const out = translate(locale, 'app.title')
      expect(out.length).toBeGreaterThan(0)
      expect(out).not.toBe('app.title')
    }
  })

  it('interpolates variables', () => {
    const out = translate('en', 'update.available', { version: '1.2.3' })
    expect(out).toContain('1.2.3')
    expect(out).not.toContain('{version}')
  })

  it('falls back to the key for unknown keys', () => {
    // @ts-expect-error unknown key on purpose
    expect(translate('en', 'no.such.key')).toBe('no.such.key')
  })
})

describe('getLocaleName', () => {
  it('returns a localized name for every locale', () => {
    for (const locale of LOCALES) {
      const name = getLocaleName(locale)
      expect(name.length).toBeGreaterThan(0)
      expect(name).not.toBe(`lang.${locale}`)
    }
  })
})
