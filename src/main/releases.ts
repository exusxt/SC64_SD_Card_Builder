// GitHub Releases lookup for the main process: N64FlashcartMenu
// (Polprzewodnikowy/N64FlashcartMenu), the metadata pack
// (n64-tools/n64-flashcart-menu-metadata), and the bundled emulators
// (hcs64/neon64v2, Hydr8gon/sodium64, the GB64 template, fhoedemakers/smsplus64
// and celerizer/Press-F-Ultra). Responses are cached on disk so repeated checks
// do not burn the unauthenticated API rate limit.

import * as https from 'node:https'
import { join } from 'node:path'
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import type { EmulatorsInfo, MenuReleaseInfo, MetadataReleaseInfo, EmulatorKey, EmulatorInfo } from '../shared/types'
import { dataDir } from './portable'

// GitHub rejects unauthenticated requests without a User-Agent header.
const USER_AGENT = 'sc64-sd-card-builder'
const GITHUB_WEB = 'https://github.com'

// Lookups are considered fresh for 30 minutes; the renderer can pass force=true
// to bypass the cache and re-hit the API.
const CACHE_TTL_MS = 30 * 60 * 1000

/** One cached API response: the fetch time plus the raw JSON payload. */
interface CacheEntry {
  at: number
  data: unknown
}

// The cache lives next to settings.json in the app data dir (portable-aware),
// so it is writable without extra permissions in any install layout.
function cacheFile(): string {
  return join(dataDir(), 'releases-cache.json')
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
    mkdirSync(dataDir(), { recursive: true })
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

// Falls back to the last known response (even if stale) when the API is
// rate-limited, so users on shared IPs do not see hard failures. force skips
// the fresh-cache read but still keeps the stale-on-error fallback.
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
            const stale = readCache()[key]
            if (stale && stale.data !== undefined) {
              resolve(stale.data as T)
              return
            }
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

// Picks the asset matching `name` exactly, falling back to a regex test (a
// plain string is treated as a regex too), so emulator zips can be matched
// case-insensitively or by a suffix like .zip.
function assetOf(release: GhRelease, name: string | RegExp): GhAsset | undefined {
  if (release.assets.some((a) => a.name === name)) return release.assets.find((a) => a.name === name)
  const re = typeof name === 'string' ? new RegExp(name) : name
  return release.assets.find((a) => re.test(a.name))
}

// Follows redirects and returns the final URL of a successful HEAD request, or
// null when the target is not reachable. Used against the github.com web
// endpoints, which are not subject to the API rate limit.
function webHeadRedirect(url: string, redirectsLeft = 5): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } },
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
          webHeadRedirect(next, redirectsLeft - 1).then(resolve, reject)
          return
        }
        res.resume()
        resolve(res.statusCode === 200 ? url : null)
      }
    )
    req.on('error', reject)
    req.setTimeout(30000, () => req.destroy(new Error('Request timed out')))
    req.end()
  })
}

// Resolves the version tag behind a github.com /releases/latest redirect (e.g.
// .../tag/v1.2.3). Unlike the API this web endpoint has no rate limit, and no
// per-asset data is needed — just the tag.
async function webLatestTag(ownerRepo: string): Promise<string | null> {
  const [owner, repo] = ownerRepo.split('/')
  const finalUrl = await webHeadRedirect(`${GITHUB_WEB}/${owner}/${repo}/releases/latest`)
  if (!finalUrl) return null
  const match = finalUrl.match(/\/releases\/tag\/([^/?#]+)$/)
  return match ? match[1] : null
}

/** Latest N64FlashcartMenu release info, including the sc64menu.n64 download URL. */
export async function getMenuRelease(force = false): Promise<MenuReleaseInfo> {
  const rel = await githubRequest<GhRelease>('/repos/Polprzewodnikowy/N64FlashcartMenu/releases/latest', force)
  // The menu is a single sc64menu.n64 asset; the download URL is what the
  // renderer downloads (it redirects to an objects.githubusercontent.com URL).
  const asset = assetOf(rel, /^sc64menu\.n64$/i)
  return {
    tag: rel.tag_name,
    name: rel.name,
    publishedAt: rel.published_at,
    downloadUrl: asset?.browser_download_url ?? null,
    size: asset?.size ?? null
  }
}

/** Latest metadata-pack release, whose single zip asset is release-metadata.zip. */
export async function getMetadataRelease(force = false): Promise<MetadataReleaseInfo> {
  // The pack ships as a release-metadata.zip asset that is not guaranteed to be
  // on the newest release, so scan the whole release list for one that carries it.
  const releases = await githubRequest<GhRelease[]>('/repos/n64-tools/n64-flashcart-menu-metadata/releases', force)
  const rel = releases.find((r) => r.assets.some((a) => a.name.toLowerCase() === 'release-metadata.zip'))
  const asset = rel ? rel.assets.find((a) => a.name.toLowerCase() === 'release-metadata.zip') : undefined
  return {
    tag: rel?.tag_name ?? 'unknown',
    publishedAt: rel?.published_at ?? '',
    downloadUrl: asset?.browser_download_url ?? null,
    size: asset?.size ?? null
  }
}

/**
 * Catalog of the bundled emulators. Each entry names the exact file that gets
 * installed into menu/emulators/, so the caller knows what to look for inside
 * the downloaded release (Neon64 and Sodium64 ship the ROM inside a zip).
 * The gb entry is a fixed template, not a GitHub release.
 */
export async function getEmulatorsInfo(force = false): Promise<EmulatorsInfo> {
  const list: EmulatorInfo[] = []
  let offline = false

  try {
    const neon = await githubRequest<GhRelease>('/repos/hcs64/neon64v2/releases/latest', force)
    // The NES core ships inside a release zip as neon64bu.rom.
    const zip = assetOf(neon, /\.zip$/i)
    list.push({
      key: 'nes',
      label: 'NES — Neon64',
      fileName: 'neon64bu.rom',
      version: neon.tag_name,
      error: zip ? undefined : 'No zip asset found'
    })
  } catch (e: any) {
    list.push({ key: 'nes', label: 'NES — Neon64', fileName: 'neon64bu.rom', version: null, error: e?.message ?? 'unavailable' })
  }

  try {
    const sodium = await githubRequest<GhRelease>('/repos/Hydr8gon/sodium64/releases/latest', force)
    // The SNES core also ships inside a zip as sodium64.z64.
    const zip = assetOf(sodium, /\.zip$/i)
    list.push({
      key: 'snes',
      label: 'SNES — Sodium64',
      fileName: 'sodium64.z64',
      version: sodium.tag_name,
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
    const sms = await githubRequest<GhRelease>('/repos/fhoedemakers/smsplus64/releases/latest', force)
    // SMSPlus64 publishes a single ready-to-run smsPlus64.z64 asset.
    const asset = assetOf(sms, /^smsPlus64\.z64$/i)
    list.push({
      key: 'sms',
      label: 'SMS / GG — SMSPlus64',
      fileName: 'smsPlus64.z64',
      version: sms.tag_name,
      error: asset ? undefined : 'No smsPlus64.z64 asset found'
    })
  } catch (e: any) {
    list.push({ key: 'sms', label: 'SMS / GG — SMSPlus64', fileName: 'smsPlus64.z64', version: null, error: e?.message ?? 'unavailable' })
  }

  try {
    const pressf = await githubRequest<GhRelease>('/repos/celerizer/Press-F-Ultra/releases/latest', force)
    // Channel F core publishes a single ready-to-run Press-F.z64 asset.
    const asset = assetOf(pressf, /^Press-F\.z64$/i)
    list.push({
      key: 'chf',
      label: 'Channel F — Press-F Ultra',
      fileName: 'Press-F.z64',
      version: pressf.tag_name,
      error: asset ? undefined : 'No Press-F.z64 asset found'
    })
  } catch (e: any) {
    list.push({ key: 'chf', label: 'Channel F — Press-F Ultra', fileName: 'Press-F.z64', version: null, error: e?.message ?? 'unavailable' })
  }

  // offline just means at least one lookup failed; the renderer uses it to warn
  // that the emulator list may be incomplete rather than to block the install.
  offline = list.some((l) => l.error !== undefined)
  return { list, offline }
}

/** Fixed URL of the GB64 (GB/GBC) template ROM, hosted on GitHub Pages. */
export const GB64_TEMPLATE_URL = 'https://lambertjamesd.github.io/gb64/romwrapper/gb.n64'

/** One asset of the app's own latest release, used by the portable updater. */
export interface ReleaseAsset {
  name: string
  size: number
  browser_download_url: string
}

/** All assets of a repo's latest release (e.g. the portable .exe candidates). */
export async function latestReleaseAssets(repo: string, force = false): Promise<ReleaseAsset[]> {
  const rel = await githubRequest<GhRelease>(`/repos/${repo}/releases/latest`, force)
  return rel.assets.map((a) => ({ name: a.name, size: a.size, browser_download_url: a.browser_download_url }))
}

/** App-version plus the release assets available for download. */
export interface AppUpdateInfo {
  version: string
  assets: ReleaseAsset[]
}

const APP_REPO = 'exusxt/SC64_SD_Card_Builder'

/**
 * Resolves the app's own latest release through the github.com web endpoints
 * (no API rate limit): the latest tag comes from the /releases/latest redirect,
 * and the portable download URL is built from the known asset name.
 */
export async function getAppLatestRelease(): Promise<AppUpdateInfo> {
  const tag = await webLatestTag(APP_REPO)
  if (!tag) throw new Error('Unable to check for updates')
  const version = tag.replace(/^v/i, '')
  // Portable builds are named SC64-SD-Card-Builder-<version>-<arch>.exe; the
  // URL is constructed rather than parsed from the asset list so this check
  // stays a cheap web lookup with no API access.
  const name = `SC64-SD-Card-Builder-${version}-${process.arch}.exe`
  const [owner, repo] = APP_REPO.split('/')
  const downloadUrl = `${GITHUB_WEB}/${owner}/${repo}/releases/latest/download/${name}`
  return {
    version,
    assets: [{ name, size: 0, browser_download_url: downloadUrl }]
  }
}

export type { EmulatorKey, EmulatorInfo }
