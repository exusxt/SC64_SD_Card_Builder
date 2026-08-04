import { N64_REGION_LABELS, type N64Header } from './n64validate'

const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g
const COLLAPSE_WS = /\s+/g
const TRAILING_DOTS = /[. ]+$/g

export function cleanTitle(raw: string): string {
  const cleaned = raw
    .replace(INVALID_CHARS, ' ')
    .replace(COLLAPSE_WS, ' ')
    .replace(TRAILING_DOTS, '')
    .trim()
  return cleaned.length > 0 ? cleaned : 'Unknown'
}

export function organizeBase(header: N64Header): string {
  return `${cleanTitle(header.title)} (${N64_REGION_LABELS[header.region]})`
}

export function uniqueBase(base: string, used: Set<string>): string {
  let candidate = base
  let i = 2
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} (${i})`
    i++
  }
  used.add(candidate.toLowerCase())
  return candidate
}

export function chtNameOf(target: string): string {
  const last = target.lastIndexOf('.')
  const stem = last >= 0 ? target.slice(0, last) : target
  return `${stem}.cht`
}
