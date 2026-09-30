import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type EscapeSnapshot,
  FOCUS_LIFT_EVENT,
  isDismissKey,
  isPanelOpen,
  onPanelOpen,
  PANEL_CLOSE_EVENT,
  panelCloseDetail,
  readReducedMotion,
  requestPanelClose,
  resolveEscape,
  setPanelOpen,
  signalFocusLift,
} from './intent'

const snapshot = (overrides: Partial<EscapeSnapshot>): EscapeSnapshot => ({
  panelOpen: false,
  focusInEditable: false,
  canRise: true,
  reducedMotion: false,
  ...overrides,
})

describe('resolveEscape', () => {
  it('rises when no panel is open and focus is in the world', () => {
    expect(resolveEscape(snapshot({}))).toEqual({ action: 'rise-level', reducedMotion: false })
  })

  it('closes the panel instead of rising when one is open', () => {
    expect(resolveEscape(snapshot({ panelOpen: true }))).toEqual({
      action: 'close-panel',
      reducedMotion: false,
    })
  })

  it('never hijacks typing: focused input wins over an open panel', () => {
    expect(resolveEscape(snapshot({ panelOpen: true, focusInEditable: true }))).toEqual({
      action: 'noop',
      reducedMotion: false,
    })
  })

  it('is a noop when focus is in an input and no panel is open', () => {
    expect(resolveEscape(snapshot({ focusInEditable: true }))).toEqual({
      action: 'noop',
      reducedMotion: false,
    })
  })

  it('is a noop at the top level when there is nowhere to rise to', () => {
    expect(resolveEscape(snapshot({ canRise: false }))).toEqual({
      action: 'noop',
      reducedMotion: false,
    })
  })

  it('an open panel still closes at the top level: panel beats place depth', () => {
    expect(resolveEscape(snapshot({ panelOpen: true, canRise: false }))).toEqual({
      action: 'close-panel',
      reducedMotion: false,
    })
  })

  it('echoes the reduced-motion flag without consuming it', () => {
    expect(resolveEscape(snapshot({ reducedMotion: true }))).toEqual({
      action: 'rise-level',
      reducedMotion: true,
    })
    expect(resolveEscape(snapshot({ panelOpen: true, reducedMotion: true }))).toEqual({
      action: 'close-panel',
      reducedMotion: true,
    })
    expect(resolveEscape(snapshot({ focusInEditable: true, reducedMotion: true }))).toEqual({
      action: 'noop',
      reducedMotion: true,
    })
  })
})

describe('isDismissKey', () => {
  it('routes only Escape through the layer', () => {
    expect(isDismissKey('Escape')).toBe(true)
  })

  it('leaves Enter, Space and other keys untouched', () => {
    expect(isDismissKey('Enter')).toBe(false)
    expect(isDismissKey(' ')).toBe(false)
    expect(isDismissKey('Spacebar')).toBe(false)
    expect(isDismissKey('+')).toBe(false)
    expect(isDismissKey('a')).toBe(false)
  })
})

describe('panel store', () => {
  afterEach(() => {
    setPanelOpen(false)
  })

  it('defaults to closed: no panel exists yet, so Escape rises', () => {
    expect(isPanelOpen()).toBe(false)
    expect(resolveEscape(snapshot({ panelOpen: isPanelOpen() })).action).toBe('rise-level')
  })

  it('tracks registration until the panel closes', () => {
    setPanelOpen(true)
    expect(isPanelOpen()).toBe(true)
    expect(resolveEscape(snapshot({ panelOpen: isPanelOpen() })).action).toBe('close-panel')
    setPanelOpen(false)
    expect(isPanelOpen()).toBe(false)
  })

  it('fans out to listeners until they unsubscribe', () => {
    const seen: boolean[] = []
    const unsubscribe = onPanelOpen((open) => {
      seen.push(open)
    })
    setPanelOpen(true)
    unsubscribe()
    setPanelOpen(false)
    expect(seen).toEqual([true])
  })

  it('stays silent when the state does not change', () => {
    const seen: boolean[] = []
    const unsubscribe = onPanelOpen((open) => {
      seen.push(open)
    })
    setPanelOpen(false)
    expect(seen).toEqual([])
    unsubscribe()
  })
})

describe('readReducedMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads false outside the browser', () => {
    expect(readReducedMotion()).toBe(false)
  })

  it('passes the media query through when a window exists', () => {
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({ matches: query.includes('reduce'), media: query }),
    })
    expect(readReducedMotion()).toBe(true)
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false, media: '' }) })
    expect(readReducedMotion()).toBe(false)
  })
})

describe('intent events', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds the panel-close detail from the pass-through flag', () => {
    expect(panelCloseDetail(true)).toEqual({ reducedMotion: true })
    expect(panelCloseDetail(false)).toEqual({ reducedMotion: false })
  })

  it('dispatches panel-close and focus-lift on window', () => {
    const seen: CustomEvent[] = []
    vi.stubGlobal('window', {
      dispatchEvent: (event: Event) => {
        seen.push(event as CustomEvent)
        return true
      },
    })
    requestPanelClose(true)
    signalFocusLift('cortico-forum-2')
    expect(seen.map((event) => event.type)).toEqual([PANEL_CLOSE_EVENT, FOCUS_LIFT_EVENT])
    expect(seen[0]?.detail).toEqual({ reducedMotion: true })
    expect(seen[1]?.detail).toEqual({ targetId: 'cortico-forum-2' })
  })
})
