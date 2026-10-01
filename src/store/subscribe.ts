// A tiny subscribe store (fol-8z6): module state, `on` returns the
// unsubscribe. DOM-free and three-free, so route components, canvas rigs and
// Vitest share it without pulling the other graph in (D-047).

export interface SubscribeStore<T> {
  get: () => T
  set: (value: T) => void
  on: (listener: (value: T) => void) => () => void
}

/** A deduping fan-out store: equal values never notify, listeners copy on fan-out. */
export function createSubscribeStore<T>(initial: T): SubscribeStore<T> {
  let current = initial
  const listeners = new Set<(value: T) => void>()
  return {
    get: () => current,
    set: (value: T) => {
      if (value === current) return
      current = value
      for (const listener of [...listeners]) listener(current)
    },
    on: (listener: (value: T) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
