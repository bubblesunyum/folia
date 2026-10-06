import { expect, type Page } from '@playwright/test'

// The goto → drawnAssets → screenshot → errors boilerplate every town spec
// repeats, in one place so a hook rename breaks one import, not five files.

/** Console and page errors collected while the town loads. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

/** The town registered into the batches: `assets` drawn plus every asset named. */
export async function waitForTownDrawn(page: Page, assets: string): Promise<void> {
  await expect(page.locator('canvas[data-assets="drawn"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator(`canvas[data-drawn-assets="${assets}"]`)).toBeVisible({
    timeout: 60_000,
  })
}

/** No console or page errors: the failure lists them. */
export function expectNoErrors(errors: string[]): void {
  expect(errors).toEqual([])
}

/** The URL still carries the `?time=` override after client navigation. */
export async function expectTimeParam(page: Page, time: string): Promise<void> {
  const [hours, minutes] = time.split(':')
  await expect(page).toHaveURL(new RegExp(`[?&]time=${hours}(%3A|:)${minutes}`))
}

declare global {
  interface Window {
    __sunValues?: (string | null)[]
  }
}

/**
 * Records every canvas `data-sun` value from here on (fol-76l): the sun
 * intensity is the look's fingerprint (night reads 0.00, golden hour 4.50),
 * so a golden flash mid-session shows up as a non-night entry.
 */
export async function watchSunValues(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__sunValues = []
    const record = (): void => {
      window.__sunValues?.push(document.querySelector('canvas')?.getAttribute('data-sun') ?? null)
    }
    record()
    new MutationObserver(record).observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ['data-sun'],
    })
  })
}

/** Every recorded canvas `data-sun` value, oldest first. */
export function readSunValues(page: Page): Promise<(string | null)[]> {
  return page.evaluate(() => window.__sunValues ?? [])
}

/** Counts WebGL draw calls the page issues. */
export const COUNT_DRAWS = `
  window.foliaDrawCalls = 0
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
    const original = WebGL2RenderingContext.prototype[name]
    WebGL2RenderingContext.prototype[name] = function (...args) {
      window.foliaDrawCalls += 1
      return original.apply(this, args)
    }
  }
`

/** Fetch the current WebGL draw call count. */
export function drawCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { foliaDrawCalls: number }).foliaDrawCalls)
}
