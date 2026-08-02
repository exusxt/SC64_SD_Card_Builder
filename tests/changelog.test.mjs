import { describe, expect, it } from 'vitest'
import { classify, renderSection } from '../scripts/changelog.mjs'

describe('classify', () => {
  it('maps conventional commit types', () => {
    expect(classify('feat: add categorized changelog')).toEqual({ cat: 'Added', text: 'Add categorized changelog' })
    expect(classify('fix: handle missing drive')).toEqual({ cat: 'Fixed', text: 'Handle missing drive' })
    expect(classify('docs: cover all platforms')).toEqual({ cat: 'Infra', text: 'Cover all platforms' })
    expect(classify('refactor: simplify copy')).toEqual({ cat: 'Changed', text: 'Simplify copy' })
  })

  it('maps plain-language subjects', () => {
    expect(classify('Add new feature')).toEqual({ cat: 'Added', text: 'New feature' })
    expect(classify('Fixes crash on start')).toEqual({ cat: 'Fixed', text: 'Crash on start' })
  })

  it('skips release commits', () => {
    expect(classify('Release v0.2.1')).toBeNull()
  })
})

describe('renderSection', () => {
  it('renders a categorized section with compare link', () => {
    const section = renderSection({
      version: 'v0.2.2',
      date: '2026-08-02',
      fromTag: 'v0.2.1',
      toTag: 'v0.2.2',
      commits: [
        { sha: 'abc1234', subject: 'feat: add tests' },
        { sha: 'def5678', subject: 'Release v0.2.2' }
      ]
    })
    expect(section).toContain('## [v0.2.2] - 2026-08-02')
    expect(section).toContain('### Added')
    expect(section).toContain('- Add tests')
    expect(section).toContain('[Compare v0.2.1...v0.2.2]')
    expect(section).not.toContain('Release v0.2.2')
  })
})
