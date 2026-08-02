import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageFile = path.join(root, 'package.json')

const GIT_CANDIDATES = [
  process.env.SC64_GIT,
  'git',
  'C:\\Users\\exus\\AppData\\Local\\GitHubDesktop\\app-3.6.3\\resources\\app\\git\\cmd\\git.exe',
]

function findGit() {
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

const git = findGit()

function run(args, options = {}) {
  const result = spawnSync(git, args, { cwd: root, encoding: 'utf8', ...options })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`git ${args.join(' ')} failed: ${detail}`)
  }
  return result.stdout.trim()
}

function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) throw new Error(`cannot parse version "${version}"`)
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

if (!process.env.GH_TOKEN) {
  console.error('GH_TOKEN is not set. Create one at https://github.com/settings/tokens (scope: repo) and retry.')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(packageFile, 'utf8'))
const nextVersion = bumpPatch(pkg.version)
const nextTag = `v${nextVersion}`
console.log(`Releasing ${nextTag}...`)

const tags = run(['tag', '--list', '--sort=-version:refname'])
const previousTag = tags.split('\n')[0] || null
const range = previousTag ? `${previousTag}..HEAD` : 'HEAD'
const commits = run(['log', range, '--pretty=format:%s'])
const notes = commits
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => `- ${line}`)
  .join('\n')

writeFileSync(
  path.join(root, 'release-notes.md'),
  `## ${nextTag}\n\n${notes}\n`,
  'utf8'
)
console.log('Wrote release-notes.md')
console.log(notes)

pkg.version = nextVersion
writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')

run(['add', 'package.json'])
run(['commit', '-m', `Release ${nextTag}`])
run(['tag', nextTag])
console.log(`Committed and tagged ${nextTag}`)

run(['push', 'origin', 'main'])
run(['push', 'origin', 'main', '--tags'])
console.log('Pushed to origin')

const publish = spawnSync('npm', ['run', 'publish'], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit',
  env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN },
})
if (publish.status !== 0) {
  console.error('Publish failed. The tag/commit are already pushed; fix and run `npm run publish` to retry uploads.')
  process.exit(publish.status ?? 1)
}

console.log(`Done: https://github.com/exusxt/SC64_SD_Card_Builder/releases/tag/${nextTag}`)
