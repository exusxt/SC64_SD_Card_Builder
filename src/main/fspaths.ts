import { access, mkdir } from 'node:fs/promises'

// Like mkdir(dir, { recursive: true }) but tolerant of Windows drive roots,
// where Node throws EPERM even though the directory (E:\) exists.
export async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true })
  } catch (err: any) {
    if (err?.code !== 'EEXIST' && err?.code !== 'EPERM') throw err
    await access(dir)
  }
}
