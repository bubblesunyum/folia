import { expect, type Page, test } from '@playwright/test'
import { canvasHookAttribute } from '../src/testHooks'
import { COUNT_DRAWS, drawCalls, waitForTownDrawn } from './helpers'

// fol-kes.11: the render-on-demand guard (D-056). Nothing may invalidate on
// its own at rest. With ?sway=off the ambient scheduler has no consumer, so
// the scene must draw nothing at all; on the default path every draw must be
// explained by an ambient frame. A stray invalidate loop breaks both.

const REST_MS = 2_000
const ASSETS = 'cortico/forum,cortico/fragment,cortico/meadow'

async function ambientFrames(page: Page): Promise<number> {
  const value = await page
    .locator('canvas[data-assets="drawn"]')
    .getAttribute(canvasHookAttribute('ambientFrames'))
  return value === null ? 0 : Number(value)
}

/** Draw calls once nothing but the intro frames are left: two equal reads a
 * beat apart, so the measured window starts from true rest (or ambient). */
async function settledDraws(page: Page, intervalMs: number): Promise<void> {
  let previous = -1
  await expect
    .poll(
      async () => {
        const current = await drawCalls(page)
        const quiet = current === previous
        previous = current
        return quiet
      },
      { intervals: [intervalMs], timeout: 30_000 },
    )
    .toBe(true)
}

test('?sway=off rests: zero draw calls over the rest window', async ({ page }) => {
  test.slow()
  await page.addInitScript(COUNT_DRAWS)
  await page.goto('/?time=18:30&sway=off&reflection=off')
  await waitForTownDrawn(page, ASSETS)
  await settledDraws(page, 1_000)

  const before = await drawCalls(page)
  expect(before).toBeGreaterThan(0)
  await page.waitForTimeout(REST_MS)
  expect(await drawCalls(page)).toBe(before)
})

// Measured ~34 draws per rendered frame on the town (SwiftShader, 2026-10-04);
// the bound is deliberately above that so a new pass is not a false alarm.
const MAX_DRAWS_PER_FRAME = 80

test('the default path bounds draws by ambient frames', async ({ page }) => {
  test.slow()
  await page.addInitScript(COUNT_DRAWS)
  await page.goto('/?time=18:30')
  await waitForTownDrawn(page, ASSETS)
  await expect.poll(() => ambientFrames(page), { timeout: 30_000 }).toBeGreaterThan(2)

  const drawsBefore = await drawCalls(page)
  const framesBefore = await ambientFrames(page)
  await page.waitForTimeout(REST_MS)
  const draws = (await drawCalls(page)) - drawsBefore
  const frames = (await ambientFrames(page)) - framesBefore
  expect(frames).toBeGreaterThan(0)
  // Ambient ticks are the only thing allowed to ask for a frame at rest; a
  // tick can render late, so one frame of slack on the window edge.
  expect(draws).toBeLessThanOrEqual((frames + 1) * MAX_DRAWS_PER_FRAME)
})

test('the default path rests too once ambient motion is paused', async ({ page }) => {
  test.slow()
  await page.addInitScript(COUNT_DRAWS)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?time=18:30')
  await waitForTownDrawn(page, ASSETS)
  await settledDraws(page, 1_000)

  const before = await drawCalls(page)
  expect(before).toBeGreaterThan(0)
  await page.waitForTimeout(REST_MS)
  expect(await drawCalls(page)).toBe(before)
})
