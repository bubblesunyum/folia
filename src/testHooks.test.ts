import { describe, expect, test } from 'vitest'
import { type DatasetHost, setCanvasHook } from './testHooks'

// fol-o3v: per-frame rigs call setCanvasHook every frame, so the helper must
// short-circuit identical values — otherwise rest frames pay a DOM write
// each and the demand loop never looks settled (D-056).

/** A host that counts underlying dataset writes (the DOM-write proxy). */
function countingHost(): { host: DatasetHost; writes: () => number } {
  let count = 0
  const store: Record<string, string | undefined> = {}
  const dataset = new Proxy(store, {
    set(target, prop: string, value: string): boolean {
      count += 1
      return Reflect.set(target, prop, value)
    },
  })
  return { host: { dataset }, writes: () => count }
}

describe('setCanvasHook', () => {
  test('rewrites only on change', () => {
    const { host, writes } = countingHost()
    setCanvasHook(host, 'hoverSettled', '')
    expect(writes()).toBe(1)
    // Rest frames repeat the same value: no further DOM writes.
    setCanvasHook(host, 'hoverSettled', '')
    setCanvasHook(host, 'hoverSettled', '')
    expect(writes()).toBe(1)
    // A real change still lands.
    setCanvasHook(host, 'hoverSettled', 'true')
    expect(writes()).toBe(2)
    setCanvasHook(host, 'hoverSettled', 'true')
    expect(writes()).toBe(2)
    expect(host.dataset.hoverSettled).toBe('true')
  })

  test('tracks hooks independently', () => {
    const { host, writes } = countingHost()
    setCanvasHook(host, 'hover', '9')
    setCanvasHook(host, 'lifted', '9')
    expect(writes()).toBe(2)
    setCanvasHook(host, 'hover', '9')
    setCanvasHook(host, 'lifted', '')
    expect(writes()).toBe(3)
    expect(host.dataset.lifted).toBe('')
  })
})
