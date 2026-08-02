import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitRun, lastTag, commitsInRange, renderSection } from './changelog.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageFile = path.join(root, 'package.json')
const changelogFile = path.join(root, 'CHANGELOG.md')
const releaseNotesFile = path.join(root, 'release-notes.md')
const CHANGELOG_HEADER = [
  '# Changelog',
  '',
  'All notable changes to SC64 SD Card Builder.',
  '',
  'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),',
  'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).',
  ''
].join('\n')

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
const explicitVersion = process.argv[2]
const nextVersion = (explicitVersion || bumpPatch(pkg.version)).replace(/^v/, '')
if (!/^\d+\.\d+\.\d+$/.test(nextVersion)) {
  throw new Error(`invalid version "${nextVersion}"`)
}
const nextTag = `v${nextVersion}`
const prevTag = lastTag(root)
const date = new Date().toISOString().slice(0, 10)
const commits = commitsInRange(prevTag, 'HEAD', root)
const section = renderSection({ version: nextTag, date, fromTag: prevTag, toTag: nextTag, commits })

console.log(`Releasing ${nextTag}...`)
console.log('')
console.log(section)

writeFileSync(releaseNotesFile, section + '\n', 'utf8')
console.log('')
console.log('Wrote release-notes.md')

let changelog = existsSync(changelogFile) ? readFileSync(changelogFile, 'utf8') : ''
if (!changelog.startsWith('# Changelog')) {
  changelog = CHANGELOG_HEADER + changelog
}
const headerEnd = changelog.indexOf('\n## ')
if (headerEnd === -1) {
  changelog = changelog.replace(/\n+$/, '') + '\n\n' + section + '\n'
} else {
  const header = changelog.slice(0, headerEnd + 1)
  const rest = changelog.slice(headerEnd + 1)
  changelog = header + section + '\n\n' + rest
}
writeFileSync(changelogFile, changelog, 'utf8')
console.log('Updated CHANGELOG.md')

pkg.version = nextVersion
writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')

gitRun(['add', 'package.json', 'CHANGELOG.md', 'release-notes.md'], root)
gitRun(['commit', '-m', `Release ${nextTag}`], root)
gitRun(['tag', nextTag], root)
console.log(`Committed and tagged ${nextTag}`)

gitRun(['push', 'origin', 'main'], root)
gitRun(['push', 'origin', 'main', '--tags'], root)
console.log('Pushed to origin')

const publish = spawnSync('npm', ['run', 'publish'], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit',
  env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN }
})
if (publish.status !== 0) {
  console.error('Publish failed. The tag/commit are already pushed; fix and run `npm run publish` to retry uploads.')
  process.exit(publish.status ?? 1)
}

console.log(`Done: https://github.com/exusxt/SC64_SD_Card_Builder/releases/tag/${nextTag}`)
