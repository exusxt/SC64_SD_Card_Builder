import { useMemo } from 'react'
import type { Locale, TranslationKey, TranslationVars } from '../../shared/i18n'
import { translate, getLocaleName } from '../../shared/i18n'

export interface T {
  (key: TranslationKey, vars?: TranslationVars): string
  locale: Locale
  localeName: string
}

export function useT(locale: Locale): T {
  return useMemo(() => {
    const fn = (key: TranslationKey, vars?: TranslationVars): string => translate(locale, key, vars)
    fn.locale = locale
    fn.localeName = getLocaleName(locale)
    return fn as T
  }, [locale])
}
