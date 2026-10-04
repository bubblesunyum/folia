import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AMBIENT_INTERVAL_MS,
  AmbientScheduler,
  bindAmbientReadingSignal,
  isAmbientReading,
  isReadingTarget,
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
    // Accept within half interval (~16.6 ms tolerance) for early ticks
    const earlyFire = AMBIENT_INTERVAL_MS - 1
    expect(scheduler.tick(earlyFire, LIVE)).toBe(true)
    expect(seen).toHaveLength(2)
    // Time advances on the interval grid, not by the jittered fire time
    expect(seen[1]).toBeCloseTo(AMBIENT_INTERVAL_MS / 1000, 6)
    expect(scheduler.tick(2 * AMBIENT_INTERVAL_MS + 1, LIVE)).toBe(true)
    expect(seen[2]).toBeCloseTo((2 * AMBIENT_INTERVAL_MS) / 1000, 6)
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
    expect(scheduler.time - before).toBeCloseTo(AMBIENT_INTERVAL_MS / 1000, 9)
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

  it('freezes for an open panel or reduced motion and resumes from the same phase', () => {
    const { scheduler, seen } = registered()
    scheduler.tick(0, LIVE)
    scheduler.tick(1000, { ...LIVE, panelOpen: true })
    scheduler.tick(2000, { ...LIVE, reducedMotion: true })
    expect(scheduler.time).toBe(0)
    expect(seen).toEqual([0])
    expect(scheduler.tick(2000, LIVE)).toBe(false)
    expect(scheduler.tick(2001 + AMBIENT_INTERVAL_MS, LIVE)).toBe(true)
    expect(scheduler.time).toBeCloseTo(AMBIENT_INTERVAL_MS / 1000, 6)
  })

  it('emits about thirty ticks a second on integer-millisecond browser timers', () => {
    const { scheduler, seen } = registered()
    scheduler.tick(0, LIVE)
    const interval = Math.ceil(AMBIENT_INTERVAL_MS)
    for (let now = interval; now <= 1000; now += interval) scheduler.tick(now, LIVE)
    expect(seen).toHaveLength(30)
  })

  it('holds ~30 Hz with jittered fake clock (fires within half interval accepted)', () => {
    const { scheduler, seen } = registered()
    const CEIL_INTERVAL = Math.ceil(AMBIENT_INTERVAL_MS)
    let now = 0

    expect(scheduler.tick(now, LIVE)).toBe(true)
    expect(seen).toHaveLength(1)

    let fires = 0
    const startTime = now
    while (now < startTime + 1000) {
      const jitter = fires % 3 === 0 ? -1 : fires % 3 === 1 ? 1 : 0
      now += CEIL_INTERVAL + jitter
      if (scheduler.tick(now, LIVE)) {
        fires++
      }
    }

    const effectiveHz = (seen.length - 1) * (1000 / (now - startTime))
    expect(seen.length).toBeGreaterThanOrEqual(29)
    expect(seen.length).toBeLessThanOrEqual(31)
    expect(effectiveHz).toBeGreaterThan(28)
  })

  it('resyncs after a stall instead of bursting catch-up ticks', () => {
    const { scheduler, seen } = registered()
    scheduler.tick(0, LIVE)
    expect(scheduler.tick(1000, LIVE)).toBe(true)
    expect(scheduler.time).toBeCloseTo(1, 6)
    expect(scheduler.tick(1001, LIVE)).toBe(false)
    expect(scheduler.tick(1000 + AMBIENT_INTERVAL_MS, LIVE)).toBe(true)
    expect(seen).toHaveLength(3)
  })

  it('starts a fresh deterministic phase after the last consumer leaves', () => {
    const { scheduler, seen } = registered()
    scheduler.tick(0, LIVE)
    scheduler.tick(1000, LIVE)
    expect(scheduler.time).toBe(1)
    scheduler.unregister('sway')
    scheduler.register('sway', { update: (time) => seen.push(time) })
    expect(scheduler.time).toBe(0)
    scheduler.tick(50_000, LIVE)
    expect(seen.at(-1)).toBe(0)
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
    expect(scheduler.time).toBeCloseTo(AMBIENT_INTERVAL_MS / 1000, 9)
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

describe('ambient reading signal', () => {
  beforeEach(() => setAmbientReading(false))

  it('reads panel targets, and nothing else, as reading', () => {
    // Generic fakes on purpose: the test pins the behavior (inside the
    // bench reads as reading), not which selector recognizes the bench.
    const inPanel = { closest: () => ({}) }
    const outside = { closest: () => null }
    expect(isReadingTarget(inPanel as unknown as EventTarget)).toBe(true)
    expect(isReadingTarget(outside as unknown as EventTarget)).toBe(false)
    expect(isReadingTarget(null)).toBe(false)
    // Non-element targets (window, text nodes) never count as the panel.
    expect(isReadingTarget({} as unknown as EventTarget)).toBe(false)
  })

  /** Minimal document double: add/remove listeners plus a manual emit. */
  function fakeDocument() {
    const handlers = new Map<string, Array<(event: { target: unknown }) => void>>()
    return {
      added: handlers,
      emit(type: string, target: unknown) {
        for (const handler of handlers.get(type) ?? []) handler({ target })
      },
      asDocument(): Document {
        return {
          addEventListener: (type: string, handler: (event: never) => void) => {
            const list = handlers.get(type) ?? []
            list.push(handler as (event: { target: unknown }) => void)
            handlers.set(type, list)
          },
          removeEventListener: (type: string, handler: (event: never) => void) => {
            handlers.set(
              type,
              (handlers.get(type) ?? []).filter((h) => h !== (handler as unknown)),
            )
          },
        } as unknown as Document
      },
    }
  }

  it('pauses the clock while the pointer is over the panel, resumes after', () => {
    const doc = fakeDocument()
    const cleanup = bindAmbientReadingSignal(doc.asDocument())
    const inPanel = { closest: () => ({}) }
    const canvas = { closest: () => null }
    const { scheduler, seen } = registered()

    scheduler.tick(0, { visible: true, reading: isAmbientReading() })
    doc.emit('pointerover', inPanel)
    expect(isAmbientReading()).toBe(true)
    expect(scheduler.tick(1000, { visible: true, reading: isAmbientReading() })).toBe(false)
    expect(seen).toHaveLength(1)

    doc.emit('pointerover', canvas)
    expect(isAmbientReading()).toBe(false)
    expect(
      scheduler.tick(1000 + AMBIENT_INTERVAL_MS + 5, {
        visible: true,
        reading: isAmbientReading(),
      }),
    ).toBe(true)
    expect(seen).toHaveLength(2)
    cleanup()
  })

  it('tracks focus moving into and out of the panel', () => {
    const doc = fakeDocument()
    const cleanup = bindAmbientReadingSignal(doc.asDocument())
    const inPanel = { closest: () => ({}) }
    doc.emit('focusin', inPanel)
    expect(isAmbientReading()).toBe(true)
    doc.emit('focusout', inPanel)
    expect(isAmbientReading()).toBe(false)
    cleanup()
  })

  it('holds reading when the pointer leaves while focus stays inside', () => {
    const doc = fakeDocument()
    const cleanup = bindAmbientReadingSignal(doc.asDocument())
    const inPanel = { closest: () => ({}) }
    const canvas = { closest: () => null }
    doc.emit('focusin', inPanel)
    expect(isAmbientReading()).toBe(true)
    // The pointer moving off onto the canvas must not clear the focus latch.
    doc.emit('pointerover', canvas)
    expect(isAmbientReading()).toBe(true)
    // Focus leaving too clears the last latch.
    doc.emit('focusout', inPanel)
    expect(isAmbientReading()).toBe(false)
    cleanup()
  })

  it('holds reading when focus leaves while the pointer stays over the panel', () => {
    const doc = fakeDocument()
    const cleanup = bindAmbientReadingSignal(doc.asDocument())
    const inPanel = { closest: () => ({}) }
    const canvas = { closest: () => null }
    doc.emit('pointerover', inPanel)
    expect(isAmbientReading()).toBe(true)
    // Focus moving out must not clear the pointer latch.
    doc.emit('focusout', inPanel)
    expect(isAmbientReading()).toBe(true)
    // The pointer leaving too clears the last latch.
    doc.emit('pointerover', canvas)
    expect(isAmbientReading()).toBe(false)
    cleanup()
  })

  it('cleanup detaches and clears both latches', () => {
    const doc = fakeDocument()
    const cleanup = bindAmbientReadingSignal(doc.asDocument())
    doc.emit('pointerover', { closest: () => ({}) })
    doc.emit('focusin', { closest: () => ({}) })
    expect(isAmbientReading()).toBe(true)
    cleanup()
    expect(isAmbientReading()).toBe(false)
    expect([...doc.added.values()].every((list) => list.length === 0)).toBe(true)
  })
})
