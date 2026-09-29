import { ZOOM_IN_EVENT, ZOOM_OUT_EVENT } from '../input/sources'

/**
 * The visible zoom affordance (D-048): `+` / `-` keys and these buttons keep
 * mouse-wheel users from getting stuck until notch detection lands. They send
 * events the rig inside the canvas answers, so the one zoom model stays whole.
 */
export function ZoomButtons() {
  return (
    <div className="zoom-buttons">
      <button
        type="button"
        aria-label="Zoom in"
        onClick={() => window.dispatchEvent(new CustomEvent(ZOOM_IN_EVENT))}
      >
        +
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => window.dispatchEvent(new CustomEvent(ZOOM_OUT_EVENT))}
      >
        −
      </button>
    </div>
  )
}
