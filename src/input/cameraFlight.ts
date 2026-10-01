// Camera-flight coordination (fol-bsw): whoever drives the camera bumps the
// generation, and tween owners yield when it moves under them. The panel
// vantage dolly (PanelCameraRig) and user zoom (ZoomRig) share one camera
// with no other channel between them; without this a panel dolly and a zoom
// tween would write the camera on alternate frames. Pure and three-free.

let flight = 0

/** Claim the camera: cancels in-flight tweens owned by others. */
export function beginCameraFlight(): number {
  flight += 1
  return flight
}

/** The current generation; tween owners compare against their start. */
export function currentCameraFlight(): number {
  return flight
}
