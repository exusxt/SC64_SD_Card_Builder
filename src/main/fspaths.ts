// Path helpers for the main process, used throughout the build (downloads,
// unzip, report writing, ROM copying). ensureDir is the canonical way to make
// a directory tree, hardened against Windows drive roots where the naive
// recursive mkdir misbehaves.

import { access, mkdir } from 'node:fs/promises'

/**
 * Like mkdir(dir, { recursive: true }) but tolerant of Windows drive roots,
 * where Node throws EPERM even though the directory (E:\) exists. An EEXIST or
 * EPERM is treated as success once access() confirms the path is there.
 */
export async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true })
  } catch (err: any) {
    if (err?.code !== 'EEXIST' && err?.code !== 'EPERM') throw err
    await access(dir)
  }
}
