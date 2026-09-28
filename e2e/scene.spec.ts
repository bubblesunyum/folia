import { expect, test } from '@playwright/test'

// Captures land in /tmp/fol-*.png, where scripts/review.sh hands them to the design reviewer.
const keyframes = [
  { name: 'golden', time: '18:30' },
  { name: 'night', time: '22:00' },
]

for (const { name, time } of keyframes) {
  test(`renders at ${name}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })

    await page.goto(`/?time=${time}`)
    await expect(page.locator('canvas[data-assets="drawn"]')).toBeVisible({ timeout: 60_000 })
    await page.screenshot({ path: `/tmp/fol-fragment-${name}.png` })
    expect(errors).toEqual([])
  })
}

test('?hud shows the draw counters', async ({ page }) => {
  await page.goto('/?hud')
  await expect(page.locator('.perf-readout')).toContainText(/calls \d+ · sub-draws \d+/, {
    timeout: 30_000,
  })
})
