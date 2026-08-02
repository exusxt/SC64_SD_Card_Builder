import { app } from 'electron'
import * as https from 'node:https'
import { join } from 'node:path'
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import type { EmulatorsInfo, MenuReleaseInfo, MetadataReleaseInfo, EmulatorKey, EmulatorInfo } from '../shared/types'

const USER_AGENT = 'sc64-sd-card-builder'

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

export async function getMenuRelease(force = false): Promise<MenuReleaseInfo> {
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

export async function getMetadataRelease(force = false): Promise<MetadataReleaseInfo> {
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

export async function getEmulatorsInfo(force = false): Promise<EmulatorsInfo> {
  const list: EmulatorInfo[] = []
  let offline = false

  try {
    const neon = await githubRequest<GhRelease>('/repos/hcs64/neon64v2/releases/latest', force)
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

  offline = list.some((l) => l.error !== undefined)
  return { list, offline }
}

export const GB64_TEMPLATE_URL = 'https://lambertjamesd.github.io/gb64/romwrapper/gb.n64'

export interface ReleaseAsset {
  name: string
  size: number
  browser_download_url: string
}

export async function latestReleaseAssets(repo: string, force = false): Promise<ReleaseAsset[]> {
  const rel = await githubRequest<GhRelease>(`/repos/${repo}/releases/latest`, force)
  return rel.assets.map((a) => ({ name: a.name, size: a.size, browser_download_url: a.browser_download_url }))
}

export type { EmulatorKey, EmulatorInfo }
