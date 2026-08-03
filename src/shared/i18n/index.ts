import en from './en'

export const LOCALES = ['en', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'nl', 'sv', 'no', 'da', 'fi', 'cs', 'hu', 'ro', 'el', 'ru', 'uk'] as const
export type Locale = (typeof LOCALES)[number]
export const THEME_IDS = ['midnight', 'ocean', 'forest', 'sunset', 'gallery', 'galleryblack', 'gallerygreen', 'galleryblue', 'galleryred', 'galleryorange', 'gallerypurple', 'royal', 'candy', 'paper'] as const
export type ThemeId = (typeof THEME_IDS)[number]
export type TranslationKey = keyof typeof en
export type TranslationVars = Record<string, string | number>
export type TranslationDict = Record<TranslationKey, string>

import de from './de'
import fr from './fr'
import es from './es'
import it from './it'
import pt from './pt'
import pl from './pl'
import nl from './nl'
import sv from './sv'
import no from './no'
import da from './da'
import fi from './fi'
import cs from './cs'
import hu from './hu'
import ro from './ro'
import el from './el'
import ru from './ru'
import uk from './uk'

const dicts: Record<Locale, TranslationDict> = {
  en,
  de,
  fr,
  es,
  it,
  pt,
  pl,
  nl,
  sv,
  no,
  da,
  fi,
  cs,
  hu,
  ro,
  el,
  ru,
  uk
}

export function translate(locale: Locale, key: TranslationKey, vars?: TranslationVars): string {
  const dict = dicts[locale] ?? en
  let out: string = (dict[key] as string | undefined) ?? (en[key] as string) ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, String(v))
    }
  }
  return out
}

export function getLocaleName(locale: Locale): string {
  return translate(locale, `lang.${locale}`)
}
