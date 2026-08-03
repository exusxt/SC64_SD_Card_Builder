import { readFileSync, readdirSync, statSync, Dirent } from 'node:fs'
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { PreviewBackground, PreviewEntry } from '../shared/types'
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

function isInside(root: string, target: string): boolean {
  const r = resolve(root).toLowerCase()
  const t = resolve(target).toLowerCase()
  return t === r || t.startsWith(r + sep)
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
      if (lname === 'saves') continue
      if (segments.length === 0 && lname === 'menu') continue
      out.push({ name, isDir: true, size: 0, kind: 'other', title: null, gameCode: null, region: null, boxart: null, description: null })
      continue
    }
    if (!ent.isFile()) continue
    if (lname.startsWith('.')) continue
    if (segments.length === 0 && lname === 'sc64menu.n64') continue
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

// The menu caches the user-set background image at menu/cache/background.data
// (see N64FlashcartMenu src/menu/menu.c). Layout: magic "BKG1", uint32 BE
// width/height/size, then the raw RGBA16 surface (stride = size / height).
function decodeBackground(raw: Buffer): PreviewBackground | null {
  if (raw.length < 16) return null
  if (!raw.subarray(0, 4).equals(Buffer.from('BKG1', 'ascii'))) return null
  const width = raw.readUInt32BE(4)
  const height = raw.readUInt32BE(8)
  const size = raw.readUInt32BE(12)
  if (width === 0 || height === 0 || width > 640 || height > 480) return null
  if (size < width * 2 * height) return null
  if (raw.length < 16 + size) return null
  const stride = Math.floor(size / height)
  if (stride < width * 2 || stride > width * 2 + 64) return null

  const out = Buffer.alloc(width * height * 4)
  let o = 0
  for (let y = 0; y < height; y++) {
    const row = 16 + y * stride
    for (let x = 0; x < width; x++) {
      const p = raw.readUInt16BE(row + x * 2)
      const r = (p >> 11) & 0x1f
      const g = (p >> 6) & 0x1f
      const b = (p >> 1) & 0x1f
      out[o++] = (r << 3) | (r >> 2)
      out[o++] = (g << 3) | (g >> 2)
      out[o++] = (b << 3) | (b >> 2)
      out[o++] = 0xff
    }
  }
  return { width, height, data: out.toString('base64') }
}

export function loadPreviewBackground(root: string): PreviewBackground | null {
  const base = resolve(root)
  const target = resolve(join(base, 'menu', 'cache', 'background.data'))
  if (!isInside(base, target)) return null
  try {
    return decodeBackground(readFileSync(target))
  } catch {
    return null
  }
}
