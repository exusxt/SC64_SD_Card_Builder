// Byte-swap normalization for the main process. When the "normalize N64 byte
// order" option is on, byte-swapped dumps (.v64 = 16-bit word swap, .n64 =
// 32-bit word reversal) are converted to canonical big-endian .z64 while being
// copied, and the verification step compares the normalized bytes instead of a
// raw file hash. Files stream in fixed chunks so multi-MB ROMs stay flat on
// memory.

import { open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ensureDir } from './fspaths'
import type { N64ByteOrder } from './n64validate'

const CHUNK = 4 * 1024 * 1024

/**
 * Normalize a buffer in place to big-endian order. Returns the same buffer for
 * 'z64' (already big-endian). For 'v64' each 16-bit word's bytes are swapped;
 * for 'n64' each 32-bit word is reversed. Trailing bytes shorter than a full
 * word are left untouched.
 */
export function normalizeBytes(buf: Buffer, order: N64ByteOrder): Buffer {
  if (order === 'z64') return buf
  const word = order === 'v64' ? 2 : 4
  const end = buf.length - (buf.length % word)
  for (let i = 0; i < end; i += word) {
    for (let a = 0; a < word / 2; a++) {
      const lo = buf[i + a]
      buf[i + a] = buf[i + word - 1 - a]
      buf[i + word - 1 - a] = lo
    }
  }
  return buf
}

/**
 * Copy `src` into `dst`, byte-swapping the data to big-endian as it streams.
 * The output is the same length as the input (only byte order changes).
 */
export async function normalizeN64ToFile(src: string, dst: string, order: N64ByteOrder): Promise<void> {
  await ensureDir(dirname(dst))
  const srcHandle = await open(src, 'r')
  const dstHandle = await open(dst, 'w')
  try {
    const size = (await srcHandle.stat()).size
    const buf = Buffer.alloc(CHUNK)
    let pos = 0
    while (pos < size) {
      const { bytesRead } = await srcHandle.read(buf, 0, CHUNK, pos)
      if (bytesRead === 0) break
      await dstHandle.write(normalizeBytes(buf.subarray(0, bytesRead), order))
      pos += bytesRead
    }
  } finally {
    await srcHandle.close()
    await dstHandle.close()
  }
}

/**
 * Confirm `dst` is the byte-swapped copy of `src` (i.e. `dst` equals `src`
 * normalized to big-endian). Used instead of verifyFile when normalization ran.
 */
export async function verifyNormalized(src: string, dst: string, order: N64ByteOrder): Promise<boolean> {
  const srcHandle = await open(src, 'r')
  const dstHandle = await open(dst, 'r')
  try {
    const [srcStat, dstStat] = await Promise.all([srcHandle.stat(), dstHandle.stat()])
    // Normalization preserves length, so a size mismatch is an immediate failure.
    if (srcStat.size !== dstStat.size) return false
    const srcBuf = Buffer.alloc(CHUNK)
    const dstBuf = Buffer.alloc(CHUNK)
    let pos = 0
    while (pos < srcStat.size) {
      const { bytesRead } = await srcHandle.read(srcBuf, 0, CHUNK, pos)
      if (bytesRead === 0) break
      const { bytesRead: dstRead } = await dstHandle.read(dstBuf, 0, bytesRead, pos)
      if (dstRead !== bytesRead) return false
      // The source chunk is normalized before comparing so partial words are
      // handled the same way the writer handled them.
      if (!normalizeBytes(srcBuf.subarray(0, bytesRead), order).equals(dstBuf.subarray(0, bytesRead))) return false
      pos += bytesRead
    }
    return true
  } finally {
    await srcHandle.close()
    await dstHandle.close()
  }
}
