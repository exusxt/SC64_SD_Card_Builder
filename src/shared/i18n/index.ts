// Localization helpers for the SC64 SD Card Builder.
// Lives in the shared layer so the renderer UI and main-process log strings
// both resolve translations. This file only indexes the per-language
// dictionaries in this folder; en.ts doubles as the fallback dictionary.

import en from './en'

/** Every supported locale; also drives the language picker and the dict table. */
export const LOCALES = ['en', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'nl', 'sv', 'no', 'da', 'fi', 'cs', 'hu', 'ro', 'el', 'ru', 'uk'] as const
export type Locale = (typeof LOCALES)[number]
/** Theme ids matching the theme names shipped with N64FlashcartMenu. */
export const THEME_IDS = ['gallery', 'galleryblack', 'gallerygreen', 'galleryblue', 'galleryred', 'galleryorange', 'gallerypurple', 'midnight', 'ocean', 'forest', 'sunset', 'royal', 'candy', 'paper'] as const
export type ThemeId = (typeof THEME_IDS)[number]
/** Key of a translatable string, derived from the English dictionary. */
export type TranslationKey = keyof typeof en
/** Values substituted into {name} placeholders in a translation string. */
export type TranslationVars = Record<string, string | number>
/** A complete translation for one locale: every key maps to a string. */
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

// en is the fallback dictionary used when a locale lacks a key.
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

/**
 * Resolves `key` for `locale`, substituting {name} vars when provided.
 * Falls back to English, then to the raw key, so a missing translation never
 * renders as an empty string.
 */
export function translate(locale: Locale, key: TranslationKey, vars?: TranslationVars): string {
  const dict = dicts[locale] ?? en
  // fall back to the English dictionary, then to the raw key itself
  let out: string = (dict[key] as string | undefined) ?? (en[key] as string) ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      // substitute each {name} token with its formatted value
      out = out.replaceAll(`{${k}}`, String(v))
    }
  }
  return out
}

/** The display name of a locale in its own language (looked up via the `lang.*` keys). */
export function getLocaleName(locale: Locale): string {
  return translate(locale, `lang.${locale}`)
}
