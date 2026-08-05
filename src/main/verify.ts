// Byte-for-byte copy verification for the main process. When the "verify"
// option is on, every file copied to the card is re-read from both locations
// and compared by SHA-256 so a silently truncated or torn SD write is caught
// and reported instead of corrupting the card.

import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'

/**
 * Confirm `target` is a byte-for-byte copy of `source`. Short-circuits on a
 * size mismatch; otherwise hashes both files concurrently and compares the
 * digests. Throws if either file is unreadable — callers treat that as a
 * verification failure.
 */
export async function verifyFile(source: string, target: string): Promise<boolean> {
  const [a, b] = await Promise.all([stat(source), stat(target)])
  if (a.size !== b.size) return false
  const [ha, hb] = await Promise.all([hashFile(source), hashFile(target)])
  return ha === hb
}

// Stream the file in 4 MiB chunks so hashing multi-GB archives stays flat on
// memory instead of buffering the whole file.
async function hashFile(p: string): Promise<string> {
  const handle = await open(p, 'r')
  const hash = createHash('sha256')
  const buf = Buffer.alloc(4 * 1024 * 1024)
  try {
    let pos = 0
    for (;;) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, pos)
      if (bytesRead === 0) break
      hash.update(buf.subarray(0, bytesRead))
      pos += bytesRead
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}
