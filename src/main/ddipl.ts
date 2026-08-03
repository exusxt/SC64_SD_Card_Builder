import { existsSync, readdirSync, statSync } from 'node:fs'
import { copyFile, mkdir, open } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { DdIplFileInfo, DdIplValidation } from '../shared/types'
import { DD_IPL_SIZE } from '../shared/types'

// Canonical 64DD IPL disk IDs recognised by N64FlashcartMenu inside
// /menu/64ddipl/. NDDJ0/NDDJ1 are older Japanese cartridge IPLs; NDDE0 is the
// US retail drive, NDDJ2 the Japanese retail drive and NDXJ0 the dev drive.
export const DD_IPL_IDS = ['NDDJ0', 'NDDJ1', 'NDDJ2', 'NDDE0', 'NDXJ0'] as const
export type DdIplId = (typeof DD_IPL_IDS)[number]

const ACCEPTED_EXTS = new Set(['.n64', '.z64', '.v64'])

function baseOf(name: string): string {
  const ext = extname(name)
  return ext ? name.slice(0, -ext.length) : name
}

interface Probe {
  size: number
  header: Buffer
  id: string | null
}

async function probe(path: string): Promise<Probe> {
  const size = statSync(path).size
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(0x40)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    const header = buf.subarray(0, bytesRead)
    const id = header.length >= 0x3f ? header.toString('latin1', 0x3b, 0x3f) : null
    return { size, header, id }
  } finally {
    await fh.close()
  }
}

// 64DD IPL ROMs are big-endian and start with 0x80270740 at offset 0; the
// ASCII disk ID ("NDDJ"/"NDDE"/"NDXJ") sits at offset 0x3B.
function byteOrderOf(header: Buffer): 'be' | 'swapped' | null {
  if (header.length < 4) return null
  const b = header
  if (b[0] === 0x80 && b[1] === 0x27 && b[2] === 0x07 && b[3] === 0x40) return 'be'
  if ((b[0] === 0x27 && b[1] === 0x80) || (b[0] === 0x40 && b[1] === 0x07)) return 'swapped'
  return null
}

export async function scanDDIPLFolder(dir: string): Promise<DdIplValidation | null> {
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) return null
  const entries = readdirSync(dir)
  const files: DdIplFileInfo[] = []
  const recognized = new Set<string>()

  for (const id of DD_IPL_IDS) {
    const match = entries.find(
      (n) => ACCEPTED_EXTS.has(extname(n).toLowerCase()) && baseOf(n).toUpperCase() === id
    )
    if (!match) {
      files.push({ id, name: null, present: false, valid: false, size: null, byteOrder: null, idOk: false })
      continue
    }
    recognized.add(match)
    const p = join(dir, match)
    const { size, header, id: fileId } = await probe(p)
    const byteOrder = byteOrderOf(header)
    const idOk = fileId !== null && fileId.toUpperCase() === id.slice(0, 4)
    const valid = size === DD_IPL_SIZE && byteOrder === 'be' && idOk
    files.push({ id, name: match, present: true, valid, size, byteOrder, idOk })
  }

  const unrecognized = entries.filter(
    (n) => ACCEPTED_EXTS.has(extname(n).toLowerCase()) && !recognized.has(n)
  )

  return { files, unrecognized }
}

export interface DDIPLInstallResult {
  installed: string[]
  missing: string[]
  invalid: string[]
}

// Copies the valid big-endian IPL dumps from `source` into `dest` as the
// canonical <ID>.n64 filenames the menu expects. Missing/Invalid dumps are
// reported instead of failing, so the rest of the card build can continue.
export async function installDDIPL(source: string, dest: string): Promise<DDIPLInstallResult> {
  const validation = await scanDDIPLFolder(source)
  const result: DDIPLInstallResult = { installed: [], missing: [], invalid: [] }
  if (!validation) {
    result.missing.push(...DD_IPL_IDS)
    return result
  }
  await mkdir(dest, { recursive: true })
  for (const f of validation.files) {
    if (!f.present || !f.name) {
      result.missing.push(f.id)
      continue
    }
    if (!f.valid) {
      result.invalid.push(f.id)
      continue
    }
    await copyFile(join(source, f.name), join(dest, `${f.id}.n64`))
    result.installed.push(f.id)
  }
  return result
}
