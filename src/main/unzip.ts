import AdmZip from 'adm-zip'
import { readdirSync, statSync } from 'node:fs'
import { access, copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import SevenZip, { type SevenZipModule } from '7z-wasm'
import { ensureDir } from './fspaths'

async function openZip(zipPath: string): Promise<AdmZip> {
  return new AdmZip(await readFile(zipPath))
}

function entryData(entry: AdmZip.IZipEntry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    entry.getDataAsync((data, err) => {
      if (err || !data) reject(new Error(err || `Failed to extract ${entry.entryName}`))
      else resolve(data)
    })
  })
}

function safeJoin(base: string, name: string): string | null {
  const norm = name.replace(/\\/g, '/')
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) return null
  const parts = norm.split('/').filter((p) => p !== '' && p !== '.')
  if (parts.length === 0 || parts.some((p) => p === '..')) return null
  return join(base, ...parts)
}

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

export async function findEntriesInZip(zipPath: string, predicate: (name: string) => boolean): Promise<string[]> {
  const zip = await openZip(zipPath)
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory && predicate(e.entryName))
    .map((e) => e.entryName)
}

export async function extractEntryTo(zipPath: string, entryName: string, destFile: string): Promise<void> {
  const zip = await openZip(zipPath)
  const entry = zip.getEntry(entryName)
  if (!entry) throw new Error(`Entry not found in archive: ${entryName}`)
  await ensureDir(dirname(destFile))
  await writeFile(destFile, await entryData(entry))
}

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

export async function rmTree(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

let szModulePromise: Promise<SevenZipModule> | null = null
let szCapture = ''

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

function fsMkdirP(fs: SevenZipModule['FS'], path: string): void {
  try { fs.mkdir(path) } catch { /* already exists */ }
}

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

export async function extractArchive(archivePath: string, destDir: string): Promise<number> {
  const ext = extname(archivePath).toLowerCase()
  if (ext === '.7z') return extract7z(archivePath, destDir)
  return extractZip(archivePath, destDir)
}
