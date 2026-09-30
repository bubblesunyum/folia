import { describe, expect, it } from 'vitest'
import { getCaseInView, onCaseInView, setCaseInView } from './caseInView'

describe('caseInView', () => {
  it('starts closed and fans open/swap/close out to rigs', () => {
    setCaseInView(null)
    expect(getCaseInView()).toBeNull()
    const seen: (string | null)[] = []
    const off = onCaseInView((slug) => seen.push(slug))
    setCaseInView('platform')
    expect(getCaseInView()).toBe('platform')
    setCaseInView('recorder')
    setCaseInView(null)
    expect(getCaseInView()).toBeNull()
    off()
    setCaseInView('medley')
    expect(seen).toEqual(['platform', 'recorder', null])
    setCaseInView(null)
  })

  it('stays silent on a no-op write', () => {
    setCaseInView(null)
    let calls = 0
    const off = onCaseInView(() => {
      calls += 1
    })
    setCaseInView(null)
    expect(calls).toBe(0)
    off()
  })
})
