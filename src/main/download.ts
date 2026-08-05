// Download helper for the main process. Streams a URL to a .part temp file
// with progress callbacks and atomically renames it into place on success, so
// an interrupted download never leaves a half-written file at the destination.
// GitHub release assets redirect to a CDN, so redirects are followed and a
// User-Agent header is always set because GitHub rejects requests without one.

import { createWriteStream } from 'node:fs'
import { rename } from 'node:fs/promises'
import { dirname, basename } from 'node:path'
import * as https from 'node:https'
import * as http from 'node:http'
import { ensureDir } from './fspaths'

/** Bytes transferred so far; total is from Content-Length (0 when unknown). */
export interface DownloadProgress {
  received: number
  total: number
}

export interface DownloadOptions {
  onProgress?: (p: DownloadProgress) => void
  headers?: Record<string, string>
}

// Cap on redirect hops (GitHub asset links can chain a few times, e.g. release
// redirect to CDN). Guards against redirect loops.
const MAX_REDIRECTS = 10

// Follows 3xx redirects up to MAX_REDIRECTS times. The http/https module is
// picked from the URL scheme, since asset hosts alternate between both.
function request(url: string, redirects: number, headers: Record<string, string>): Promise<{ res: http.IncomingMessage; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(url, { headers }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        if (redirects <= 0) {
          reject(new Error('Too many redirects'))
          return
        }
        const next = new URL(res.headers.location, url).toString()
        request(next, redirects - 1, headers).then(resolve, reject)
        return
      }
      if (status >= 400) {
        res.resume()
        reject(new Error(`HTTP ${status} for ${url}`))
        return
      }
      resolve({ res, finalUrl: url })
    })
    req.on('error', reject)
    req.setTimeout(30000, () => req.destroy(new Error('Request timed out')))
  })
}

/**
 * Downloads `url` to `destPath`, reporting progress via opts.onProgress.
 * The bytes stream into a `destPath.part` temp file and are only renamed to the
 * final name after the stream finishes, so a failed or cancelled download never
 * leaves a corrupt file behind — the next attempt re-downloads over the temp.
 */
export async function downloadFile(url: string, destPath: string, opts: DownloadOptions = {}): Promise<void> {
  const headers: Record<string, string> = {
    'User-Agent': 'sc64-sd-card-builder',
    Accept: '*/*',
    ...(opts.headers ?? {})
  }
  const { res } = await request(url, MAX_REDIRECTS, headers)
  const total = Number(res.headers['content-length'] ?? 0)
  let received = 0
  await ensureDir(dirname(destPath))
  const tmp = `${destPath}.part`
  const stream = createWriteStream(tmp)
  await new Promise<void>((resolve, reject) => {
    res.on('data', (chunk: Buffer) => {
      received += chunk.length
      opts.onProgress?.({ received, total })
    })
    res.pipe(stream)
    stream.on('finish', resolve)
    stream.on('error', reject)
    res.on('error', reject)
  })
  await rename(tmp, destPath)
}

/** Replaces characters that are illegal in Windows file names so a release asset name can become a path. */
export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim()
}

/** Last path segment of a URL (without the query), for naming downloaded files. */
export function fileNameFromUrl(url: string): string {
  return basename(new URL(url).pathname) || 'download'
}
