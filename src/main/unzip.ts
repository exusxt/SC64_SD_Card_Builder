import AdmZip from 'adm-zip'
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export function extractZip(zipPath: string, destDir: string): void {
  const zip = new AdmZip(zipPath)
  mkdirSync(destDir, { recursive: true })
  zip.extractAllTo(destDir, true)
}

export function findEntriesInZip(zipPath: string, predicate: (name: string) => boolean): string[] {
  const zip = new AdmZip(zipPath)
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory && predicate(e.entryName))
    .map((e) => e.entryName)
}

export function extractEntryTo(zipPath: string, entryName: string, destFile: string): void {
  const zip = new AdmZip(zipPath)
  const entry = zip.getEntry(entryName)
  if (!entry) throw new Error(`Entry not found in archive: ${entryName}`)
  mkdirSync(join(destFile, '..'), { recursive: true })
  writeFileSync(destFile, entry.getData())
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

export function copyDirContents(srcDir: string, destDir: string, overwrite: boolean): number {
  const files = listDirDeep(srcDir)
  let copied = 0
  for (const file of files) {
    const rel = file.slice(srcDir.length).replace(/^[/\\]/, '')
    const dest = join(destDir, rel)
    if (existsSync(dest) && !overwrite) continue
    mkdirSync(join(dest, '..'), { recursive: true })
    writeFileSync(dest, readFileSync(file))
    copied++
  }
  return copied
}

export function rmTree(path: string): void {
  if (!existsSync(path)) return
  rmSync(path, { recursive: true, force: true })
}
