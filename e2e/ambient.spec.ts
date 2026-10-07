import { expect, test } from '@playwright/test'
import { canvasHookAttribute } from '../src/testHooks'

const timeAttribute = canvasHookAttribute('ambientTime')

async function ambientTime(page: import('@playwright/test').Page): Promise<number> {
  const value = await page.locator('canvas[data-assets="drawn"]').getAttribute(timeAttribute)
  if (value === null) throw new Error('ambient clock has not reported its first tick')
  return Number(value)
}

async function ambientFrames(page: import('@playwright/test').Page): Promise<number> {
  const value = await page
    .locator('canvas[data-assets="drawn"]')
    .getAttribute('data-ambient-frames')
  if (value === null) throw new Error('ambient clock has not reported its first frame')
  return Number(value)
}

test('ambient motion runs at rest, pauses, and resumes without a time jump', async ({ page }) => {
  // Software rendering plus the startup tier probe run past the default
  // timeout; the windows themselves are milliseconds.
  test.slow()
  await page.goto('/?time=18:30')
  const canvas = page.locator('canvas[data-assets="drawn"]')
  await expect(canvas).toBeVisible({ timeout: 60_000 })
  // Startup first: the tier probe's frames stall the throttled ambient hooks,
  // so the movement window starts after it, not inside it.
  await expect(page.locator('canvas[data-tier-probe="done"]')).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => ambientTime(page), { timeout: 10_000 }).toBeGreaterThan(0.2)

  const beforeRest = await ambientTime(page)
  const beforeFrames = await ambientFrames(page)
  await page.waitForTimeout(800)
  const afterRest = await ambientTime(page)
  const afterFrames = await ambientFrames(page)
  expect(afterRest - beforeRest).toBeGreaterThan(0.45)
  expect(afterRest - beforeRest).toBeLessThan(1.2)
  // Software rendering can fall below the target; it must never exceed it.
  expect(afterFrames - beforeFrames).toBeGreaterThan(0)
  expect(afterFrames - beforeFrames).toBeLessThanOrEqual(
    Math.ceil((afterRest - beforeRest) * 30) + 2,
  )

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(500)
  const reduced = await ambientTime(page)
  const reducedFrames = await ambientFrames(page)
  await page.waitForTimeout(400)
  expect(await ambientTime(page)).toBe(reduced)
  expect(await ambientFrames(page)).toBe(reducedFrames)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect
    .poll(async () => (await ambientTime(page)) - reduced, { timeout: 5_000 })
    .toBeGreaterThan(0.2)

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(500)
  const hidden = await ambientTime(page)
  const hiddenFrames = await ambientFrames(page)
  await page.waitForTimeout(400)
  expect(await ambientTime(page)).toBe(hidden)
  expect(await ambientFrames(page)).toBe(hiddenFrames)

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect
    .poll(async () => (await ambientTime(page)) - hidden, { timeout: 5_000 })
    .toBeGreaterThan(0.2)
})

test('?sway=off holds the shared ambient clock still', async ({ page }) => {
  await page.goto('/?time=18:30&sway=off&reflection=off')
  const canvas = page.locator('canvas[data-assets="drawn"]')
  await expect(canvas).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(700)
  expect(await canvas.getAttribute(timeAttribute)).toBeNull()
})
