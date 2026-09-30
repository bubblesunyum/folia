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
