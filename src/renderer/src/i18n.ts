/**
 * Thin renderer-side i18n wrapper. useT builds a memoized translate function
 * bound to the active locale, exposing the locale id and its display name.
 */
import { useMemo } from 'react'
import type { Locale, TranslationKey, TranslationVars } from '../../shared/i18n'
import { translate, getLocaleName } from '../../shared/i18n'

/** A bound translate function for a single locale, with locale metadata attached. */
export interface T {
  (key: TranslationKey, vars?: TranslationVars): string
  locale: Locale
  localeName: string
}

/**
 * Returns a translate function bound to the given locale. Memoized so consumers
 * only re-render when the locale actually changes.
 */
export function useT(locale: Locale): T {
  return useMemo(() => {
    const fn = (key: TranslationKey, vars?: TranslationVars): string => translate(locale, key, vars)
    fn.locale = locale
    fn.localeName = getLocaleName(locale)
    return fn as T
  }, [locale])
}
