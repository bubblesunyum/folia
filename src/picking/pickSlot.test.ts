import { describe, expect, it, vi } from 'vitest'
import { pickSlotFromHit } from './pickSlot'

function rig(hit: { faceA: number; getX: (v: number) => number } | null, noAttr = false) {
  const pointer = { set: vi.fn() }
  const raycaster = {
    setFromCamera: vi.fn(),
    intersectObjects: vi.fn((): unknown[] => []),
  }
  if (hit) {
    const geometry = {
      getAttribute: vi.fn(() => (noAttr ? null : { getX: hit.getX })),
    }
    raycaster.intersectObjects = vi.fn((): unknown[] => [
      { face: { a: hit.faceA }, object: { geometry } },
    ])
  }
  return { pointer, raycaster }
}

describe('pickSlotFromHit', () => {
  it('returns null on a miss', () => {
    const { pointer, raycaster } = rig(null)
    expect(
      pickSlotFromHit(new Map() as never, raycaster as never, pointer as never, {} as never),
    ).toBeNull()
    expect(raycaster.setFromCamera).toHaveBeenCalled()
  })

  it('reads the slot off the hit vertex', () => {
    const { pointer, raycaster } = rig({ faceA: 3, getX: () => 9 })
    expect(
      pickSlotFromHit(new Map() as never, raycaster as never, pointer as never, {} as never),
    ).toBe(9)
  })

  it('throws on a missing groupId attribute', () => {
    const { pointer, raycaster } = rig({ faceA: 3, getX: () => 9 }, true)
    expect(() =>
      pickSlotFromHit(new Map() as never, raycaster as never, pointer as never, {} as never),
    ).toThrow(/groupId/)
  })
})
