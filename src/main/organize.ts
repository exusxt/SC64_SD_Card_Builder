// "Clean collection" naming for N64 ROMs in the main process. During the ROM
// copy step each game lands in its own "Title (Region)" folder, de-duplicated
// with a numeric suffix, and any sibling .cht cheat file is copied in beside
// it. Used when the "organize ROMs" and "copy cheats" options are enabled.
// Emulator (GB/SNES/SMS/GG) ROMs use the same naming via emuOrganizeBase.

import { N64_REGION_LABELS, type N64Header } from './n64validate'

// Characters Windows forbids in filenames; mapped to spaces so a title keeps
// as much of itself as possible.
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g
// Collapse runs of whitespace left behind by the sanitization above.
const COLLAPSE_WS = /\s+/g
// Windows strips trailing dots and spaces from names, so drop them up front
// or the directory would silently be created with a different name.
const TRAILING_DOTS = /[. ]+$/g

/**
 * Turn a raw header title into a safe folder name: forbidden characters become
 * spaces, whitespace collapses, trailing dots/spaces are trimmed. Returns
 * 'Unknown' when nothing legible remains.
 */
export function cleanTitle(raw: string): string {
  const cleaned = raw
    .replace(INVALID_CHARS, ' ')
    .replace(COLLAPSE_WS, ' ')
    .replace(TRAILING_DOTS, '')
    .trim()
  return cleaned.length > 0 ? cleaned : 'Unknown'
}

/**
 * The folder base for a ROM: sanitized title plus its region label, e.g.
 * "Zelda (USA)". Callers append the extension and dedupe via uniqueBase.
 */
export function organizeBase(header: N64Header): string {
  return `${cleanTitle(header.title)} (${N64_REGION_LABELS[header.region]})`
}

/**
 * The folder base for an emulator (GB/SNES/SMS/GG) ROM. SMS/GG games have no
 * title field, so their product code is used instead; a region label is
 * appended when the header carries one (e.g. "Sonic (SMS Export)").
 */
export function emuOrganizeBase(title: string, region: string | null, productCode?: string): string {
  const name = title || productCode || 'Unknown'
  const clean = cleanTitle(name)
  return region ? `${clean} (${region})` : clean
}

/**
 * Deduplicate a folder base case-insensitively by appending " (2)", " (3)",
 * etc. when the base is already in `used`; records the final name in `used`
 * as a side effect so later calls keep seeing it.
 */
export function uniqueBase(base: string, used: Set<string>): string {
  let candidate = base
  let i = 2
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} (${i})`
    i++
  }
  used.add(candidate.toLowerCase())
  return candidate
}

/**
 * Path of the cheat file that belongs next to an organized ROM: the target
 * path with its extension swapped for .cht.
 */
export function chtNameOf(target: string): string {
  const last = target.lastIndexOf('.')
  const stem = last >= 0 ? target.slice(0, last) : target
  return `${stem}.cht`
}
