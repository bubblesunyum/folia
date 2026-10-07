import { expect, type Page, test } from '@playwright/test'
import { COUNT_DRAWS, drawCalls, expectNoErrors, trackErrors, waitForTownDrawn } from './helpers'

// fol-l7d.13: the town survives a WebGL context loss without a reload. The
// WEBGL_lose_context extension fires the real events three handles, so the
// Reconnecting overlay shows on loss and the restores count (the single redo
// signal for the env cube, the composer and the timer) rebuilds on restore.
const ASSETS = 'cortico/forum,cortico/fragment,cortico/meadow,town/skeleton'

/** Forwards the WEBGL_lose_context extension call to the page's canvas. */
async function loseContext(page: Page): Promise<void> {
  // The extension handle must be kept from before the loss: once the context
  // is lost, getExtension returns null and a fresh lookup silently no-ops,
  // so restore would never fire.
  await page.evaluate(() => {
    const ext = document
      .querySelector('canvas')
      ?.getContext('webgl2')
      ?.getExtension('WEBGL_lose_context')
    window.__loseContextExt = ext ?? undefined
    ext?.loseContext()
  })
}

/** The matching restore half, through the pre-loss extension handle. */
async function restoreContext(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__loseContextExt?.restoreContext()
  })
}

test('context loss shows Reconnecting, restore redraws without reload', async ({ page }) => {
  // Software rendering plus the startup tier probe run the restore redraws
  // and the capture past the default timeout.
  test.slow()
  await page.addInitScript(COUNT_DRAWS)
  const errors = trackErrors(page)
  await page.goto('/?time=18:30')
  await waitForTownDrawn(page, ASSETS)
  // A flag the extension round-trip can never survive: still set below, the
  // page never reloaded.
  await page.evaluate(() => {
    window.__contextLossNoReload = true
  })
  await expect(page.locator('.context-lost')).toBeHidden()

  await loseContext(page)
  await expect(page.locator('.context-lost')).toContainText('Reconnecting')

  const callsAtRestore = await drawCalls(page)
  await restoreContext(page)
  // The overlay clears, the redo signal bumps, and the town paints again.
  await expect(page.locator('.context-lost')).toBeHidden()
  await expect(page.locator('canvas[data-restores="1"]')).toBeVisible()
  await expect(page.locator('canvas[data-assets="drawn"]')).toBeVisible()
  await expect.poll(() => drawCalls(page), { timeout: 30_000 }).toBeGreaterThan(callsAtRestore)
  const reloaded = await page.evaluate(() => window.__contextLossNoReload !== true)
  expect(reloaded).toBe(false)
  // The look survives the restore: the golden-hour sun value never dropped.
  await expect(page.locator('canvas[data-sun]')).toBeVisible()
  await page.screenshot({ path: '/tmp/fol-context-loss.png' })
  expectNoErrors(errors)
})

declare global {
  interface Window {
    __contextLossNoReload?: boolean
    // WEBGL_lose_context handle kept across the loss (see loseContext above).
    __loseContextExt?: { loseContext(): void; restoreContext(): void }
  }
}
