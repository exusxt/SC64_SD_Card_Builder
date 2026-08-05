// On-screen N64FlashcartMenu file-browser emulation for the main process.
// Lists the contents of a folder on the prepared card the way the real cart
// menu does: resolves N64/GB/SNES/SMS metadata (title, game code, region,
// boxart, description) from the card's metadata pack and hides system files.
// The renderer never sees filesystem paths or file:// URLs.

import { readFileSync, readdirSync, statSync, Dirent } from 'node:fs'
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { PreviewEntry } from '../shared/types'
import { inspectN64File, isN64Ext, N64_REGION_LABELS } from './n64validate'
import { inspectEmuFile, isGBExt, isSNESExt, isSMSExt } from './emuheader'

// 64DD disk images have no readable header, so they are shown as placeholder
// entries to keep the preview faithful to what the real menu browser lists.
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

// The official menu also reads flat menu/boxart/<cartid>.png files (a single
// unique-code letter pair, e.g. NSME -> SM.png) on stock cards. Those are not
// part of the current metadata pack, so this is only a preview-side fallback.
function flatBoxart(boxartRoot: string, code: string): string | null {
  const flatName = `${code[1]}${code[2]}.png`
  let entries: string[] = []
  try {
    entries = readdirSync(boxartRoot)
  } catch {
    return null
  }
  const exact = entries.find((n) => n === flatName)
  if (exact) return join(boxartRoot, exact)
  const ci = entries.find((n) => n.toLowerCase() === flatName.toLowerCase())
  return ci ? join(boxartRoot, ci) : null
}

// Boxart lookup follows the pack's fallback chain: the 4-char destination dir
// first, then the 3-level unique-code dir the pack also hoists files into, and
// finally the legacy flat menu/boxart/<cartid>.png folder on stock cards.
function boxartPath(metaRoot: string, boxartRoot: string, gameCode: string): string | null {
  const code = gameCode.toUpperCase()
  if (code.length !== 4) return null
  const full = join(metaRoot, code[0], code[1], code[2], code[3], 'boxart_front.png')
  if (existsSync(full)) return full
  const three = join(metaRoot, code[0], code[1], code[2], 'boxart_front.png')
  if (existsSync(three)) return three
  return flatBoxart(boxartRoot, code)
}

// Homebrew ROMs use the "Advanced Homebrew ROM Header" (game code xEDx) and the
// metadata pack stores their art under homebrew/<game title>/boxart_front.png.
function homebrewBoxart(metaRoot: string, title: string): string | null {
  const clean = title.trim()
  if (!clean) return null
  // Try the title both as written and lower-cased: the pack may store the
  // homebrew/<title> folders with any casing.
  const candidates = [join(metaRoot, 'homebrew', clean, 'boxart_front.png'), join(metaRoot, 'homebrew', clean.toLowerCase(), 'boxart_front.png')]
  return candidates.find((c) => existsSync(c)) ?? null
}

function readDescription(dir: string): string | null {
  try {
    // Descriptions are plain text; latin1 decoding sidesteps encoding issues in
    // older packs that were not authored as UTF-8.
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

/**
 * True when `target` resolves to `root` itself or somewhere below it. Every
 * preview lookup is guarded with this so a renderer-supplied path (or a
 * crafted `..` chain) cannot escape the card root.
 */
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

async function inspectFile(metaRoot: string, boxartRoot: string, filePath: string): Promise<Pick<PreviewEntry, 'kind' | 'title' | 'gameCode' | 'region' | 'boxart' | 'description'>> {
  if (isN64Ext(filePath)) {
    const v = await inspectN64File(filePath)
    const h = v.header
    if (h) {
      const code = h.gameCode.toUpperCase()
      let boxart = boxartPath(metaRoot, boxartRoot, h.gameCode)
      let description: string | null = null
      // Advanced homebrew header (game code xEDx) — override the code-based
      // lookup with the homebrew/<title> art when the pack has one.
      if (code === 'XEDX' || code.startsWith('XED')) {
        boxart = homebrewBoxart(metaRoot, h.title) ?? boxart
      }
      const dir = metadataDir(metaRoot, h.gameCode)
      if (dir) {
        description = readDescription(dir)
        // Same fallback chain as the boxart: 4-level dir first, then the
        // 3-level unique-code dir the pack hoists files into.
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
  if (isGBExt(filePath) || isSNESExt(filePath) || isSMSExt(filePath)) {
    const info = inspectEmuFile(filePath)
    if (info) {
      return {
        kind: info.kind,
        title: info.title || info.productCode || null,
        gameCode: null,
        region: info.region,
        boxart: null,
        description: null
      }
    }
  }
  return { kind: 'other', title: null, gameCode: null, region: null, boxart: null, description: null }
}

/**
 * Lists one directory of the card as preview entries (files and subfolders),
 * with N64/emulator metadata and boxart paths filled in where available.
 * Returns null when the target is not a directory or escapes the card root.
 */
export async function listPreviewDir(root: string, dirRel: string): Promise<PreviewEntry[] | null> {
  const base = resolve(root)
  try {
    if (!statSync(base).isDirectory()) return null
  } catch {
    return null
  }

  const segments = dirRel.split(/[/\\]/).filter((s) => s.length > 0)
  const target = resolve(base, ...segments)
  // Reject paths that escape the card root (e.g. ../.. or absolute paths) so
  // the file browser can never reveal the host machine's other drives.
  if (!isInside(base, target)) return null

  let entries: Dirent[]
  try {
    entries = readdirSync(target, { withFileTypes: true })
  } catch {
    return null
  }

  // All metadata lookups are anchored under the card's menu/ folder (the same
  // layout N64FlashcartMenu reads from), so the browse root stays on the card.
  const metaRoot = join(base, 'menu', 'metadata')
  const boxartRoot = join(base, 'menu', 'boxart')
  const out: PreviewEntry[] = []

  for (const ent of entries) {
    const name = ent.name
    const lname = name.toLowerCase()
    if (ent.isDirectory()) {
      if (lname.startsWith('.')) continue
      // saves/ is created and managed by the menu itself; it is not browsable.
      if (lname === 'saves') continue
      if (SYSTEM_DIRS.has(lname)) continue
      // The menu/ folder is never listed when browsing the card root.
      if (segments.length === 0 && lname === 'menu') continue
      out.push({ name, isDir: true, size: 0, kind: 'other', title: null, gameCode: null, region: null, boxart: null, description: null })
      continue
    }
    if (!ent.isFile()) continue
    if (lname.startsWith('.')) continue
    // Hide the menu binary itself and the report files our prepare step writes
    // at the card root — the real menu never lists those either.
    if (segments.length === 0 && (lname === 'sc64menu.n64' || SYSTEM_FILES.has(lname))) continue
    const full = join(target, name)
    let size = 0
    try {
      size = statSync(full).size
    } catch {
      continue
    }
    const info = await inspectFile(metaRoot, boxartRoot, full)
    out.push({ name, isDir: false, size, ...info })
  }

  // Menu-style ordering: folders first, then natural, case-insensitive names
  // (numeric: true keeps "Game 2" before "Game 10").
  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
  return out
}

/**
 * Returns a boxart file as a base64 PNG data URL for the renderer. Only paths
 * inside the card's menu/metadata or menu/boxart trees are served, and the
 * bytes are delivered inline so no file:// URL is ever handed to the renderer.
 */
export function loadPreviewBoxart(root: string, path: string): string | null {
  const base = resolve(root)
  const target = resolve(path)
  if (!isInside(base, target)) return null
  const metaRoot = resolve(join(base, 'menu', 'metadata'))
  const boxartRoot = resolve(join(base, 'menu', 'boxart'))
  if (!isInside(metaRoot, target) && !isInside(boxartRoot, target)) return null
  if (!existsSync(target)) return null
  try {
    return `data:image/png;base64,${readFileSync(target).toString('base64')}`
  } catch {
    return null
  }
}
