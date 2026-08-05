// Existing-card inspection: walks a card's folder tree counting ROMs by
// system, save folders, files and bytes, reads the sc64menu.n64 version, and
// reports free space. Backs the inspect panel that warns the user what a
// prepare run would find on the card before anything is overwritten.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { freeSpaceOf } from './drives'
import { extOf } from './n64validate'

/** What an existing card holds: whether sc64menu.n64 is present and its parsed version/size. */
export interface InspectMenuInfo {
  present: boolean
  version: string | null
  size: number | null
}

/** Result of inspecting an existing card: menu info, per-system ROM counts, saves, files/bytes, free space. */
export interface CardInspection {
  menu: InspectMenuInfo
  roms: { n64: number; gb: number; gbc: number; snes: number; sms: number; gg: number; other: number }
  saves: number
  files: number
  bytes: number
  freeBytes: number | null
}

// Extension sets per system; OTHER_EXTS captures NES/Channel F/64DD images,
// which the menu loads via emulators but which have no dedicated counter.
const N64_EXTS = new Set(['.n64', '.z64', '.v64'])
const GB_EXTS = new Set(['.gb'])
const GBC_EXTS = new Set(['.gbc'])
const SNES_EXTS = new Set(['.smc', '.sfc', '.fig'])
const SMS_EXTS = new Set(['.sms'])
const GG_EXTS = new Set(['.gg'])
const OTHER_EXTS = new Set(['.nes', '.chf', '.ndd', '.d64'])

// The menu embeds its build timestamp ("YYYY-MM-DD HH:MM:SS") and, in release
// builds, the MENU_VERSION string (e.g. "V0.3.2") a few bytes apart inside the
// credits rodata. Dev builds embed "Preview release" instead, so the version
// string is only present on tagged releases.
const TS_RE = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/
const VERSION_RE = /[vV]\d+\.\d+\.\d+/
const TS_WINDOW = 1024

/**
 * Extracts the version string from a sc64menu.n64 dump by scanning the whole
 * binary for the embedded build timestamp and reading the version nearby. A
 * timestamp with no version means a dev build, so 'Preview release' is
 * returned; a file with neither timestamp nor version is reported as null.
 */
export function parseMenuVersion(buf: Buffer): string | null {
  const text = buf.toString('latin1')
  let foundTimestamp = false
  const re = new RegExp(TS_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    foundTimestamp = true
    const start = Math.max(0, m.index - TS_WINDOW)
    const end = Math.min(text.length, m.index + m[0].length + TS_WINDOW)
    const version = text.slice(start, end).match(VERSION_RE)
    if (version) return version[0]
  }
  return foundTimestamp ? 'Preview release' : null
}

/**
 * Inspects an existing card at `root`: parses the root sc64menu.n64, walks the
 * whole tree counting ROMs by system and saves/ folders, and reports total
 * files/bytes and free space. Returns null when the root is missing or not a
 * directory.
 */
export async function inspectCard(root: string): Promise<CardInspection | null> {
  let rootStat
  try {
    rootStat = statSync(root)
  } catch {
    return null
  }
  if (!rootStat.isDirectory()) return null

  const menuPath = join(root, 'sc64menu.n64')
  let menu: InspectMenuInfo = { present: false, version: null, size: null }
  if (existsSync(menuPath)) {
    try {
      const buf = readFileSync(menuPath)
      menu = { present: true, version: parseMenuVersion(buf), size: buf.length }
    } catch {
      // An unreadable menu is still "present"; only version/size are unknown.
      menu = { present: true, version: null, size: null }
    }
  }

  let files = 0
  let bytes = 0
  let n64 = 0
  let gb = 0
  let gbc = 0
  let snes = 0
  let sms = 0
  let gg = 0
  let other = 0
  let saves = 0

  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const full = join(dir, ent.name)
      if (ent.isDirectory()) {
        // A folder literally named "saves" is the menu's save directory.
        if (ent.name.toLowerCase() === 'saves') saves++
        walk(full)
        continue
      }
      if (!ent.isFile()) continue
      files++
      try {
        bytes += statSync(full).size
      } catch {
        // ignore
      }
      // The root menu counts toward files/bytes but not the ROM counters, and
      // the entire menu/ folder tree is excluded from ROM counts too.
      if (full === menuPath) continue
      const rel = relative(root, full)
      if (rel.startsWith('menu' + sep)) continue
      const ext = extOf(full)
      if (N64_EXTS.has(ext)) n64++
      else if (GB_EXTS.has(ext)) gb++
      else if (GBC_EXTS.has(ext)) gbc++
      else if (SNES_EXTS.has(ext)) snes++
      else if (SMS_EXTS.has(ext)) sms++
      else if (GG_EXTS.has(ext)) gg++
      else if (OTHER_EXTS.has(ext)) other++
    }
  }
  walk(root)

  return { menu, roms: { n64, gb, gbc, snes, sms, gg, other }, saves, files, bytes, freeBytes: await freeSpaceOf(root) }
}
