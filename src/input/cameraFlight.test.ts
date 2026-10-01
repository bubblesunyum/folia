import { describe, expect, it } from 'vitest'
import { beginCameraFlight, currentCameraFlight } from './cameraFlight'

describe('cameraFlight', () => {
  it('bumps the generation on claim', () => {
    const before = currentCameraFlight()
    const claimed = beginCameraFlight()
    expect(claimed).toBe(before + 1)
    expect(currentCameraFlight()).toBe(claimed)
  })
})
