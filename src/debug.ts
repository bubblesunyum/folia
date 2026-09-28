const params = new URLSearchParams(window.location.search)

/** Dev tooling is on in dev builds, and on demand in production with `?hud` or `?panel`. */
export const debug = {
  hud: import.meta.env.DEV || params.has('hud'),
  panel: import.meta.env.DEV || params.has('panel'),
}
