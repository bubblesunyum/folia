import { expect, type Page, test } from '@playwright/test'
import { PEDESTAL_ANCHOR_BY_SLUG } from '../src/panel/pedestals'
import {
  canvasHookAttribute,
  canvasHookSelector,
  type FoliaProjector,
  PROJECTOR_KEY,
  type WorldPoint,
} from '../src/testHooks'
import { expectNoErrors, trackErrors, waitForTownDrawn } from './helpers'

// The sheet variant contract (fol-8z6): metrics.ts `panelVariant` and the
// styles.css media query must agree, and the bottom sheet must hold at night.
// Captures land in /tmp/fol-panel-*.png.

const ASSETS = 'cortico/forum,cortico/fragment,cortico/meadow'

/** Canvas CSS pixels for a world position, projected by the app itself. */
function screenPoint(page: Page, world: WorldPoint): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([w, key]: [WorldPoint, string]) => {
      const project = (window as unknown as Record<string, FoliaProjector | undefined>)[key]
      if (!project) throw new Error(`${key} is not mounted yet`)
      return project(w)
    },
    [world, PROJECTOR_KEY] as [WorldPoint, string],
  )
}

async function openPlatform(page: Page): Promise<void> {
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute(canvasHookAttribute('viewOffset'), '', { timeout: 30_000 })
  const hovered = page.locator(canvasHookSelector('hover', '9'))
  const point = await screenPoint(page, PEDESTAL_ANCHOR_BY_SLUG.platform)
  await page.mouse.move(point.x, point.y)
  await expect(hovered).toBeVisible({ timeout: 15_000 })
  const fresh = await screenPoint(page, PEDESTAL_ANCHOR_BY_SLUG.platform)
  await page.mouse.move(fresh.x, fresh.y)
  await expect(hovered).toBeVisible({ timeout: 15_000 })
  await page.mouse.click(fresh.x, fresh.y)
  await expect(page).toHaveURL(/\/cortico\/platform\/?$/, { timeout: 15_000 })
  await expect(page.getByTestId('case-panel')).toBeVisible({ timeout: 15_000 })
}

test.describe('panel variant contract', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('bottom sheet holds at night', async ({ page }) => {
    test.slow()
    const errors = trackErrors(page)
    await page.goto('/cortico?time=22:00')
    await waitForTownDrawn(page, ASSETS)
    await openPlatform(page)
    await expect(page.getByTestId('case-panel')).toHaveAttribute('data-variant', 'bottom')
    const canvas = page.locator('canvas')
    await expect(canvas).toHaveAttribute(canvasHookAttribute('viewOffset'), '0,210', {
      timeout: 30_000,
    })
    await page.screenshot({ path: '/tmp/fol-panel-mobile-night.png' })
    expectNoErrors(errors)
  })
})

test.describe('breakpoint agreement', () => {
  test.use({ viewport: { width: 900, height: 700 } })
  test('TS variant and CSS dock agree at 900px', async ({ page }) => {
    test.slow()
    const errors = trackErrors(page)
    await page.goto('/cortico?time=18:30')
    await waitForTownDrawn(page, ASSETS)
    await openPlatform(page)
    // 900 >= PANEL_NARROW_PX: side sheet, and the CSS query
    // (max-width: 899px) must not dock it to the bottom.
    await expect(page.getByTestId('case-panel')).toHaveAttribute('data-variant', 'side')
    const canvas = page.locator('canvas')
    await expect(canvas).toHaveAttribute(canvasHookAttribute('viewOffset'), '203,0', {
      timeout: 30_000,
    })
    await page.screenshot({ path: '/tmp/fol-panel-900.png' })
    expectNoErrors(errors)
  })
})

test.describe('vantage dolly', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test('close mid-dolly restores the town distance', async ({ page }) => {
    test.slow()
    const errors = trackErrors(page)
    await page.goto('/cortico?time=18:30')
    await waitForTownDrawn(page, ASSETS)
    const canvas = page.locator('canvas')
    const zoomOf = (): Promise<number> =>
      canvas
        .getAttribute(canvasHookAttribute('zoom'))
        .then((v) => (v === null || v === '' ? Number.NaN : Number(v)))
    const townDistance = await zoomOf()
    expect(townDistance).toBeGreaterThan(70)
    await openPlatform(page)
    // Close before the ~80 m → 50 m dolly lands: a surviving restore proves
    // the user never drove, so the camera must fly home, not strand mid-way.
    await page.getByTestId('panel-close').click()
    await expect(page).toHaveURL(/\/cortico\/?(\?.*)?$/, { timeout: 15_000 })
    await expect.poll(zoomOf, { timeout: 30_000 }).toBeCloseTo(townDistance, 0)
    expectNoErrors(errors)
  })
})
