import { describe, expect, it } from 'vitest'
import { glowForNight, HOVER_GLOW, HOVER_LIFT, slotFromGroupId, springTowards } from './hover'

describe('slotFromGroupId', () => {
  it('reads the global slot straight off the hit vertex', () => {
    // Meadow terrace remapped to slot 6 while fragment terrace stays 4: the
    // same local _ID on two assets addresses different slots, no cross-talk.
    expect(slotFromGroupId((v) => [4, 6, 5][v], 0)).toBe(4)
    expect(slotFromGroupId((v) => [4, 6, 5][v], 1)).toBe(6)
    expect(slotFromGroupId((v) => [4, 6, 5][v], 2)).toBe(5)
  })

  it('rounds the dequantized float and passes misses through', () => {
    expect(slotFromGroupId(() => 4.0001, 0)).toBe(4)
    expect(slotFromGroupId(() => undefined, 0)).toBeNull()
  })

  it('throws when the batch has no group channel', () => {
    expect(() => slotFromGroupId(null, 0)).toThrow(/no groupId/)
  })
})

describe('springTowards', () => {
  it('approaches the target and snaps so the loop rests', () => {
    let v = 0
    for (let i = 0; i < 200; i++) v = springTowards(v, HOVER_LIFT, 1 / 60)
    expect(v).toBe(HOVER_LIFT)
    expect(springTowards(HOVER_LIFT, 1, 0)).toBe(HOVER_LIFT)
  })
})

describe('glowForNight', () => {
  it('tints by day and blooms at night', () => {
    expect(glowForNight(0)).toBeCloseTo(HOVER_GLOW * 0.35)
    expect(glowForNight(1)).toBe(HOVER_GLOW)
  })
})
