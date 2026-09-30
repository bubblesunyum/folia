// The group-state texture's contract: one RGBA float texel per slot, one
// upload per write, fail-closed indexing.

import { afterEach, describe, expect, it } from 'vitest'
import { MAX_GROUPS } from '../groupSlots'
import {
  clearGroupSlot,
  GROUP_STATE_BYTES,
  GROUP_STATE_HEIGHT,
  GROUP_STATE_WIDTH,
  groupSlotU,
  groupStateTexture,
  groupStateUploads,
  readGroupSlot,
  resetGroupState,
  setGroupSlot,
} from './groupState'

afterEach(() => {
  resetGroupState()
})

describe('group state texture', () => {
  it('packs one RGBA float texel per slot in a single row', () => {
    expect(GROUP_STATE_WIDTH).toBe(MAX_GROUPS)
    expect(GROUP_STATE_HEIGHT).toBe(1)
    expect(GROUP_STATE_BYTES).toBe(MAX_GROUPS * 16)
    expect(groupStateTexture.image).toMatchObject({ width: MAX_GROUPS, height: 1 })
  })

  it('round-trips lift, glow and tint through one texel', () => {
    setGroupSlot(3, 0.25, 0.6, 0.5)
    const slot = readGroupSlot(3)
    expect(slot.lift).toBe(0.25)
    expect(slot.glow).toBeCloseTo(0.6, 6)
    expect(slot.tint).toBe(0.5)
    // Neighbours are untouched: a hover writes one texel.
    expect(readGroupSlot(2)).toEqual({ lift: 0, glow: 0, tint: 0 })
    expect(readGroupSlot(4)).toEqual({ lift: 0, glow: 0, tint: 0 })
  })

  it('clears a slot back to the authored rest pose', () => {
    setGroupSlot(3, 0.25, 0.6)
    clearGroupSlot(3)
    expect(readGroupSlot(3)).toEqual({ lift: 0, glow: 0, tint: 0 })
  })

  it('flags one upload per write and rests at zero', () => {
    expect(groupStateUploads).toBe(0)
    const version = groupStateTexture.version
    setGroupSlot(1, 0.25, 0.6)
    expect(groupStateUploads).toBe(1)
    // `needsUpdate` is setter-only in three; the version bump is the upload.
    expect(groupStateTexture.version).toBe(version + 1)
  })

  it('centres each slot on its texel, mirroring the shader index math', () => {
    expect(groupSlotU(0)).toBeCloseTo(0.5 / MAX_GROUPS, 12)
    expect(groupSlotU(MAX_GROUPS - 1)).toBeCloseTo((MAX_GROUPS - 0.5) / MAX_GROUPS, 12)
  })

  it('fails closed on a bad slot or channel', () => {
    expect(() => setGroupSlot(-1, 0, 0)).toThrow(/outside/)
    expect(() => setGroupSlot(MAX_GROUPS, 0, 0)).toThrow(/outside/)
    expect(() => setGroupSlot(1.5, 0, 0)).toThrow(/outside/)
    expect(() => setGroupSlot(0, Number.NaN, 0)).toThrow(/finite/)
    expect(() => readGroupSlot(MAX_GROUPS)).toThrow(/outside/)
  })
})
