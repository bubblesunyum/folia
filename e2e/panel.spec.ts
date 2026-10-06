import { expect, type Page, test } from '@playwright/test'
import { PEDESTAL_ANCHOR_BY_SLUG } from '../src/panel/pedestals'
import {
  type CanvasHookName,
  canvasHookAttribute,
  canvasHookSelector,
  type FoliaProjector,
  PROJECTOR_KEY,
  type WorldPoint,
} from '../src/testHooks'
import { expectNoErrors, trackErrors, urlWithQuery, waitForTownDrawn } from './helpers'

// fol-l1r.5: pedestal hover/first-tap lifts+glows only that pedestal, and
// click/second-tap routes to /cortico/<slug> with the right-side panel,
// wisp, view offset and Close. Captures land in /tmp/fol-panel-*.png.

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

async function hoverSettled(page: Page): Promise<void> {
  await expect(page.locator(canvasHookSelector('hoverSettled', 'true'))).toBeVisible({
    timeout: 30_000,
  })
}

async function canvasAttr(page: Page, name: CanvasHookName): Promise<string | null> {
  return page.locator(canvasHookSelector(name)).getAttribute(canvasHookAttribute(name))
}

/** Moves the pointer onto a world point and waits for the hover to settle. */
async function hoverWorld(page: Page, world: WorldPoint): Promise<void> {
  const point = await screenPoint(page, world)
  await page.mouse.move(point.x, point.y)
  const canvas = page.locator(canvasHookSelector('hover'))
  await expect(canvas).not.toHaveAttribute(canvasHookAttribute('hover'), '', { timeout: 15_000 })
  await hoverSettled(page)
}

async function openPlatform(page: Page): Promise<void> {
  const canvas = page.locator('canvas')
  // A close eases the camera home and clears the offset: reopening mid-flight
  // would project against a moving camera, so wait out the reframe first.
  await expect(canvas).toHaveAttribute(canvasHookAttribute('viewOffset'), '', { timeout: 30_000 })
  const hovered = page.locator(canvasHookSelector('hover', '9'))
  const point = await screenPoint(page, PEDESTAL_ANCHOR_BY_SLUG.platform)
  await page.mouse.move(point.x, point.y)
  await expect(hovered).toBeVisible({ timeout: 15_000 })
  await hoverSettled(page)
  // Re-project against the now-still camera and click the fresh point.
  const fresh = await screenPoint(page, PEDESTAL_ANCHOR_BY_SLUG.platform)
  await page.mouse.move(fresh.x, fresh.y)
  await expect(hovered).toBeVisible({ timeout: 15_000 })
  await page.mouse.click(fresh.x, fresh.y)
  await expect(page).toHaveURL(urlWithQuery(/\/cortico\/platform\/?$/), { timeout: 15_000 })
  await expect(page.getByTestId('case-panel')).toBeVisible({ timeout: 15_000 })
}

test('pedestal hover lifts only that pedestal; focus lifts it too', async ({ page }) => {
  test.slow()
  const errors = trackErrors(page)
  await page.goto('/cortico?time=18:30')
  await waitForTownDrawn(page, ASSETS)

  // Keyboard focus on the case link drives the same lift as hover.
  await page.focus('a[data-pedestal="platform"]')
  await hoverSettled(page)
  expect(await canvasAttr(page, 'lifted')).toBe('9')
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await hoverSettled(page)
  expect(await canvasAttr(page, 'lifted')).toBe('')

  // Hovering the laptop pedestal lifts only slot 9.
  await hoverWorld(page, PEDESTAL_ANCHOR_BY_SLUG.platform)
  expect(await canvasAttr(page, 'hover')).toBe('9')
  expect(await canvasAttr(page, 'lifted')).toBe('9')

  // The meadow terrace (slot 6, lifts at town level) reports but never lifts
  // under /cortico: the filter, not the raycast, holds it down.
  await hoverWorld(page, [12.2, 1.0, -3.2])
  expect(await canvasAttr(page, 'hover')).toBe('6')
  expect(await canvasAttr(page, 'lifted')).toBe('')

  expectNoErrors(errors)
})

test('click opens the panel with the case content, offset and focus', async ({ page }) => {
  test.slow()
  const errors = trackErrors(page)
  await page.goto('/cortico?time=18:30')
  await waitForTownDrawn(page, ASSETS)

  await openPlatform(page)
  await expect(page.getByTestId('panel-breadcrumb')).toHaveText('cortico › platform')
  await expect(
    page.getByTestId('case-panel').getByRole('heading', { name: 'platform' }),
  ).toBeVisible()

  // The rig reports the open case at once; focus follows once the ease lands;
  // the 640px-capped sheet at 1440 wide offsets the view 320px left.
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute(canvasHookAttribute('panel'), 'platform', {
    timeout: 15_000,
  })
  await expect(canvas).toHaveAttribute(canvasHookAttribute('viewOffset'), '320,0', {
    timeout: 30_000,
  })
  await expect(canvas).toHaveAttribute(canvasHookAttribute('focus'), 'platform', {
    timeout: 30_000,
  })

  await page.screenshot({ path: '/tmp/fol-panel-golden.png' })
  expectNoErrors(errors)
})

test('Escape, Close and empty-click all close the panel', async ({ page }) => {
  test.slow()
  const errors = trackErrors(page)
  await page.goto('/cortico?time=18:30')
  await waitForTownDrawn(page, ASSETS)
  const panel = page.getByTestId('case-panel')
  const canvas = page.locator('canvas')

  await openPlatform(page)

  // Escape rises to the parent through the intent layer, never the ZoomRig.
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(urlWithQuery(/\/cortico\/?$/), { timeout: 15_000 })
  await expect(panel).toHaveCount(0)
  await expect(canvas).toHaveAttribute(canvasHookAttribute('panel'), '')

  // The one-word Close button.
  await openPlatform(page)
  await page.getByTestId('panel-close').click()
  await expect(page).toHaveURL(urlWithQuery(/\/cortico\/?$/), { timeout: 15_000 })
  await expect(panel).toHaveCount(0)

  // A clean miss over empty world (top-strip sky) closes too.
  await openPlatform(page)
  await page.mouse.click(720, 40)
  await expect(page).toHaveURL(urlWithQuery(/\/cortico\/?$/), { timeout: 15_000 })
  await expect(panel).toHaveCount(0)

  expectNoErrors(errors)
})

test('pedestal clicks swap the panel case-for-case without stacking history', async ({ page }) => {
  test.slow()
  const errors = trackErrors(page)
  await page.goto('/cortico?time=18:30')
  await waitForTownDrawn(page, ASSETS)

  await openPlatform(page)
  const depth = await page.evaluate(() => window.history.length)

  // The camera eased toward the laptop: wait until it lands, then project
  // the phone pedestal against the still camera.
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute(canvasHookAttribute('focus'), 'platform', {
    timeout: 30_000,
  })
  const point = await screenPoint(page, PEDESTAL_ANCHOR_BY_SLUG.recorder)
  await page.mouse.move(point.x, point.y)
  await expect(page.locator(canvasHookSelector('hover', '10'))).toBeVisible({ timeout: 15_000 })
  await hoverSettled(page)
  await page.mouse.click(point.x, point.y)
  await expect(page).toHaveURL(urlWithQuery(/\/cortico\/recorder\/?$/), { timeout: 15_000 })
  await expect(page.getByTestId('panel-breadcrumb')).toHaveText('cortico › recorder')
  await expect(
    page.getByTestId('case-panel').getByRole('heading', { name: 'recorder' }),
  ).toBeVisible()
  expect(await page.evaluate(() => window.history.length)).toBe(depth)

  expectNoErrors(errors)
})

test('the panel opens at night with the wisp lit', async ({ page }) => {
  test.slow()
  const errors = trackErrors(page)
  await page.goto('/cortico?time=22:00')
  await waitForTownDrawn(page, ASSETS)

  await openPlatform(page)
  await expect(page.getByTestId('panel-breadcrumb')).toHaveText('cortico › platform')
  await expect(page.locator('canvas')).toHaveAttribute(canvasHookAttribute('focus'), 'platform', {
    timeout: 30_000,
  })

  await page.screenshot({ path: '/tmp/fol-panel-night.png' })
  expectNoErrors(errors)
})

test('the panel docks to a bottom sheet on a narrow viewport', async ({ page }) => {
  test.slow()
  const errors = trackErrors(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/cortico?time=18:30')
  await waitForTownDrawn(page, ASSETS)

  await openPlatform(page)
  const panel = page.getByTestId('case-panel')
  await expect(page.getByTestId('panel-breadcrumb')).toHaveText('cortico › platform')
  // The narrow offset recenters the scene above the sheet: half of the
  // 420px-capped bottom sheet. Waiting for the ease also lets the sheet's
  // entrance animation finish, so the box below is final.
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute(canvasHookAttribute('focus'), 'platform', {
    timeout: 30_000,
  })
  await expect(canvas).toHaveAttribute(canvasHookAttribute('viewOffset'), '0,210', {
    timeout: 30_000,
  })
  // Close stays reachable and the sheet never spills past the viewport.
  await expect(page.getByTestId('panel-close')).toBeVisible()
  const overflow = await panel.evaluate((node) => ({
    rect: node.getBoundingClientRect().toJSON(),
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
  }))
  expect(overflow.rect.left).toBeGreaterThanOrEqual(0)
  expect(overflow.rect.right).toBeLessThanOrEqual(390)
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)

  await page.screenshot({ path: '/tmp/fol-panel-mobile.png' })
  expectNoErrors(errors)
})
