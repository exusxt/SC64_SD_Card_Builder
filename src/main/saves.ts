// Saves backup/restore for the main process. N64FlashcartMenu writes save
// files into saves/ folders next to each game, so before reformatting a card
// every saves/ tree is mirrored into a backup folder on the computer; after
// reformatting the backup is written back. Paths are preserved so the restored
// card looks exactly like the original.

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locale } from '../shared/i18n'
import { translate } from '../shared/i18n'
import { ensureDir } from './fspaths'
import { pathContains } from './pathguard'

/** Outcome of a backup/restore: ok flag, localized message, and counts for the UI. */
export interface SavesResult {
  ok: boolean
  message: string
  files: number
  folders: number
  bytes: number
}

// saveDirs() finds every saves/ folder anywhere under the card root (including
// nested game folders and the root itself), case-insensitively.
async function saveDirs(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      if (ent.name.toLowerCase() === 'saves') {
        out.push(join(dir, ent.name))
        continue
      }
      if (ent.name.startsWith('.')) continue
      await walk(join(dir, ent.name))
    }
  }
  await walk(root)
  return out
}

// Relative path of a child under a parent, using forward slashes regardless of
// platform so backup keys stay stable across OSes.
function relOf(parent: string, child: string): string {
  return child.slice(parent.length).replace(/[/\\]+/g, '/').replace(/^\/|\/$/g, '')
}

/**
 * Copies every saves/ tree on the card into backupDir, mirroring the relative
 * layout. Existing backup files are overwritten (a backup should be current).
 * Rejects when the backup folder is inside the card root, which would recurse.
 */
export async function backupSaves(cardRoot: string, backupDir: string, locale: Locale): Promise<SavesResult> {
  if (pathContains(cardRoot, backupDir)) {
    return {
      ok: false,
      message: translate(locale, 'saves.backupInside', { path: backupDir }),
      files: 0,
      folders: 0,
      bytes: 0
    }
  }
  let files = 0
  let folders = 0
  let bytes = 0
  try {
    const dirs = await saveDirs(cardRoot)
    for (const d of dirs) {
      const rel = relOf(cardRoot, d)
      const targetDir = join(backupDir, rel)
      await ensureDir(targetDir)
      folders++
      let entries
      try {
        entries = await readdir(d, { withFileTypes: true })
      } catch {
        continue
      }
      for (const ent of entries) {
        if (!ent.isFile()) continue
        const src = join(d, ent.name)
        try {
          await copyFile(src, join(targetDir, ent.name))
          bytes += (await stat(src)).size
          files++
        } catch {
          // unreadable file: skip rather than abort the whole backup
        }
      }
    }
  } catch (e: any) {
    return {
      ok: false,
      message: translate(locale, 'saves.backupError', { message: e?.message ?? String(e) }),
      files,
      folders,
      bytes
    }
  }
  return {
    ok: true,
    message: files > 0
      ? translate(locale, 'saves.backupDone', { files, folders, path: backupDir })
      : translate(locale, 'saves.backupNone', { path: backupDir }),
    files,
    folders,
    bytes
  }
}

/**
 * Writes a backup back onto a freshly formatted card, mirroring the relative
 * layout. Existing save files are never overwritten so a save the menu already
 * recreated survives. Rejects when the backup folder is inside the card root.
 */
export async function restoreSaves(cardRoot: string, backupDir: string, locale: Locale): Promise<SavesResult> {
  if (pathContains(cardRoot, backupDir)) {
    return {
      ok: false,
      message: translate(locale, 'saves.restoreInside', { path: backupDir }),
      files: 0,
      folders: 0,
      bytes: 0
    }
  }
  let files = 0
  let folders = 0
  let bytes = 0
  try {
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const ent of entries) {
        if (ent.name.startsWith('.')) continue
        const src = join(dir, ent.name)
        const relPath = rel ? `${rel}/${ent.name}` : ent.name
        const target = join(cardRoot, relPath)
        if (ent.isDirectory()) {
          await ensureDir(target)
          folders++
          await walk(src, relPath)
        } else if (ent.isFile()) {
          // Never clobber an existing save: the menu may have recreated it.
          if (existsSync(target)) continue
          await mkdir(join(cardRoot, rel), { recursive: true }).catch(() => undefined)
          try {
            await copyFile(src, target)
            bytes += (await stat(src)).size
            files++
          } catch {
            // unreadable source: skip rather than abort the whole restore
          }
        }
      }
    }
    if (!existsSync(backupDir)) {
      return {
        ok: false,
        message: translate(locale, 'saves.restoreNone', { path: backupDir }),
        files: 0,
        folders: 0,
        bytes: 0
      }
    }
    await walk(backupDir, '')
  } catch (e: any) {
    return {
      ok: false,
      message: translate(locale, 'saves.restoreError', { message: e?.message ?? String(e) }),
      files,
      folders,
      bytes
    }
  }
  return {
    ok: true,
    message: files > 0
      ? translate(locale, 'saves.restoreDone', { files, folders })
      : translate(locale, 'saves.restoreNone', { path: backupDir }),
    files,
    folders,
    bytes
  }
}
