// Archive extraction for the main process. Zip files are handled with adm-zip
// (including entry lookup and single-file extraction for the emulator release
// zips); 7z archives go through 7z-wasm, which runs 7-Zip inside an Emscripten
// virtual filesystem. copyDirContents spreads an extracted folder tree (e.g.
// the metadata pack) onto the card root.

import AdmZip from 'adm-zip'
import { readdirSync, statSync } from 'node:fs'
import { access, copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import SevenZip, { type SevenZipModule } from '7z-wasm'
import { ensureDir } from './fspaths'

// adm-zip works on the whole buffer, so the zip is read into memory up front
// (fine for the small release archives this app handles).
async function openZip(zipPath: string): Promise<AdmZip> {
  return new AdmZip(await readFile(zipPath))
}

// entry.getDataAsync is callback-based; wrap it so the caller gets a promise.
function entryData(entry: AdmZip.IZipEntry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    entry.getDataAsync((data, err) => {
      if (err || !data) reject(new Error(err || `Failed to extract ${entry.entryName}`))
      else resolve(data)
    })
  })
}

// Zip-slip guard: joins an archive entry path onto a base dir only if it stays
// inside it. Absolute paths, drive-letter prefixes, and any '..' segment are
// rejected; backslashes are normalized because some archives are created on
// Windows with the wrong separator.
function safeJoin(base: string, name: string): string | null {
  const norm = name.replace(/\\/g, '/')
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) return null
  const parts = norm.split('/').filter((p) => p !== '' && p !== '.')
  if (parts.length === 0 || parts.some((p) => p === '..')) return null
  return join(base, ...parts)
}

/**
 * Extracts a zip's files into destDir (directory entries are skipped; unsafe
 * entry paths are dropped rather than raised). onEntry reports per-file
 * progress. Returns the number of files extracted.
 */
export async function extractZip(zipPath: string, destDir: string, onEntry?: (done: number, total: number) => void): Promise<number> {
  const zip = await openZip(zipPath)
  await ensureDir(destDir)
  const entries = zip.getEntries().filter((e) => !e.isDirectory)
  let done = 0
  for (const entry of entries) {
    const target = safeJoin(destDir, entry.entryName)
    if (target) {
      await ensureDir(dirname(target))
      await writeFile(target, await entryData(entry))
    }
    done++
    onEntry?.(done, entries.length)
  }
  return done
}

/** Lists the file entries of a zip whose names match `predicate` (used to locate the ROM inside an emulator release zip). */
export async function findEntriesInZip(zipPath: string, predicate: (name: string) => boolean): Promise<string[]> {
  const zip = await openZip(zipPath)
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory && predicate(e.entryName))
    .map((e) => e.entryName)
}

/** Pulls exactly one named entry out of a zip and writes it to destFile (e.g. neon64bu.rom -> menu/emulators/). */
export async function extractEntryTo(zipPath: string, entryName: string, destFile: string): Promise<void> {
  const zip = await openZip(zipPath)
  const entry = zip.getEntry(entryName)
  if (!entry) throw new Error(`Entry not found in archive: ${entryName}`)
  await ensureDir(dirname(destFile))
  await writeFile(destFile, await entryData(entry))
}

/** Recursively lists every file under dir (unreadable subdirectories are skipped). */
export function listDirDeep(dir: string): string[] {
  const result: string[] = []
  const walk = (d: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(d, name)
      try {
        const stat = statSync(full)
        if (stat.isDirectory()) walk(full)
        else result.push(full)
      } catch {
        // ignore
      }
    }
  }
  walk(dir)
  return result
}

/**
 * Copies the full tree of srcDir into destDir, preserving relative paths. With
 * overwrite=false existing destination files are skipped, so re-applying the
 * metadata pack never clobbers user changes. Returns the number of files copied.
 */
export async function copyDirContents(srcDir: string, destDir: string, overwrite: boolean, onProgress?: (done: number, total: number) => void): Promise<number> {
  const files = listDirDeep(srcDir)
  let copied = 0
  for (const file of files) {
    const rel = file.slice(srcDir.length).replace(/^[/\\]/, '')
    const dest = join(destDir, rel)
    if (!overwrite) {
      try {
        await access(dest)
        continue
      } catch {
        // file does not exist — proceed with copy
      }
    }
    await ensureDir(dirname(dest))
    await copyFile(file, dest)
    copied++
    onProgress?.(copied, files.length)
  }
  return copied
}

/** Recursively removes a path (temp dirs and staging folders). */
export async function rmTree(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

let szModulePromise: Promise<SevenZipModule> | null = null
let szCapture = ''

// 7z-wasm is a heavy Emscripten module, so it is compiled once and reused for
// every archive. print/printErr output is captured so a failing run can report
// the tail of 7-Zip's stderr; noExitRuntime keeps the wasm instance alive
// between calls so the module stays resident.
async function szModule(): Promise<SevenZipModule> {
  if (!szModulePromise) {
    szModulePromise = SevenZip({
      noExitRuntime: true,
      print: (s) => { szCapture += s + '\n' },
      printErr: (s) => { szCapture += s + '\n' }
    })
  }
  return szModulePromise
}

// Emscripten's FS.mkdir throws if the directory already exists; treat that as success.
function fsMkdirP(fs: SevenZipModule['FS'], path: string): void {
  try { fs.mkdir(path) } catch { /* already exists */ }
}

/**
 * Extracts a 7z archive into destDir via 7z-wasm. The wasm build has no real
 * filesystem, so the archive's parent and destDir are mounted into the virtual
 * FS as NODEFS nodes; -y forces overwrites and -bd silences the progress bar
 * (which would otherwise spam the captured output). Returns the file count.
 */
export async function extract7z(archivePath: string, destDir: string): Promise<number> {
  await ensureDir(destDir)
  const sz = await szModule()
  const arcParent = dirname(archivePath)
  const arcName = basename(archivePath)

  fsMkdirP(sz.FS, '/sc64')
  fsMkdirP(sz.FS, '/sc64/in')
  fsMkdirP(sz.FS, '/sc64/out')

  for (const mount of ['/sc64/in', '/sc64/out']) {
    try { sz.FS.unmount(mount) } catch { /* not mounted */ }
  }
  sz.FS.mount(sz.NODEFS, { root: arcParent }, '/sc64/in')
  sz.FS.mount(sz.NODEFS, { root: destDir }, '/sc64/out')

  szCapture = ''
  const code = (sz.callMain as unknown as (args: string[]) => number)(['x', `/sc64/in/${arcName}`, '-o/sc64/out', '-y', '-bd'])
  if (code !== 0) {
    const detail = szCapture.split('\n').map((s) => s.trim()).filter(Boolean).slice(-3).join(' · ')
    throw new Error(detail ? `7-Zip error (${code}): ${detail}` : `7-Zip failed with exit code ${code}`)
  }
  return listDirDeep(destDir).length
}

/**
 * Extracts any supported archive (zip or 7z) onto the card root and returns the
 * number of files written. Archive type is picked from the file extension.
 */
export async function extractArchive(archivePath: string, destDir: string): Promise<number> {
  const ext = extname(archivePath).toLowerCase()
  if (ext === '.7z') return extract7z(archivePath, destDir)
  return extractZip(archivePath, destDir)
}
