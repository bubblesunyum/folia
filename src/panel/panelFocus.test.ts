import { describe, expect, it } from 'vitest'
import { clearFocusReturn, requestFocusReturn, takeFocusReturn, trapWrapTarget } from './panelFocus'

describe('focus return handoff', () => {
  it('hands one slug from the closing panel to the reopening place', () => {
    clearFocusReturn()
    expect(takeFocusReturn()).toBeNull()
    requestFocusReturn('platform')
    expect(takeFocusReturn()).toBe('platform')
    expect(takeFocusReturn()).toBeNull()
  })

  it('a reopening panel clears a stale handoff', () => {
    requestFocusReturn('platform')
    clearFocusReturn()
    expect(takeFocusReturn()).toBeNull()
  })
})

describe('trapWrapTarget', () => {
  it('wraps Tab past the last item back to the first', () => {
    expect(trapWrapTarget(3, 2, false)).toBe(0)
  })

  it('wraps Shift+Tab on the first item to the last', () => {
    expect(trapWrapTarget(3, 0, true)).toBe(2)
  })

  it('wraps Shift+Tab from the trap container itself to the last', () => {
    expect(trapWrapTarget(3, -1, true)).toBe(2)
  })

  it('lets the browser move focus otherwise', () => {
    expect(trapWrapTarget(3, 1, false)).toBeNull()
    expect(trapWrapTarget(3, 0, false)).toBeNull()
    expect(trapWrapTarget(3, 2, true)).toBeNull()
    expect(trapWrapTarget(3, -1, false)).toBeNull()
    expect(trapWrapTarget(0, -1, false)).toBeNull()
  })
})
