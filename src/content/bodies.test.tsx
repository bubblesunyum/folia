import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { caseBody, projectBody, townBody } from './bodies'
import { mdxComponents } from './mdx-components'
import FixtureBody from './mdx-fixture.test.mdx'

// The compiled bodies: prerender and panel share these components, so what
// is asserted here is what both ship. A leading `# title` in the source must
// never double the frontmatter title the routes render as <h1>.
describe('compiled bodies', () => {
  it('renders the town body copy', () => {
    const Town = townBody()
    const html = renderToStaticMarkup(<Town components={mdxComponents} />)
    expect(html).toContain('a solarpunk town seen from above')
  })

  it('renders project and case bodies', () => {
    const Project = projectBody('cortico')
    expect(renderToStaticMarkup(<Project components={mdxComponents} />)).toContain(
      'three pedestals stand in the middle of the forum',
    )
    const Case = caseBody('cortico', 'platform')
    expect(renderToStaticMarkup(<Case components={mdxComponents} />)).toContain(
      'how cortico holds large conversations',
    )
  })

  it('never duplicates the frontmatter title: no leading body h1 survives', () => {
    const Town = townBody()
    expect(renderToStaticMarkup(<Town components={mdxComponents} />)).not.toContain('<h1')
    const Project = projectBody('cortico')
    expect(renderToStaticMarkup(<Project components={mdxComponents} />)).not.toContain('<h1')
    const Case = caseBody('cortico', 'platform')
    expect(renderToStaticMarkup(<Case components={mdxComponents} />)).not.toContain('<h1')
  })

  it('fails closed on unknown bodies', () => {
    expect(() => caseBody('cortico', 'nope')).toThrowError(/missing content body/)
    expect(() => projectBody('nope')).toThrowError(/missing content body/)
  })
})

describe('real MDX (fol-l1r.1)', () => {
  it('renders JSX components and expressions, not source text', () => {
    const html = renderToStaticMarkup(<FixtureBody components={mdxComponents} />)
    expect(html).toContain('data-testid="mdx-fixture-widget"')
    expect(html).toContain('jsx lands here')
    expect(html).toContain('two plus two is 4.')
    expect(html).not.toContain('{2 + 2}')
    expect(html).not.toContain('<h1')
  })
})
