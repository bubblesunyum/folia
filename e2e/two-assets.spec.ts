import { expect, test } from '@playwright/test'

// fol-9fh: two assets share the town-wide batches. Both must register into
// the batches (not just cross the network) with zero console errors, and the
// captures land in /tmp/fol-*.png for the design reviewer. Slot isolation
// (fragment 0–4, meadow 5–6) is in assets/manifest.json; independent hover
// addressing is proven in e2e/hover.spec.ts.
const keyframes = [
  { name: 'golden', time: '18:30' },
  { name: 'night', time: '22:00' },
]

for (const { name, time } of keyframes) {
  test(`two assets co-register at ${name}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })

    await page.goto(`/?time=${time}`)
    await expect(page.locator('canvas[data-assets="drawn"]')).toBeVisible({ timeout: 60_000 })
    // Both assets registered into the batches, not just fetched.
    await expect(
      page.locator('canvas[data-drawn-assets="cortico/fragment,cortico/meadow"]'),
    ).toBeVisible({
      timeout: 60_000,
    })
    await page.screenshot({ path: `/tmp/fol-town-two-asset-${name}.png` })
    expect(errors).toEqual([])
  })
}

test('two-asset town at a narrow width', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?time=18:30')
  await expect(page.locator('canvas[data-assets="drawn"]')).toBeVisible({ timeout: 60_000 })
  await expect(
    page.locator('canvas[data-drawn-assets="cortico/fragment,cortico/meadow"]'),
  ).toBeVisible({
    timeout: 60_000,
  })
  await page.screenshot({ path: '/tmp/fol-town-two-asset-narrow.png' })
  expect(errors).toEqual([])
})
