import { describe, expect, it } from 'vitest'
import { listCases, listPrerenderPaths, listProjects, loadProject, loadTown } from './load'
import type { Block } from './markdown'

/** The loader contract: only the frontmatter title may be a top-level heading. */
function opensWithH1(blocks: Block[]): boolean {
  const [first] = blocks
  return first?.type === 'heading' && first.depth === 1
}

// The content directory through a test-side glob: whatever load.ts reports
// must equal what the files say, so a new .mdx flows through with no edit.
const testGlob = import.meta.glob<string>('../../content/**/*.mdx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function globProjects(): string[] {
  const projects = new Set<string>()
  for (const key of Object.keys(testGlob)) {
    const match = /^..\/..\/content\/([^/]+)\/index\.mdx$/.exec(key)
    if (match?.[1] !== undefined) projects.add(match[1])
  }
  return [...projects].sort()
}

function globCases(project: string): string[] {
  const slugs: string[] = []
  for (const key of Object.keys(testGlob)) {
    const match = /^..\/..\/content\/([^/]+)\/([^/]+)\.mdx$/.exec(key)
    if (match?.[1] === project && match[2] !== 'index' && match[2] !== undefined) {
      slugs.push(match[2])
    }
  }
  return slugs.sort()
}

describe('loadTown', () => {
  it('loads the town overview', () => {
    const town = loadTown()
    expect(town.title).toBe('portfolio town')
    expect(town.blocks.length).toBeGreaterThan(0)
  })
})

describe('content glob (fol-ya7)', () => {
  it('lists every project and case from the files, nothing hand-kept', () => {
    expect(listProjects()).toEqual(globProjects())
    expect(listProjects()).toContain('cortico')
    for (const project of listProjects()) {
      expect(listCases(project)).toEqual(globCases(project))
    }
  })

  it('derives every prerender path from the glob', () => {
    const expected = ['/']
    for (const project of globProjects()) {
      expected.push(`/${project}`)
      for (const slug of globCases(project)) expected.push(`/${project}/${slug}`)
    }
    expect(listPrerenderPaths()).toEqual(expected)
  })
})

describe('loadProject', () => {
  it('loads cortico with its three case studies', () => {
    const project = loadProject('cortico')
    expect(project.slug).toBe('cortico')
    expect(project.neon).toBe('mint')
    expect(project.cases.map((c) => c.slug)).toEqual(['medley', 'platform', 'recorder'])
    for (const c of project.cases) {
      expect(c.kind).toBe('panel')
      expect(c.blocks.length).toBeGreaterThan(0)
    }
  })

  it('fails closed on unknown projects', () => {
    expect(() => loadProject('cortico2')).toThrowError(/unknown project/)
    expect(() => loadProject('')).toThrow()
  })

  it('emits one page title: frontmatter owns it, bodies drop a leading h1', () => {
    expect(opensWithH1(loadTown().blocks)).toBe(false)
    const project = loadProject('cortico')
    expect(opensWithH1(project.blocks)).toBe(false)
    for (const c of project.cases) {
      expect(opensWithH1(c.blocks)).toBe(false)
    }
  })
})
