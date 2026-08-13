// Validation report writer for the main process. After a prepare run it emits
// a self-contained sc64-report.html (inline CSS, no external assets) and a
// matching sc64-report.csv at the card root, built from the run's log lines,
// per-file rows and counters: app version, duration, ok flag, and one status
// per file (copied/duplicate/verify-fail/not-n64/not-gb/etc.).

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PrepareMode } from '../shared/types'
import { translate, type Locale, type TranslationKey } from '../shared/i18n'
import { ensureDir } from './fspaths'

/** Outcome of one file during the prepare run, shown per row in the report. */
export type ReportRowStatus = 'copied' | 'skipped' | 'duplicate' | 'verify-fail' | 'not-n64' | 'other'

/** One file row in the report: what happened to it and where it went. */
export interface ReportRow {
  status: ReportRowStatus
  source: string
  target: string
  size: number
  game: string
  region: string
  note: string
}

/** One entry of the run's activity log, rendered into the HTML report. */
export interface ReportLog {
  level: 'info' | 'success' | 'warn' | 'error'
  message: string
}

/** Summary counters for the run; each maps to a stat tile in the HTML report. */
export interface ReportCounts {
  romsCopied: number
  duplicates: number
  verified: number
  verifyFailures: number
  cheatsCopied: number
  savesCreated: number
  archivesExtracted: number
  emulatorsInstalled: number
  ddiplInstalled: number
  normalized: number
  menuTag: string
  metadataTag: string
}

/** Everything the report needs: run context, counters, per-file rows and logs. */
export interface ReportData {
  appVersion: string
  locale: Locale
  destination: string
  mode: PrepareMode
  startedAt: string
  durationMs: number
  ok: boolean
  counts: ReportCounts
  rows: ReportRow[]
  logs: ReportLog[]
}

// Ordered list driving the summary stat grid; keeps the HTML output free of
// hard-coded stat order and lets the i18n labels and counters stay in one place.
const REPORT_STATS: Array<{ key: string; countKey: keyof ReportCounts }> = [
  { key: 'report.romsCopied', countKey: 'romsCopied' },
  { key: 'report.duplicates', countKey: 'duplicates' },
  { key: 'report.filesVerified', countKey: 'verified' },
  { key: 'report.verifyFailures', countKey: 'verifyFailures' },
  { key: 'report.cheatsCopied', countKey: 'cheatsCopied' },
  { key: 'report.savesCreated', countKey: 'savesCreated' },
  { key: 'report.archivesExtracted', countKey: 'archivesExtracted' },
  { key: 'report.emulatorsInstalled', countKey: 'emulatorsInstalled' },
  { key: 'report.ddiplInstalled', countKey: 'ddiplInstalled' },
  { key: 'report.normalized', countKey: 'normalized' }
]

// Escapes the five characters that are significant inside HTML text so any
// filename or log message is safe to inline verbatim.
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function formatSize(bytes: number): string {
  // Zero/unknown sizes render as an em dash instead of "0 B".
  if (!bytes || bytes <= 0) return '\u2014'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function humanizeDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function csvField(value: string | number): string {
  let s = String(value)
  // Guard against CSV formula injection: a leading =, +, -, or @ would be
  // evaluated by Excel, so it is neutralized with a leading apostrophe.
  if (/^[=+\-@]/.test(s)) s = "'" + s
  // Wrap in quotes (doubling inner quotes) when the value contains separators.
  if (/[",;\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}

function tl(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  return translate(locale, key as TranslationKey, vars)
}

/**
 * Builds the CSV report: a header row plus one line per file row, all fields
 * localized and CSV-escaped. Lines use CRLF so the file opens cleanly in Excel.
 */
export function buildReportCsv(data: ReportData): string {
  const header = [
    tl(data.locale, 'report.columnStatus'),
    tl(data.locale, 'report.columnSource'),
    tl(data.locale, 'report.columnDestination'),
    tl(data.locale, 'report.columnSize'),
    tl(data.locale, 'report.columnGame'),
    tl(data.locale, 'report.columnRegion'),
    tl(data.locale, 'report.columnNote')
  ]
  const lines = [header.map(csvField).join(',')]
  for (const r of data.rows) {
    lines.push([
      tl(data.locale, `report.status.${r.status}`),
      r.source, r.target, String(r.size), r.game, r.region, r.note
    ].map(csvField).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

/**
 * Builds the self-contained HTML report (inline CSS, localized labels, dark
 * theme). The overall status banner reflects the ok flag and the severest log
 * level, while the summary grid, file table and activity log come straight
 * from the run's counters, rows and logs.
 */
export function buildReportHtml(data: ReportData): string {
  const counts = data.counts

  // A run can finish "ok" yet still contain warning/error log lines; the
  // banner picks the severest of those before settling on plain "ok".
  const statusKey = data.ok
    ? data.logs.some((l) => l.level === 'error') ? 'report.statusErrors'
      : data.logs.some((l) => l.level === 'warn') ? 'report.statusWarnings'
        : 'report.statusOk'
    : 'report.statusErrors'

  const stats = REPORT_STATS.map((s) =>
    `<div class="stat"><div class="stat-value">${counts[s.countKey]}</div><div class="stat-label">${esc(tl(data.locale, s.key))}</div></div>`
  ).join('\n')

  const metaRows: Array<[string, string]> = [
    [tl(data.locale, 'report.destination'), data.destination],
    [tl(data.locale, 'report.mode'), tl(data.locale, `report.mode.${data.mode}`)],
    [tl(data.locale, 'report.duration'), humanizeDuration(data.durationMs)]
  ]
  if (counts.menuTag) metaRows.push([tl(data.locale, 'report.menuTag'), counts.menuTag])
  if (counts.metadataTag) metaRows.push([tl(data.locale, 'report.metadataTag'), counts.metadataTag])

  const meta = metaRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('\n')

  const rowRows = data.rows.map((r) =>
    `<tr class="st-${r.status}"><td>${esc(tl(data.locale, `report.status.${r.status}`))}</td>` +
    `<td>${esc(r.source)}</td><td>${esc(r.target)}</td><td class="num">${formatSize(r.size)}</td>` +
    `<td>${esc(r.game)}</td><td>${esc(r.region)}</td><td>${esc(r.note)}</td></tr>`
  ).join('\n')

  const logRows = data.logs.map((l) =>
    `<li class="lg-${l.level}"><span class="lg-tag">${esc(l.level)}</span>${esc(l.message)}</li>`
  ).join('\n')

  const colHeaders = ['report.columnStatus', 'report.columnSource', 'report.columnDestination', 'report.columnSize', 'report.columnGame', 'report.columnRegion', 'report.columnNote']
    .map((k) => `<th>${esc(tl(data.locale, k))}</th>`).join('')

  const detailTable = data.rows.length === 0
    ? `<p class="empty">${esc(tl(data.locale, 'report.empty'))}</p>`
    : `<table><thead><tr>${colHeaders}</tr></thead><tbody>${rowRows}</tbody></table>`

  const generated = esc(tl(data.locale, 'report.generatedAt', { date: new Date(data.startedAt).toLocaleString(data.locale) }))

  return `<!DOCTYPE html>
<html lang="${data.locale}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(tl(data.locale, 'report.title'))}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b1020; color: #e2e8f0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 28px 20px 60px; }
  header h1 { font-size: 22px; margin: 0 0 6px; }
  .sub { color: #8b98b8; font-size: 13px; margin-bottom: 18px; }
  .banner { padding: 12px 16px; border-radius: 10px; font-weight: 600; font-size: 14px; margin-bottom: 22px; }
  .banner.ok { background: rgba(52, 211, 153, .12); color: #34d399; border: 1px solid rgba(52, 211, 153, .35); }
  .banner.warn { background: rgba(251, 191, 36, .12); color: #fbbf24; border: 1px solid rgba(251, 191, 36, .35); }
  .banner.err { background: rgba(248, 113, 113, .12); color: #f87171; border: 1px solid rgba(248, 113, 113, .35); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-bottom: 24px; }
  .stat { background: #111a30; border: 1px solid #223052; border-radius: 10px; padding: 12px; }
  .stat-value { font-size: 20px; font-weight: 700; color: #38bdf8; }
  .stat-label { font-size: 11px; color: #8b98b8; margin-top: 2px; text-transform: uppercase; letter-spacing: .04em; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #8b98b8; margin: 26px 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; background: #0e1526; border: 1px solid #223052; border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #1a243d; vertical-align: top; }
  th { color: #8b98b8; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; background: #111a30; }
  td.num { text-align: right; white-space: nowrap; }
  tr.st-skipped td, tr.st-duplicate td { color: #8b98b8; }
  tr.st-verify-fail td { color: #f87171; }
  tr.st-not-n64 td { color: #fbbf24; }
  .empty { color: #8b98b8; font-size: 13px; }
  ul.log { list-style: none; margin: 0; padding: 0; background: #0e1526; border: 1px solid #223052; border-radius: 10px; }
  ul.log li { padding: 6px 12px; border-bottom: 1px solid #1a243d; font-size: 12.5px; font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; }
  ul.log li:last-child { border-bottom: 0; }
  .lg-tag { display: inline-block; width: 58px; text-transform: uppercase; font-size: 10px; letter-spacing: .05em; margin-right: 8px; }
  .lg-info .lg-tag { color: #38bdf8; }
  .lg-success .lg-tag { color: #34d399; }
  .lg-warn .lg-tag { color: #fbbf24; }
  .lg-error .lg-tag { color: #f87171; }
  .lg-info { color: #c7d2ea; }
  .lg-success { color: #b8f5d8; }
  .lg-warn { color: #fde8b8; }
  .lg-error { color: #f8c9c9; }
  footer { margin-top: 30px; color: #8b98b8; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${esc(tl(data.locale, 'report.title'))}</h1>
    <div class="sub">${generated}${data.appVersion ? ` &middot; ${esc(data.appVersion)}` : ''}</div>
  </header>
  <div class="banner ${data.ok ? (statusKey === 'report.statusWarnings' ? 'warn' : 'ok') : 'err'}">${esc(tl(data.locale, statusKey))}</div>
  <table><tbody>${meta}</tbody></table>
  <h2>${esc(tl(data.locale, 'report.summary'))}</h2>
  <div class="grid">${stats}</div>
  <h2>${esc(tl(data.locale, 'report.romDetails'))}</h2>
  ${detailTable}
  <h2>${esc(tl(data.locale, 'report.activityLog'))}</h2>
  <ul class="log">${logRows}</ul>
  <footer>${generated}</footer>
</div>
</body>
</html>`
}

/**
 * Writes sc64-report.html and sc64-report.csv into the card root and returns
 * their paths. Returns null when no destination is given or a write fails, so
 * a report problem never fails the whole prepare run.
 */
export async function writeReport(data: ReportData, destRoot: string): Promise<{ html: string; csv: string } | null> {
  if (!destRoot) return null
  try {
    await ensureDir(destRoot)
    const htmlPath = join(destRoot, 'sc64-report.html')
    const csvPath = join(destRoot, 'sc64-report.csv')
    await writeFile(htmlPath, buildReportHtml(data), 'utf-8')
    await writeFile(csvPath, buildReportCsv(data), 'utf-8')
    return { html: htmlPath, csv: csvPath }
  } catch {
    return null
  }
}
