import { expect, type Page, test } from '@playwright/test'
import { canvasHookAttribute } from '../src/testHooks'
import { expectNoErrors, trackErrors, waitForTownDrawn } from './helpers'

// fol-p8k: the open panel must rest like the look-dev scene does (D-056).
// The wisp's perch bob used to invalidate every frame, so the longest dwell
// state rendered at display rate. Open the platform case, wait for every
// arrival ease to land, then prove zero new WebGL draw calls over the rest
// window. Uses /cortico/ with the trailing slash (preview rewrites it).

const ASSETS = 'cortico/forum,cortico/fragment,cortico/meadow'

function drawCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { foliaDrawCalls: number }).foliaDrawCalls)
}

test('the open panel rests: zero draw calls after arrival', async ({ page }) => {
  test.slow()
  const errors = trackErrors(page)
  await page.addInitScript(`
    window.foliaDrawCalls = 0
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const original = WebGL2RenderingContext.prototype[name]
      WebGL2RenderingContext.prototype[name] = function (...args) {
        window.foliaDrawCalls += 1
        return original.apply(this, args)
      }
    }
  `)
  await page.goto('/cortico/platform/?time=18:30')
  await waitForTownDrawn(page, ASSETS)
  await expect(page.getByTestId('case-panel')).toBeVisible({ timeout: 15_000 })

  // Arrival, on state: the rig reports the case at once, focus lands once
  // the camera ease does. The wisp ease runs faster than the focus ease on
  // the same frames, so focus landing means the wisp has perched too.
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute(canvasHookAttribute('panel'), 'platform', {
    timeout: 15_000,
  })
  await expect(canvas).toHaveAttribute(canvasHookAttribute('focus'), 'platform', {
    timeout: 30_000,
  })

  // Stragglers (offset, dolly) settle on the same demand frames: poll for a
  // quiet second rather than a fixed wall time, so slow renderers still
  // measure true rest. At display rate this never goes quiet and fails here.
  let previous = await drawCalls(page)
  expect(previous).toBeGreaterThan(0)
  let quietSince = 0
  const deadline = Date.now() + 30_000
  for (;;) {
    await page.waitForTimeout(500)
    const current = await drawCalls(page)
    if (current === previous) {
      quietSince += 500
      if (quietSince >= 1000) break
    } else {
      previous = current
      quietSince = 0
    }
    if (Date.now() > deadline) {
      throw new Error(`panel never rested: still drawing 30s after focus landed (${current} calls)`)
    }
  }

  // The D-056 rest window: zero new draws while the panel stays open.
  const resting = await drawCalls(page)
  await page.waitForTimeout(500)
  expect(await drawCalls(page)).toBe(resting)

  expectNoErrors(errors)
})
