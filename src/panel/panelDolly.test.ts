import { describe, expect, it } from 'vitest'
import { REFRAME_MS } from '../motion/flight'
import { dollyFlightStep, PANEL_VANTAGE_M, resolvePanelDolly } from './panelDolly'

const OPEN = {
  slug: 'platform' as const,
  variant: 'side' as const,
  distance: 80,
  state: { goal: null as number | null, restore: null as number | null },
}

describe('resolvePanelDolly', () => {
  it('engages past the margin and records the pre-open distance', () => {
    const decision = resolvePanelDolly(OPEN)
    expect(decision.state).toEqual({ goal: PANEL_VANTAGE_M, restore: 80 })
    expect(decision.claim).toBe(true)
  })

  it('stays put inside the margin', () => {
    const decision = resolvePanelDolly({ ...OPEN, distance: PANEL_VANTAGE_M + 1 })
    expect(decision.state).toEqual({ goal: null, restore: null })
    expect(decision.claim).toBe(false)
  })

  it('does not re-claim mid-dolly on re-fire', () => {
    const decision = resolvePanelDolly({
      ...OPEN,
      distance: 65,
      state: { goal: PANEL_VANTAGE_M, restore: 80 },
    })
    expect(decision.state).toEqual({ goal: PANEL_VANTAGE_M, restore: 80 })
    expect(decision.claim).toBe(false)
  })

  it('reopen mid-restore overrides the goal and keeps the original restore', () => {
    const decision = resolvePanelDolly({
      ...OPEN,
      distance: 65,
      state: { goal: 80, restore: 80 },
    })
    expect(decision.state).toEqual({ goal: PANEL_VANTAGE_M, restore: 80 })
    expect(decision.claim).toBe(true)
  })

  it('ignores narrow viewports but keeps the session restore', () => {
    const decision = resolvePanelDolly({
      ...OPEN,
      variant: 'bottom',
      state: { goal: PANEL_VANTAGE_M, restore: 80 },
    })
    expect(decision.state).toEqual({ goal: null, restore: 80 })
    expect(decision.claim).toBe(false)
  })

  it('drives back on close while a restore survives', () => {
    const decision = resolvePanelDolly({
      slug: null,
      variant: 'side',
      distance: PANEL_VANTAGE_M,
      state: { goal: null, restore: 80 },
    })
    expect(decision.state).toEqual({ goal: 80, restore: 80 })
    expect(decision.claim).toBe(true)
  })

  it('close mid-dolly drives back: survival proves the user never drove', () => {
    const decision = resolvePanelDolly({
      slug: null,
      variant: 'side',
      distance: 65,
      state: { goal: PANEL_VANTAGE_M, restore: 80 },
    })
    expect(decision.state).toEqual({ goal: 80, restore: 80 })
    expect(decision.claim).toBe(true)
  })

  it('close re-fire mid-restore neither freezes nor double-claims', () => {
    const decision = resolvePanelDolly({
      slug: null,
      variant: 'side',
      distance: 65,
      state: { goal: 80, restore: 80 },
    })
    expect(decision.state).toEqual({ goal: 80, restore: 80 })
    expect(decision.claim).toBe(false)
  })

  it('close with no restore leaves an in-flight drive alone', () => {
    const decision = resolvePanelDolly({
      slug: null,
      variant: 'side',
      distance: 65,
      state: { goal: PANEL_VANTAGE_M, restore: null },
    })
    expect(decision.state).toEqual({ goal: PANEL_VANTAGE_M, restore: null })
    expect(decision.claim).toBe(false)
  })
})

describe('dollyFlightStep', () => {
  it('eases from the current distance to the goal on the one easing', () => {
    expect(dollyFlightStep(80, PANEL_VANTAGE_M, 1000, 1000)).toBe(80)
    const mid = dollyFlightStep(80, PANEL_VANTAGE_M, 1000, 1000 + REFRAME_MS / 2)
    expect(mid).toBeGreaterThan(PANEL_VANTAGE_M)
    expect(mid).toBeLessThan(80)
    // Ease-out: past halfway by mid-flight.
    expect(mid).toBeLessThan((80 + PANEL_VANTAGE_M) / 2)
    expect(dollyFlightStep(80, PANEL_VANTAGE_M, 1000, 1000 + REFRAME_MS)).toBe(PANEL_VANTAGE_M)
  })

  it('clamps past the end and honors a custom duration', () => {
    expect(dollyFlightStep(80, PANEL_VANTAGE_M, 1000, 9000)).toBe(PANEL_VANTAGE_M)
    expect(dollyFlightStep(80, PANEL_VANTAGE_M, 1000, 1000, 0)).toBe(PANEL_VANTAGE_M)
  })
})
