import { describe, expect, it, vi } from 'vitest'
import { createSubscribeStore } from './subscribe'

describe('createSubscribeStore', () => {
  it('reads the initial value', () => {
    expect(createSubscribeStore<string | null>(null).get()).toBeNull()
  })

  it('fans out to listeners on change', () => {
    const store = createSubscribeStore(0)
    const seen: number[] = []
    store.on((v) => seen.push(v))
    store.set(1)
    store.set(2)
    expect(seen).toEqual([1, 2])
    expect(store.get()).toBe(2)
  })

  it('dedupes equal values', () => {
    const store = createSubscribeStore('a')
    const listener = vi.fn()
    store.on(listener)
    store.set('a')
    expect(listener).not.toHaveBeenCalled()
  })

  it('unsubscribes', () => {
    const store = createSubscribeStore(0)
    const listener = vi.fn()
    const off = store.on(listener)
    off()
    store.set(1)
    expect(listener).not.toHaveBeenCalled()
  })
})
