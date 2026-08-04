import { readFileSync, readdirSync, statSync, Dirent } from 'node:fs'
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { PreviewEntry } from '../shared/types'
import { inspectN64File, isN64Ext, N64_REGION_LABELS } from './n64validate'

const DD_EXTS = new Set(['.ndd', '.d64'])

// The metadata pack is stored on the card as menu/metadata/<gamecode-char>/
// per character (e.g. N/G/E/E/boxart_front.png), matching how N64FlashcartMenu
// resolves art. The 4th (destination) char is dropped as a fallback so a
// Japan-region ROM can reuse the shared US boxart.
function metadataDir(metaRoot: string, gameCode: string): string | null {
  const code = gameCode.toUpperCase()
  if (code.length !== 4) return null
  return join(metaRoot, code[0], code[1], code[2], code[3])
}

function boxartPath(metaRoot: string, gameCode: string): string | null {
  const code = gameCode.toUpperCase()
  if (code.length !== 4) return null
  const full = join(metaRoot, code[0], code[1], code[2], code[3], 'boxart_front.png')
  if (existsSync(full)) return full
  const three = join(metaRoot, code[0], code[1], code[2], 'boxart_front.png')
  return existsSync(three) ? three : null
}

// Homebrew ROMs use the "Advanced Homebrew ROM Header" (game code xEDx) and the
// metadata pack stores their art under homebrew/<game title>/boxart_front.png.
function homebrewBoxart(metaRoot: string, title: string): string | null {
  const clean = title.trim()
  if (!clean) return null
  const candidates = [join(metaRoot, 'homebrew', clean, 'boxart_front.png'), join(metaRoot, 'homebrew', clean.toLowerCase(), 'boxart_front.png')]
  return candidates.find((c) => existsSync(c)) ?? null
}

function readDescription(dir: string): string | null {
  try {
    const text = readFileSync(join(dir, 'description.txt'), 'latin1').toString().trim()
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

// Directories the real menu hides and that never hold games. They exist on
// freshly-formatted cards (System Volume Information, the Recycle Bin, macOS
// junk folders) and would otherwise clutter the file browser preview.
const SYSTEM_DIRS = new Set(['system volume information', '$recycle.bin', 'recycler', 'fseventsd'])
// Files our own prepare step writes at the card root that the menu won't show.
const SYSTEM_FILES = new Set(['sc64-report.html', 'sc64-report.csv'])

export function isInside(root: string, target: string): boolean {
  const r = resolve(root).toLowerCase()
  const t = resolve(target).toLowerCase()
  if (t === r) return true
  // resolve() keeps a trailing separator on drive roots (E:\), so build the
  // prefix without doubling it or subdirectories of a drive root would never match.
  const prefix = r.endsWith(sep) ? r : r + sep
  return t.startsWith(prefix)
}

function extOf(p: string): string {
  const last = p.lastIndexOf('.')
  return last >= 0 ? p.slice(last).toLowerCase() : ''
}

async function inspectFile(metaRoot: string, filePath: string): Promise<Pick<PreviewEntry, 'kind' | 'title' | 'gameCode' | 'region' | 'boxart' | 'description'>> {
  if (isN64Ext(filePath)) {
    const v = await inspectN64File(filePath)
    const h = v.header
    if (h) {
      const code = h.gameCode.toUpperCase()
      let boxart = boxartPath(metaRoot, h.gameCode)
      let description: string | null = null
      if (code === 'XEDX' || code.startsWith('XED')) {
        boxart = homebrewBoxart(metaRoot, h.title) ?? boxart
      }
      const dir = metadataDir(metaRoot, h.gameCode)
      if (dir) {
        description = readDescription(dir)
        if (!description) {
          const three = join(metaRoot, code[0], code[1], code[2])
          description = readDescription(three)
        }
      }
      return {
        kind: 'n64',
        title: h.title || null,
        gameCode: h.gameCode || null,
        region: h.region ? N64_REGION_LABELS[h.region] : null,
        boxart,
        description
      }
    }
  }
  if (DD_EXTS.has(extOf(filePath))) {
    return { kind: 'dd', title: null, gameCode: null, region: null, boxart: null, description: null }
  }
  return { kind: 'other', title: null, gameCode: null, region: null, boxart: null, description: null }
}

export async function listPreviewDir(root: string, dirRel: string): Promise<PreviewEntry[] | null> {
  const base = resolve(root)
  try {
    if (!statSync(base).isDirectory()) return null
  } catch {
    return null
  }

  const segments = dirRel.split(/[/\\]/).filter((s) => s.length > 0)
  const target = resolve(base, ...segments)
  if (!isInside(base, target)) return null

  let entries: Dirent[]
  try {
    entries = readdirSync(target, { withFileTypes: true })
  } catch {
    return null
  }

  const metaRoot = join(base, 'menu', 'metadata')
  const out: PreviewEntry[] = []

  for (const ent of entries) {
    const name = ent.name
    const lname = name.toLowerCase()
    if (ent.isDirectory()) {
      if (lname.startsWith('.')) continue
      if (lname === 'saves') continue
      if (SYSTEM_DIRS.has(lname)) continue
      if (segments.length === 0 && lname === 'menu') continue
      out.push({ name, isDir: true, size: 0, kind: 'other', title: null, gameCode: null, region: null, boxart: null, description: null })
      continue
    }
    if (!ent.isFile()) continue
    if (lname.startsWith('.')) continue
    if (segments.length === 0 && (lname === 'sc64menu.n64' || SYSTEM_FILES.has(lname))) continue
    const full = join(target, name)
    let size = 0
    try {
      size = statSync(full).size
    } catch {
      continue
    }
    const info = await inspectFile(metaRoot, full)
    out.push({ name, isDir: false, size, ...info })
  }

  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
  return out
}

export function loadPreviewBoxart(root: string, path: string): string | null {
  const base = resolve(root)
  const metaRoot = resolve(join(base, 'menu', 'metadata'))
  const target = resolve(path)
  if (!isInside(metaRoot, target) || !isInside(base, target)) return null
  if (!existsSync(target)) return null
  try {
    return `data:image/png;base64,${readFileSync(target).toString('base64')}`
  } catch {
    return null
  }
}
