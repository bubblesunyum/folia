import { describe, expect, it } from 'vitest'
import { loadProject, loadTown } from './load'
import type { Block } from './markdown'

/** The loader contract: only the frontmatter title may be a top-level heading. */
function opensWithH1(blocks: Block[]): boolean {
  const [first] = blocks
  return first?.type === 'heading' && first.depth === 1
}

describe('loadTown', () => {
  it('loads the town overview', () => {
    const town = loadTown()
    expect(town.title).toBe('portfolio town')
    expect(town.blocks.length).toBeGreaterThan(0)
  })
})

describe('loadProject', () => {
  it('loads cortico with its three case studies', () => {
    const project = loadProject()
    expect(project.slug).toBe('cortico')
    expect(project.neon).toBe('mint')
    expect(project.cases.map((c) => c.slug)).toEqual(['platform', 'recorder', 'medley'])
    for (const c of project.cases) {
      expect(c.kind).toBe('panel')
      expect(c.blocks.length).toBeGreaterThan(0)
    }
  })

  it('emits one page title: frontmatter owns it, bodies drop a leading h1', () => {
    expect(opensWithH1(loadTown().blocks)).toBe(false)
    const project = loadProject()
    expect(opensWithH1(project.blocks)).toBe(false)
    for (const c of project.cases) {
      expect(opensWithH1(c.blocks)).toBe(false)
    }
  })
})
