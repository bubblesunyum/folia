import { describe, expect, it } from 'vitest'
import { PANEL_NARROW_PX, panelVariant, viewOffsetTarget } from './metrics'

describe('panelVariant', () => {
  it('takes the side sheet at and above the breakpoint', () => {
    expect(panelVariant(PANEL_NARROW_PX)).toBe('side')
    expect(panelVariant(1440)).toBe('side')
    expect(panelVariant(PANEL_NARROW_PX - 1)).toBe('bottom')
  })
})

describe('viewOffsetTarget', () => {
  it('centers with no panel', () => {
    expect(viewOffsetTarget(1440, 900, null)).toEqual({ x: 0, y: 0 })
  })

  it('pins the e2e offsets: 320,0 wide and 0,210 narrow', () => {
    expect(viewOffsetTarget(1440, 900, 'platform')).toEqual({ x: 320, y: 0 })
    expect(viewOffsetTarget(390, 844, 'platform')).toEqual({ x: 0, y: 210 })
  })

  it('caps the wide sheet at readable measure', () => {
    expect(viewOffsetTarget(3000, 900, 'platform')).toEqual({ x: 320, y: 0 })
  })
})
