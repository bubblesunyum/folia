import { expect, type Page, test } from '@playwright/test'
import { canvasHookAttribute, canvasHookSelector } from '../src/testHooks'
import { expectNoErrors, trackErrors, urlWithQuery, waitForTownDrawn } from './helpers'

// fol-l7d.11: keyboard navigation through the HTML content layer and reduced
// motion end to end. Tab order runs town → project → case over real links;
// case-link focus drives the same 3D lift as hover through the intent layer;
// Escape closes the panel (and the flight/orbit under it) with focus
// returning to the case link; reduced motion cuts flights, rests ambient and
// cuts the reveal. Every wait rides a data flag the app sets — never a bare
// timeout — and routes load directly from the static server like a deep link.

const ASSETS = 'cortico/forum,cortico/fragment,cortico/meadow,town/skeleton'

/** Tab until the focused element matches, in DOM order from wherever focus sits. */
async function tabUntil(page: Page, selector: string, max = 40): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    const match = await page.evaluate((sel) => {
      const el = document.activeElement
      return el instanceof HTMLElement && el.matches(sel)
    }, selector)
    if (match) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`keyboard: never tabbed to ${selector}`)
}

/** Whether the focused element shows a visible focus ring. */
function focusIsVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement
    return el instanceof HTMLElement && el.matches(':focus-visible')
  })
}

async function canvasAttr(page: Page, name: string): Promise<string | null> {
  return page.locator('canvas').getAttribute(name)
}

async function hoverSettled(page: Page): Promise<void> {
  await expect(page.locator(canvasHookSelector('hoverSettled', 'true'))).toBeVisible({
    timeout: 30_000,
  })
}

async function zoomOf(page: Page): Promise<number> {
  const value = await canvasAttr(page, canvasHookAttribute('zoom'))
  return Number(value)
}

test('keyboard-only traverse town -> project -> case with visible focus', async ({ page }) => {
  test.slow()
  const errors = trackErrors(page)
  await page.goto('/?time=18:30')
  await waitForTownDrawn(page, ASSETS)

  // Startup first: the tier probe's frames stall input response, so the
  // keyboard asserts below start after it, not inside it.
  await expect(page.locator('canvas[data-tier-probe="done"]')).toBeVisible({ timeout: 60_000 })

  await tabUntil(page, 'a[href^="/cortico"]')
  expect(await focusIsVisible(page)).toBe(true)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(urlWithQuery(/\/cortico\/?$/), { timeout: 15_000 })

  await tabUntil(page, 'a[data-pedestal="platform"]')
  expect(await focusIsVisible(page)).toBe(true)
  // Case-link focus drives the same lift as hover, through the intent layer.
  await hoverSettled(page)
  expect(await canvasAttr(page, canvasHookAttribute('lifted'))).not.toBe('')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(urlWithQuery(/\/cortico\/platform\/?$/), { timeout: 15_000 })
  await expect(page.getByTestId('case-panel')).toBeVisible({ timeout: 15_000 })

  // The panel takes focus on open: keyboard users land inside it.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document
              .querySelector('[data-testid="case-panel"]')
              ?.contains(document.activeElement) ?? false,
        ),
      { timeout: 5_000 },
    )
    .toBe(true)

  expectNoErrors(errors)
})

test('Escape closes the panel and returns focus to the case link', async ({ page }) => {
  test.slow()
  const errors = trackErrors(page)
  // Direct load: closing replaces back to the place (no history to pop).
  await page.goto('/cortico/platform?time=18:30')
  await waitForTownDrawn(page, ASSETS)
  await expect(page.getByTestId('case-panel')).toBeVisible({ timeout: 15_000 })

  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(urlWithQuery(/\/cortico\/?$/), { timeout: 15_000 })
  await expect(page.getByTestId('case-panel')).toHaveCount(0)
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.activeElement instanceof HTMLElement &&
            document.activeElement.matches('a[data-pedestal="platform"]'),
        ),
      { timeout: 5_000 },
    )
    .toBe(true)

  // And back through a client-side open: closing pops back to the place and
  // still returns focus to the same link.
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(urlWithQuery(/\/cortico\/platform\/?$/), { timeout: 15_000 })
  await expect(page.getByTestId('case-panel')).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(urlWithQuery(/\/cortico\/?$/), { timeout: 15_000 })
  await expect(page.getByTestId('case-panel')).toHaveCount(0)
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.activeElement instanceof HTMLElement &&
            document.activeElement.matches('a[data-pedestal="platform"]'),
        ),
      { timeout: 5_000 },
    )
    .toBe(true)

  expectNoErrors(errors)
})

test('reduced motion cuts flights, rests ambient and cuts the reveal', async ({ page }) => {
  test.slow()
  const errors = trackErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/cortico/platform?time=18:30')
  await waitForTownDrawn(page, ASSETS)
  const panel = page.getByTestId('case-panel')
  await expect(panel).toBeVisible({ timeout: 15_000 })

  // The camera flight is a cut: the reframe lands on the open pedestal
  // without easing through intermediate states.
  await expect(page.locator('canvas')).toHaveAttribute(canvasHookAttribute('focus'), 'platform', {
    timeout: 15_000,
  })

  // The sheet entrance animation is off: the reveal shows its final state.
  expect(await panel.evaluate((node) => getComputedStyle(node).animationName)).toBe('none')
  expect(
    await page
      .locator('.canvas-fade')
      .evaluate((node) => getComputedStyle(node).transitionDuration),
  ).toBe('0s')

  // Ambient motion rests: no new ambient frames across the window.
  const frames = (): Promise<string | null> =>
    page.locator('canvas[data-assets="drawn"]').getAttribute('data-ambient-frames')
  await expect.poll(() => frames(), { timeout: 15_000 }).not.toBeNull()
  const before = await frames()
  await page.waitForTimeout(600)
  expect(await frames()).toBe(before)

  expectNoErrors(errors)
})

test('?sway=off holds the shared ambient clock still', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/?time=18:30&sway=off&reflection=off')
  await waitForTownDrawn(page, ASSETS)
  await page.waitForTimeout(700)
  expect(await canvasAttr(page, canvasHookAttribute('ambientTime'))).toBeNull()
  expectNoErrors(errors)
})

test('the +/- keys zoom and Escape rises the detent', async ({ page }) => {
  test.slow()
  const errors = trackErrors(page)
  // Stepped +/- zoom works at town distance (fol-l7d.8 owns place-route
  // camera behavior, so zoom input on a direct-loaded place route is out of
  // scope): run the zoom asserts at town, where the keys demonstrably step.
  await page.goto('/?time=18:30')
  await waitForTownDrawn(page, ASSETS)

  // Startup first, as above: stepped zoom needs rendered frames to land.
  await expect(page.locator('canvas[data-tier-probe="done"]')).toBeVisible({ timeout: 60_000 })

  const start = await zoomOf(page)
  expect(start).toBeGreaterThan(0)
  await page.keyboard.press('+')
  await expect.poll(() => zoomOf(page), { timeout: 5_000 }).toBeCloseTo(start - 4, 0)
  await page.keyboard.press('-')
  await expect.poll(() => zoomOf(page), { timeout: 5_000 }).toBeCloseTo(start, 0)

  // Escape is the keyboard detent equivalent at the place route: it signals
  // the one-level rise without moving the camera, and the route stays put.
  await page.goto('/cortico?time=18:30')
  await waitForTownDrawn(page, ASSETS)
  const placeStart = await zoomOf(page)
  expect(placeStart).toBeGreaterThan(0)
  const risesBefore = Number((await canvasAttr(page, canvasHookAttribute('rises'))) ?? 0)
  await page.keyboard.press('Escape')
  await expect
    .poll(() => canvasAttr(page, canvasHookAttribute('rises')), { timeout: 5_000 })
    .toBe(String(risesBefore + 1))
  expect(await zoomOf(page)).toBeCloseTo(placeStart, 1)
  await expect(page).toHaveURL(urlWithQuery(/\/cortico\/?$/))

  expectNoErrors(errors)
})
