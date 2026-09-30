import { test } from '@playwright/test'
import { expectNoErrors, trackErrors, waitForTownDrawn } from './helpers'

// fol-9fh: two assets share the town-wide batches. Both must register into
// the batches (not just cross the network) with zero console errors, and the
// captures land in /tmp/fol-*.png for the design reviewer. Slot isolation
// (fragment 0–4, meadow 5–6, forum 7–10) is in assets/manifest.json;
// independent hover addressing is proven in e2e/hover.spec.ts.
const keyframes = [
  { name: 'golden', time: '18:30' },
  { name: 'night', time: '22:00' },
]

const ASSETS = 'cortico/forum,cortico/fragment,cortico/meadow'

for (const { name, time } of keyframes) {
  test(`two assets co-register at ${name}`, async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto(`/?time=${time}`)
    // Both assets registered into the batches, not just fetched.
    await waitForTownDrawn(page, ASSETS)
    await page.screenshot({ path: `/tmp/fol-town-two-asset-${name}.png` })
    expectNoErrors(errors)
  })
}

test('two-asset town at a narrow width', async ({ page }) => {
  const errors = trackErrors(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?time=18:30')
  await waitForTownDrawn(page, ASSETS)
  await page.screenshot({ path: '/tmp/fol-town-two-asset-narrow.png' })
  expectNoErrors(errors)
})
