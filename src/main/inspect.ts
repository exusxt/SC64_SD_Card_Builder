import { readFileSync, readdirSync, statSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { freeSpaceOf } from './drives'
import { extOf } from './n64validate'

export interface InspectMenuInfo {
  present: boolean
  version: string | null
  size: number | null
}

export interface CardInspection {
  menu: InspectMenuInfo
  roms: { n64: number; other: number }
  saves: number
  files: number
  bytes: number
  freeBytes: number | null
}

const N64_EXTS = new Set(['.n64', '.z64', '.v64'])
const OTHER_EXTS = new Set(['.nes', '.smc', '.sfc', '.fig', '.gb', '.gbc', '.sms', '.gg', '.chf', '.ndd', '.d64'])

// The menu embeds its build timestamp ("YYYY-MM-DD HH:MM:SS") and, in release
// builds, the MENU_VERSION string (e.g. "V0.3.2") a few bytes apart inside the
// credits rodata. Dev builds embed "Preview release" instead, so the version
// string is only present on tagged releases.
const TS_RE = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/
const VERSION_RE = /[vV]\d+\.\d+\.\d+/
const TS_WINDOW = 1024

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
      menu = { present: true, version: null, size: null }
    }
  }

  let files = 0
  let bytes = 0
  let n64 = 0
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
      if (full === menuPath) continue
      const rel = relative(root, full)
      if (rel.startsWith('menu' + sep)) continue
      const ext = extOf(full)
      if (N64_EXTS.has(ext)) n64++
      else if (OTHER_EXTS.has(ext)) other++
    }
  }
  walk(root)

  return { menu, roms: { n64, other }, saves, files, bytes, freeBytes: await freeSpaceOf(root) }
}
