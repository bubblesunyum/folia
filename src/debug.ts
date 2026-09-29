import { parseRenderConfig } from './perf/renderConfig'

const params = new URLSearchParams(window.location.search)

/** How to render, from `?perf=` and `?aa=`. */
export const renderConfig = parseRenderConfig(window.location.search)

/**
 * Dev tooling is on in dev builds, and on demand in production with `?hud` or
 * `?panel`; `?perf=base` brings the HUD too, since it's there to be read.
 */
export const debug = {
  hud: import.meta.env.DEV || params.has('hud') || renderConfig.budget,
  panel: import.meta.env.DEV || params.has('panel'),
}
