import { createWriteStream } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { dirname, basename } from 'node:path'
import * as https from 'node:https'
import * as http from 'node:http'

export interface DownloadProgress {
  received: number
  total: number
}

export interface DownloadOptions {
  onProgress?: (p: DownloadProgress) => void
  headers?: Record<string, string>
}

const MAX_REDIRECTS = 10

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

export async function downloadFile(url: string, destPath: string, opts: DownloadOptions = {}): Promise<void> {
  const headers: Record<string, string> = {
    'User-Agent': 'sc64-sd-card-builder',
    Accept: '*/*',
    ...(opts.headers ?? {})
  }
  const { res } = await request(url, MAX_REDIRECTS, headers)
  const total = Number(res.headers['content-length'] ?? 0)
  let received = 0
  await mkdir(dirname(destPath), { recursive: true })
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

export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim()
}

export function fileNameFromUrl(url: string): string {
  return basename(new URL(url).pathname) || 'download'
}
