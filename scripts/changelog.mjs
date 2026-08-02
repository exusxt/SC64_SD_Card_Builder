import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const GIT_CANDIDATES = [
  process.env.SC64_GIT,
  'git',
  'C:\\Users\\exus\\AppData\\Local\\GitHubDesktop\\app-3.6.3\\resources\\app\\git\\cmd\\git.exe'
]

export function findGit() {
  for (const candidate of GIT_CANDIDATES) {
    if (!candidate) continue
    if (candidate === 'git') {
      const probe = spawnSync('git', ['--version'], { encoding: 'utf8' })
      if (probe.status === 0) return candidate
      continue
    }
    if (existsSync(candidate)) return candidate
  }
  throw new Error('git not found. Install git or point the SC64_GIT env var at git.exe.')
}

export function gitRun(args, cwd) {
  const result = spawnSync(findGit(), args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`git ${args.join(' ')} failed: ${detail}`)
  }
  return result.stdout.trim()
}

export function lastTag(cwd) {
  const tags = gitRun(['tag', '--list', '--sort=-version:refname'], cwd)
  return tags.split('\n')[0] || null
}

export function commitDate(cwd, ref) {
  try {
    return gitRun(['log', '-1', '--format=%cs', ref], cwd)
  } catch {
    return ''
  }
}

export function commitsInRange(from, to, cwd) {
  const range = from ? `${from}..${to}` : to
  const out = gitRun(['log', range, '--pretty=format:%h|%s'], cwd)
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const sep = line.indexOf('|')
      return { sha: line.slice(0, sep), subject: line.slice(sep + 1) }
    })
}

const TYPE_CATEGORY = {
  feat: 'Added',
  fix: 'Fixed',
  revert: 'Fixed',
  docs: 'Infra',
  chore: 'Infra',
  test: 'Infra',
  build: 'Infra',
  ci: 'Infra',
  refactor: 'Changed',
  perf: 'Changed',
  style: 'Changed'
}

const CATEGORY_ORDER = ['Added', 'Changed', 'Fixed', 'Infra', 'Other']

function isReleaseCommit(subject) {
  return /^release\s+v?\d/i.test(subject)
}

function titleCase(text) {
  return text.replace(/^./, (c) => c.toUpperCase())
}

export function classify(subject) {
  if (isReleaseCommit(subject)) return null
  const m = /^([a-z]+)(\(([^)]*)\))?(!)?:\s*(.*)$/i.exec(subject)
  if (m) {
    const cat = TYPE_CATEGORY[m[1].toLowerCase()]
    if (cat) return { cat, text: titleCase((m[4] ? 'BREAKING: ' : '') + (m[5] || subject)) }
  }
  if (/^adds? /i.test(subject)) return { cat: 'Added', text: titleCase(subject.replace(/^adds? /i, '')) }
  if (/^fix(es|ed)? /i.test(subject)) return { cat: 'Fixed', text: titleCase(subject.replace(/^fix(es|ed)? /i, '')) }
  if (/^initial commit/i.test(subject)) return { cat: 'Added', text: subject }
  const lower = subject.toLowerCase()
  if (/\b(bump|pin|upgrade|migrate|install|workflow|actions|github action|node|electron-builder|typescript|vite|tailwind)\b/.test(lower)) {
    return { cat: 'Infra', text: subject }
  }
  if (/^(remove|drop|rewrite|replace|stop|use|delete|cleanup|rename|move|update|improve|switch|change|simplif|handl|support|allow|enable|disable)\b/.test(lower)) {
    return { cat: 'Changed', text: subject }
  }
  return { cat: 'Other', text: subject }
}

export function renderSection({ version, date, fromTag, toTag, commits }) {
  const groups = {}
  for (const c of commits) {
    const cls = classify(c.subject)
    if (!cls) continue
    ;(groups[cls.cat] ??= []).push(cls.text)
  }
  const lines = [`## [${version}] - ${date}`]
  for (const cat of CATEGORY_ORDER) {
    const items = groups[cat]
    if (!items || items.length === 0) continue
    lines.push('', `### ${cat}`, '')
    for (const item of items) lines.push(`- ${item}`)
  }
  if (fromTag && toTag) {
    lines.push(
      '',
      `[Compare ${fromTag}...${toTag}](https://github.com/exusxt/SC64_SD_Card_Builder/compare/${fromTag}...${toTag})`
    )
  }
  return lines.join('\n')
}

const root = process.cwd()

if (process.argv[2] === 'all') {
  const tags = gitRun(['tag', '--list', '--sort=-version:refname'], root)
    .split('\n')
    .filter(Boolean)
  const sections = []
  for (let i = 0; i < tags.length; i++) {
    const to = tags[i]
    const from = i + 1 < tags.length ? tags[i + 1] : null
    const commits = commitsInRange(from, to, root)
    sections.push(renderSection({ version: to, date: commitDate(root, to), fromTag: from, toTag: to, commits }))
  }
  process.stdout.write(sections.join('\n\n') + '\n')
}
