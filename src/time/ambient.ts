/**
 * The ambient-motion scheduler (D-056, fol-s6f): the one clock that owns the
 * shader time uniforms. Sway used to invalidate every frame at display rate;
 * ripple, birds and clouds are next, so consumers register here instead of
 * each running their own loop.
 *
 * Cadence: about 30 Hz at rest, higher only during interaction (frames caused
 * by anything else also tick the clock, so motion stays smooth while
 * orbiting). Paused while the tab is hidden or a panel is being read, and
 * idle with zero consumers it never ticks, so the e2e rest test still sees
 * zero draw calls. Time freezes while paused rather than jumping on resume.
 *
 * Pure core: this module takes an explicit `nowMs` and explicit signals, so
 * tests drive it with fake clocks. The R3F component (`scene/Sway`) only
 * wires `performance.now`, `document.visibilityState` and `invalidate`.
 */

/** Rest cadence: ~30 Hz (D-056). */
export const AMBIENT_INTERVAL_MS = 1000 / 30

/** A future animated thing: ripple, birds, clouds, and sway today. */
export interface AmbientConsumer {
  /** Receives the shared shader time, in seconds. */
  update: (timeSeconds: number) => void
  /** Claims the consumer's live uniform values on register (inert defaults trap). */
  claim?: () => void
  /** Hands the uniforms back to their inert defaults on unregister. */
  release?: () => void
}

export interface AmbientSignals {
  /** `document.visibilityState === 'visible'`, read by the wiring each tick. */
  visible: boolean
  /** A look-dev panel is being read; set via `setAmbientReading`. */
  reading: boolean
}

export class AmbientScheduler {
  private readonly consumers = new Map<string, AmbientConsumer>()
  private lastTickMs = 0
  private elapsedSeconds = 0
  private primed = false

  constructor(readonly intervalMs: number = AMBIENT_INTERVAL_MS) {}

  get consumerCount(): number {
    return this.consumers.size
  }

  /** The shared shader time, in seconds. Only advances on emitted ticks. */
  get time(): number {
    return this.elapsedSeconds
  }

  register(id: string, consumer: AmbientConsumer): void {
    if (this.consumers.has(id)) throw new Error(`ambient consumer "${id}" is already registered`)
    this.consumers.set(id, consumer)
    consumer.claim?.()
  }

  unregister(id: string): void {
    const consumer = this.consumers.get(id)
    if (!consumer) return
    this.consumers.delete(id)
    consumer.release?.()
  }

  /** Re-baselines the cadence without advancing time; the wiring calls this on resume. */
  rebase(nowMs: number): void {
    this.lastTickMs = nowMs
  }

  /**
   * Advances the clock and pushes the time to consumers when a frame is due.
   * Returns true when uniforms were written, i.e. the caller must invalidate.
   */
  tick(nowMs: number, signals: AmbientSignals): boolean {
    if (this.consumers.size === 0 || !signals.visible || signals.reading) {
      // Frozen, not stopped: keep the baseline fresh so resume continues the
      // phase instead of jumping by the paused duration.
      this.lastTickMs = nowMs
      return false
    }
    if (!this.primed) {
      this.primed = true
      this.lastTickMs = nowMs
      this.push()
      return true
    }
    const dtMs = nowMs - this.lastTickMs
    if (dtMs < 0) {
      this.lastTickMs = nowMs
      return false
    }
    if (dtMs < this.intervalMs) return false
    this.elapsedSeconds += dtMs / 1000
    this.lastTickMs = nowMs
    this.push()
    return true
  }

  private push(): void {
    for (const consumer of this.consumers.values()) consumer.update(this.elapsedSeconds)
  }
}

/** The one clock, shared by every ambient consumer in the canvas. */
export const ambient = new AmbientScheduler()

let reading = false

/** Marks a look-dev panel as being read, which pauses ambient motion (D-056). */
export function setAmbientReading(value: boolean): void {
  reading = value
}

export function isAmbientReading(): boolean {
  return reading
}

/**
 * The look-dev bench's own DOM hook (fol-k0t, D-034): the app marks its bench
 * wrapper with this attribute, so recognizing "the panel being read" doesn't
 * depend on any panel library's internals. Kept as a pure target check so
 * unit tests can drive it without mounting the panel.
 *
 * Leva coupling + tweakpane migration obligation: leva portals its panel
 * into a body-level `#leva__root` that our JSX cannot wrap (the installed
 * leva bundle appends `#leva__root` to `document.body`), so the `#leva__root`
 * half of the selector below exists only for the portaled leva panel. When
 * the bench moves to tweakpane (D-034 allows leva or tweakpane), render its
 * container inside the `data-lookdev-bench` wrapper and delete the
 * `#leva__root` half.
 */
export const BENCH_ROOT_ATTRIBUTE = 'data-lookdev-bench'
export const PANEL_ROOT_SELECTOR = `[${BENCH_ROOT_ATTRIBUTE}], #leva__root`

export function isReadingTarget(target: EventTarget | null): boolean {
  // Duck-typed on `closest` rather than `instanceof Element`, so non-element
  // targets (and non-DOM test fakes) read as "not the panel" instead of
  // throwing on a missing global.
  if (!target || typeof (target as Element).closest !== 'function') return false
  return (target as Element).closest(PANEL_ROOT_SELECTOR) !== null
}

/**
 * Wires the look-dev panel's read state into the ambient flag (fol-k0t): the
 * pointer resting over the bench, or focus moving into it, pauses ambient
 * motion; leaving clears it. Listens on the document so the lazily-mounted
 * leva root needs no direct handle. Returns a cleanup that detaches and
 * clears both latches; the scheduler keeps honoring `isAmbientReading` per
 * tick.
 */
export function bindAmbientReadingSignal(doc: Document = document): () => void {
  // One latch per signal, ORed together: pointer and focus move
  // independently, so a single last-writer-wins flag drops reading when one
  // signal leaves while the other is still inside the panel (focus in-panel
  // + pointerover canvas, or pointer over the panel + focusout).
  let pointerInside = false
  let focusInside = false
  const sync = (): void => setAmbientReading(pointerInside || focusInside)
  const onPointerOver = (event: Event): void => {
    pointerInside = isReadingTarget(event.target)
    sync()
  }
  const onFocusIn = (event: Event): void => {
    if (isReadingTarget(event.target)) {
      focusInside = true
      sync()
    }
  }
  const onFocusOut = (event: Event): void => {
    if (isReadingTarget(event.target)) {
      focusInside = false
      sync()
    }
  }
  doc.addEventListener('pointerover', onPointerOver)
  doc.addEventListener('focusin', onFocusIn)
  doc.addEventListener('focusout', onFocusOut)
  return () => {
    doc.removeEventListener('pointerover', onPointerOver)
    doc.removeEventListener('focusin', onFocusIn)
    doc.removeEventListener('focusout', onFocusOut)
    pointerInside = false
    focusInside = false
    setAmbientReading(false)
  }
}
