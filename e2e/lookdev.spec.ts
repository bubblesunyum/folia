import { expect, type Page, test } from '@playwright/test'
import { canvasHookAttribute, canvasHookSelector } from '../src/testHooks'

// The look-dev bench (D-034): leva edits drive the scene live. Saves POST to
// the dev-only `/__folia/look` endpoint, so under preview (no middleware) the
// spec pins the bench up to the save and asserts the save reports its failure
// instead of failing silent.

async function openBench(page: Page): Promise<void> {
  const mint = page.locator('input[id="palette.mint"]')
  if (!(await mint.isVisible())) {
    // The panel starts collapsed; the folders live underneath its title.
    await page.getByText('time of day', { exact: true }).click()
  }
  await expect(mint).toBeVisible()
}

test('?panel shows the bench and a tweak reaches the scene', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/?time=18:30&panel')
  await expect(page.locator(canvasHookSelector('assets', 'drawn'))).toBeVisible({ timeout: 60_000 })
  await openBench(page)

  const canvas = page.locator(canvasHookSelector('sun'))
  await expect(canvas).toHaveAttribute(canvasHookAttribute('sun'), '4.50')

  const sun = page.locator('input[id="keyframes/golden.sun.intensity"]')
  await sun.fill('0')
  await sun.press('Enter')
  await expect(canvas).toHaveAttribute(canvasHookAttribute('sun'), '0.00')
  expect(errors).toEqual([])
})

test('save reports the missing dev server instead of failing silent', async ({ page }) => {
  await page.goto('/?time=18:30&panel')
  await expect(page.locator(canvasHookSelector('assets', 'drawn'))).toBeVisible({ timeout: 60_000 })
  await openBench(page)
  await page.getByRole('button', { name: 'writeBack' }).click()
  await expect(page.getByText(/write back failed/)).toBeVisible({ timeout: 10_000 })
})
