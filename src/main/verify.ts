import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'

export async function verifyFile(source: string, target: string): Promise<boolean> {
  const [a, b] = await Promise.all([stat(source), stat(target)])
  if (a.size !== b.size) return false
  const [ha, hb] = await Promise.all([hashFile(source), hashFile(target)])
  return ha === hb
}

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
