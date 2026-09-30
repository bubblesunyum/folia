import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AMBIENT_INTERVAL_MS,
  AmbientScheduler,
  isAmbientReading,
  setAmbientReading,
} from './ambient'

const LIVE = { visible: true, reading: false }

function registered(scheduler = new AmbientScheduler()) {
  const seen: number[] = []
  const events: string[] = []
  scheduler.register('sway', {
    update: (t) => seen.push(t),
    claim: () => events.push('claim'),
    release: () => events.push('release'),
  })
  return { scheduler, seen, events }
}

describe('ambient scheduler', () => {
  it('claims on register and releases on unregister', () => {
    const { scheduler, events } = registered()
    expect(events).toEqual(['claim'])
    scheduler.unregister('sway')
    expect(events).toEqual(['claim', 'release'])
  })

  it('throws on a duplicate registration (fail closed)', () => {
    const { scheduler } = registered()
    expect(() => scheduler.register('sway', { update: () => {} })).toThrow(
      'ambient consumer "sway" is already registered',
    )
  })

  it('ignores unregistering an unknown id', () => {
    const { scheduler, events } = registered()
    scheduler.unregister('ripple')
    expect(events).toEqual(['claim'])
  })

  it('emits immediately on the first tick, then holds the ~30 Hz cadence', () => {
    const { scheduler, seen } = registered()
    expect(scheduler.tick(0, LIVE)).toBe(true)
    expect(seen).toEqual([0])
    expect(scheduler.tick(10, LIVE)).toBe(false)
    expect(scheduler.tick(AMBIENT_INTERVAL_MS - 1, LIVE)).toBe(false)
    expect(scheduler.tick(AMBIENT_INTERVAL_MS, LIVE)).toBe(true)
    expect(seen).toHaveLength(2)
    expect(seen[1]).toBeCloseTo(AMBIENT_INTERVAL_MS / 1000, 6)
    expect(scheduler.time).toBeCloseTo(AMBIENT_INTERVAL_MS / 1000, 6)
  })

  it('holds the cadence no matter which source drives the frames', () => {
    const { scheduler, seen } = registered()
    scheduler.tick(0, LIVE)
    // A burst of frames right after the prime tick stays held…
    expect(scheduler.tick(5, LIVE)).toBe(false)
    // …but once a full interval has passed, any frame emits: interaction
    // frames fold into the same clock instead of running their own loop.
    expect(scheduler.tick(AMBIENT_INTERVAL_MS + 5, LIVE)).toBe(true)
    expect(seen).toHaveLength(2)
  })

  it('pauses while hidden and resumes the phase instead of jumping', () => {
    const { scheduler, seen } = registered()
    scheduler.tick(1000, LIVE)
    expect(scheduler.tick(2000, { visible: false, reading: false })).toBe(false)
    expect(scheduler.tick(9000, { visible: false, reading: false })).toBe(false)
    const before = scheduler.time
    expect(scheduler.tick(9000, LIVE)).toBe(false)
    expect(scheduler.time).toBe(before)
    const emitAt = 9000 + AMBIENT_INTERVAL_MS + 5
    expect(scheduler.tick(emitAt, LIVE)).toBe(true)
    expect(scheduler.time - before).toBeCloseTo((emitAt - 9000) / 1000, 9)
    expect(seen.at(-1)).toBe(scheduler.time)
  })

  it('pauses while a panel is being read', () => {
    const { scheduler, seen } = registered()
    scheduler.tick(0, LIVE)
    expect(scheduler.tick(1000, { visible: true, reading: true })).toBe(false)
    expect(seen).toHaveLength(1)
    const emitAt = 1000 + AMBIENT_INTERVAL_MS + 5
    expect(scheduler.tick(emitAt, LIVE)).toBe(true)
    expect(seen).toHaveLength(2)
  })

  it('never ticks with zero consumers, so idle scenes rest', () => {
    const scheduler = new AmbientScheduler()
    expect(scheduler.tick(0, LIVE)).toBe(false)
    expect(scheduler.tick(10_000, LIVE)).toBe(false)
    expect(scheduler.time).toBe(0)
  })

  it('fans the shared time out to every registered consumer', () => {
    const scheduler = new AmbientScheduler()
    const seen = new Map<string, number[]>()
    for (const id of ['sway', 'ripple', 'birds']) {
      const times: number[] = []
      seen.set(id, times)
      scheduler.register(id, { update: (t) => times.push(t) })
    }
    scheduler.tick(0, LIVE)
    scheduler.tick(AMBIENT_INTERVAL_MS, LIVE)
    for (const times of seen.values()) {
      expect(times).toHaveLength(2)
      expect(times[0]).toBe(0)
      expect(times[1]).toBeCloseTo(AMBIENT_INTERVAL_MS / 1000, 6)
    }
    expect(scheduler.consumerCount).toBe(3)
    scheduler.unregister('birds')
    expect(scheduler.consumerCount).toBe(2)
  })

  it('rebases without advancing time', () => {
    const { scheduler } = registered()
    scheduler.tick(0, LIVE)
    scheduler.rebase(5000)
    expect(scheduler.time).toBe(0)
    const emitAt = 5000 + AMBIENT_INTERVAL_MS + 5
    expect(scheduler.tick(emitAt, LIVE)).toBe(true)
    expect(scheduler.time).toBeCloseTo((emitAt - 5000) / 1000, 9)
  })
})

describe('ambient reading flag', () => {
  beforeEach(() => setAmbientReading(false))

  it('defaults to false and round-trips', () => {
    expect(isAmbientReading()).toBe(false)
    setAmbientReading(true)
    expect(isAmbientReading()).toBe(true)
  })

  it('is a plain module flag the wiring reads each tick', () => {
    const read = vi.fn(() => ({ visible: true, reading: isAmbientReading() }))
    const { scheduler } = registered()
    setAmbientReading(true)
    expect(scheduler.tick(1000, read())).toBe(false)
    setAmbientReading(false)
    expect(scheduler.tick(1000, read())).toBe(true)
  })
})
