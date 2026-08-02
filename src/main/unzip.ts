import AdmZip from 'adm-zip'
import { readdirSync, statSync } from 'node:fs'
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

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
  await mkdir(destDir, { recursive: true })
  const entries = zip.getEntries().filter((e) => !e.isDirectory)
  let done = 0
  for (const entry of entries) {
    const target = safeJoin(destDir, entry.entryName)
    if (target) {
      await mkdir(dirname(target), { recursive: true })
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
  await mkdir(dirname(destFile), { recursive: true })
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
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(file, dest)
    copied++
    onProgress?.(copied, files.length)
  }
  return copied
}

export async function rmTree(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}
