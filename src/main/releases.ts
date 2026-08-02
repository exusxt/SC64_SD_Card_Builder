import { app } from 'electron'
import * as https from 'node:https'
import type { IncomingHttpHeaders } from 'node:http'
import { join } from 'node:path'
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import type { EmulatorsInfo, MenuReleaseInfo, MetadataReleaseInfo, EmulatorKey, EmulatorInfo } from '../shared/types'

const USER_AGENT = 'sc64-sd-card-builder'
const GITHUB_WEB = 'https://github.com'

const CACHE_TTL_MS = 15 * 60 * 1000

interface CacheEntry {
  at: number
  data: unknown
}

function cacheFile(): string {
  return join(app.getPath('userData'), 'releases-cache.json')
}

function readCache(): Record<string, CacheEntry> {
  try {
    if (!existsSync(cacheFile())) return {}
    return JSON.parse(readFileSync(cacheFile(), 'utf-8'))
  } catch {
    return {}
  }
}

function writeCache(cache: Record<string, CacheEntry>): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(cacheFile(), JSON.stringify(cache), 'utf-8')
  } catch {
    // ignore
  }
}

function cached(key: string): unknown | undefined {
  const cache = readCache()
  const entry = cache[key]
  if (entry && Date.now() - entry.at < CACHE_TTL_MS) return entry.data
  return undefined
}

function storeCache(key: string, data: unknown): void {
  const cache = readCache()
  cache[key] = { at: Date.now(), data }
  writeCache(cache)
}

function githubRequest<T>(path: string, force = false): Promise<T> {
  const key = `gh:${path}`
  if (!force) {
    const hit = cached(key)
    if (hit !== undefined) return Promise.resolve(hit as T)
  }
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.github.com${path}`,
      {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`GitHub API ${res.statusCode}: ${body.slice(0, 300)}`))
            return
          }
          const data = JSON.parse(body)
          storeCache(key, data)
          resolve(data as T)
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(30000, () => req.destroy(new Error('GitHub API timed out')))
  })
}

interface GhAsset {
  name: string
  size: number
  browser_download_url: string
}

interface GhRelease {
  tag_name: string
  name: string
  published_at: string
  prerelease: boolean
  assets: GhAsset[]
}

function assetOf(release: GhRelease, name: string | RegExp): GhAsset | undefined {
  if (release.assets.some((a) => a.name === name)) return release.assets.find((a) => a.name === name)
  const re = typeof name === 'string' ? new RegExp(name) : name
  return release.assets.find((a) => re.test(a.name))
}

interface WebResult {
  status: number
  url: string
  headers: IncomingHttpHeaders
  body: string
}

// Requests against github.com (web) instead of api.github.com. The web endpoints
// are not subject to the API rate limit, which is important for a distributed app
// that must not rely on the anonymous 60 req/hr/IP allowance.
function httpsWebRequest(url: string, method: 'GET' | 'HEAD', redirectsLeft = 5): Promise<WebResult> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' }
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          res.resume()
          const next = new URL(res.headers.location, url).toString()
          httpsWebRequest(next, method, redirectsLeft - 1).then(resolve, reject)
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            url,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8')
          })
        )
      }
    )
    req.on('error', reject)
    req.setTimeout(30000, () => req.destroy(new Error('Request timed out')))
    req.end()
  })
}

function decodePath(p: string): string {
  try {
    return decodeURIComponent(p)
  } catch {
    return p
  }
}

const ASSET_LINK_RE = /href="([^"]*\/releases\/download\/[^"]+)"/g

export interface ReleaseAsset {
  name: string
  size: number
  browser_download_url: string
}

interface WebRelease {
  tag: string | null
  assets: ReleaseAsset[]
}

function scrapeAssetLinks(html: string): ReleaseAsset[] {
  const seen = new Set<string>()
  const assets: ReleaseAsset[] = []
  for (const m of html.matchAll(ASSET_LINK_RE)) {
    const decoded = decodePath(m[1].split('?')[0])
    const name = decoded.slice(decoded.lastIndexOf('/') + 1)
    if (!name || seen.has(name)) continue
    seen.add(name)
    const url = decoded.startsWith('http') ? decoded : `${GITHUB_WEB}${decoded}`
    assets.push({ name, size: 0, browser_download_url: url })
  }
  return assets
}

async function webAssetsForTag(ownerRepo: string, tag: string): Promise<ReleaseAsset[]> {
  const [owner, repo] = ownerRepo.split('/')
  const expanded = await httpsWebRequest(
    `${GITHUB_WEB}/${owner}/${repo}/releases/expanded_assets/${encodeURIComponent(tag)}`,
    'GET'
  )
  return scrapeAssetLinks(expanded.body)
}

const TAG_LINK_RE = /href="([^"]*\/releases\/tag\/[^"]+)"/g

// Tag names from the releases listing page, newest first as rendered by GitHub.
async function webReleaseTags(ownerRepo: string): Promise<string[]> {
  const [owner, repo] = ownerRepo.split('/')
  const res = await httpsWebRequest(`${GITHUB_WEB}/${owner}/${repo}/releases`, 'GET')
  if (res.status !== 200) return []
  const tags: string[] = []
  const seen = new Set<string>()
  for (const m of res.body.matchAll(TAG_LINK_RE)) {
    const tag = decodePath(m[1].split('?')[0].split('/').pop() ?? '')
    if (tag && !seen.has(tag)) {
      seen.add(tag)
      tags.push(tag)
    }
  }
  return tags
}

async function webReleaseInfo(ownerRepo: string, force = false): Promise<WebRelease> {
  const key = `web:${ownerRepo}`
  if (!force) {
    const hit = cached(key)
    if (hit !== undefined) return hit as WebRelease
  }
  const [owner, repo] = ownerRepo.split('/')
  // /releases/latest 302s to the tag page; the final URL carries the tag and the
  // page itself is not subject to the API rate limit.
  const latestRes = await httpsWebRequest(`${GITHUB_WEB}/${owner}/${repo}/releases/latest`, 'GET')
  if (latestRes.status !== 200) throw new Error(`GitHub ${ownerRepo}: HTTP ${latestRes.status}`)
  const tagMatch = latestRes.url.match(/\/releases\/tag\/([^/?#]+)$/)
  const tag = tagMatch ? decodePath(tagMatch[1]) : null
  let assets: ReleaseAsset[] = []
  if (tag) {
    try {
      // The tag page renders the asset list lazily; the expanded fragment has the links.
      assets = await webAssetsForTag(ownerRepo, tag)
    } catch {
      assets = []
    }
  }
  const info: WebRelease = { tag, assets }
  storeCache(key, info)
  return info
}

interface LatestReleaseInfo {
  tag: string | null
  assets: ReleaseAsset[]
}

// Resolves the latest release through the web endpoints first (no API rate limit),
// falling back to the REST API only if the web lookup yields nothing usable.
async function latestRelease(ownerRepo: string, force = false): Promise<LatestReleaseInfo> {
  try {
    const web = await webReleaseInfo(ownerRepo, force)
    if (web.tag && web.assets.length > 0) return web
  } catch {
    // fall back to the API below
  }
  const rel = await githubRequest<GhRelease>(`/repos/${ownerRepo}/releases/latest`, force)
  return {
    tag: rel.tag_name,
    assets: rel.assets.map((a) => ({ name: a.name, size: a.size, browser_download_url: a.browser_download_url }))
  }
}

export async function getMenuRelease(force = false): Promise<MenuReleaseInfo> {
  try {
    const rel = await latestRelease('Polprzewodnikowy/N64FlashcartMenu', force)
    const asset = rel.assets.find((a) => /^sc64menu\.n64$/i.test(a.name))
    return {
      tag: rel.tag ?? 'latest',
      name: asset?.name ?? '',
      publishedAt: '',
      downloadUrl: asset?.browser_download_url ?? null,
      size: asset?.size ?? null
    }
  } catch {
    const rel = await githubRequest<GhRelease>('/repos/Polprzewodnikowy/N64FlashcartMenu/releases/latest', force)
    const asset = assetOf(rel, /^sc64menu\.n64$/i)
    return {
      tag: rel.tag_name,
      name: rel.name,
      publishedAt: rel.published_at,
      downloadUrl: asset?.browser_download_url ?? null,
      size: asset?.size ?? null
    }
  }
}

export async function getMetadataRelease(force = false): Promise<MetadataReleaseInfo> {
  const REPO = 'n64-tools/n64-flashcart-menu-metadata'
  try {
    const rel = await latestRelease(REPO, force)
    const asset = rel.assets.find((a) => a.name.toLowerCase() === 'release-metadata.zip')
    if (asset) {
      return {
        tag: rel.tag ?? 'latest',
        publishedAt: '',
        downloadUrl: asset.browser_download_url,
        size: asset.size
      }
    }
    // The latest release lacks the zip (releases/latest can also land on the
    // listing page instead of a tag); scan recent tags through the web endpoints.
    const tags = await webReleaseTags(REPO)
    for (const tag of tags) {
      const assets = await webAssetsForTag(REPO, tag)
      const a = assets.find((x) => x.name.toLowerCase() === 'release-metadata.zip')
      if (a) {
        return { tag, publishedAt: '', downloadUrl: a.browser_download_url, size: a.size }
      }
    }
  } catch {
    // fall through to the API
  }
  const releases = await githubRequest<GhRelease[]>(`/repos/${REPO}/releases`, force)
  const rel = releases.find((r) => r.assets.some((a) => a.name.toLowerCase() === 'release-metadata.zip'))
  const asset = rel ? rel.assets.find((a) => a.name.toLowerCase() === 'release-metadata.zip') : undefined
  return {
    tag: rel?.tag_name ?? 'unknown',
    publishedAt: rel?.published_at ?? '',
    downloadUrl: asset?.browser_download_url ?? null,
    size: asset?.size ?? null
  }
}

export async function getEmulatorsInfo(force = false): Promise<EmulatorsInfo> {
  const list: EmulatorInfo[] = []
  let offline = false

  try {
    const neon = await latestRelease('hcs64/neon64v2', force)
    const zip = neon.assets.find((a) => /\.zip$/i.test(a.name))
    list.push({
      key: 'nes',
      label: 'NES — Neon64',
      fileName: 'neon64bu.rom',
      version: neon.tag?.replace(/^v/i, '') ?? null,
      error: zip ? undefined : 'No zip asset found'
    })
  } catch (e: any) {
    list.push({ key: 'nes', label: 'NES — Neon64', fileName: 'neon64bu.rom', version: null, error: e?.message ?? 'unavailable' })
  }

  try {
    const sodium = await latestRelease('Hydr8gon/sodium64', force)
    const zip = sodium.assets.find((a) => /\.zip$/i.test(a.name))
    list.push({
      key: 'snes',
      label: 'SNES — Sodium64',
      fileName: 'sodium64.z64',
      version: sodium.tag?.replace(/^v/i, '') ?? null,
      error: zip ? undefined : 'No zip asset found'
    })
  } catch (e: any) {
    list.push({ key: 'snes', label: 'SNES — Sodium64', fileName: 'sodium64.z64', version: null, error: e?.message ?? 'unavailable' })
  }

  // GB64 is a static template hosted on GitHub Pages.
  list.push({
    key: 'gb',
    label: 'Game Boy / Color — GB64',
    fileName: 'gb.v64 + gbc.v64',
    version: '3.2',
    error: undefined
  })

  try {
    const sms = await latestRelease('fhoedemakers/smsplus64', force)
    const asset = sms.assets.find((a) => /^smsPlus64\.z64$/i.test(a.name))
    list.push({
      key: 'sms',
      label: 'SMS / GG — SMSPlus64',
      fileName: 'smsPlus64.z64',
      version: sms.tag?.replace(/^v/i, '') ?? null,
      error: asset ? undefined : 'No smsPlus64.z64 asset found'
    })
  } catch (e: any) {
    list.push({ key: 'sms', label: 'SMS / GG — SMSPlus64', fileName: 'smsPlus64.z64', version: null, error: e?.message ?? 'unavailable' })
  }

  try {
    const pressf = await latestRelease('celerizer/Press-F-Ultra', force)
    const asset = pressf.assets.find((a) => /^Press-F\.z64$/i.test(a.name))
    list.push({
      key: 'chf',
      label: 'Channel F — Press-F Ultra',
      fileName: 'Press-F.z64',
      version: pressf.tag?.replace(/^v/i, '') ?? null,
      error: asset ? undefined : 'No Press-F.z64 asset found'
    })
  } catch (e: any) {
    list.push({ key: 'chf', label: 'Channel F — Press-F Ultra', fileName: 'Press-F.z64', version: null, error: e?.message ?? 'unavailable' })
  }

  offline = list.some((l) => l.error !== undefined)
  return { list, offline }
}

export const GB64_TEMPLATE_URL = 'https://lambertjamesd.github.io/gb64/romwrapper/gb.n64'

export async function latestReleaseAssets(repo: string, force = false): Promise<ReleaseAsset[]> {
  const rel = await latestRelease(repo, force)
  return rel.assets
}

export interface AppUpdateInfo {
  version: string
  assets: ReleaseAsset[]
}

const APP_REPO = 'exusxt/SC64_SD_Card_Builder'

export async function getAppLatestRelease(force = false): Promise<AppUpdateInfo> {
  try {
    const web = await webReleaseInfo(APP_REPO, force)
    if (web.tag && web.assets.length > 0) {
      return { version: web.tag.replace(/^v/i, ''), assets: web.assets }
    }
  } catch {
    // fall back to the API below
  }
  const rel = await githubRequest<GhRelease>(`/repos/${APP_REPO}/releases/latest`, force)
  return {
    version: rel.tag_name.replace(/^v/i, ''),
    assets: rel.assets.map((a) => ({ name: a.name, size: a.size, browser_download_url: a.browser_download_url }))
  }
}

export type { EmulatorKey, EmulatorInfo }
