import { test } from '@playwright/test'
import { expectNoErrors, trackErrors, waitForTownDrawn } from './helpers'

// fol-l1r.4: the cortico forum joins the town-wide batches — medallion floor,
// gold trim, mint neon ring and three pedestals (laptop, phone, audio glyph)
// on the fragment's top terrace, slots 7–10 in assets/manifest.json. Both
// keyframes must register all three assets with zero console errors, and the
// captures land in /tmp/fol-forum-*.png for the design reviewer.
const keyframes = [
  { name: 'golden', time: '18:30' },
  { name: 'night', time: '22:00' },
]

const ASSETS = 'cortico/forum,cortico/fragment,cortico/meadow'

for (const { name, time } of keyframes) {
  test(`forum pedestals register at ${name}`, async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto(`/?time=${time}`)
    // All three assets registered into the batches, not just fetched.
    await waitForTownDrawn(page, ASSETS)
    await page.screenshot({ path: `/tmp/fol-forum-${name}.png` })
    expectNoErrors(errors)
  })
}
