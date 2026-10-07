import { expect, test } from '@playwright/test'
import { expectNoErrors, trackErrors, waitForTownDrawn } from './helpers'

// fol-dnq: shared case links arrive as direct slashless loads
// (/cortico/platform, no trailing slash). Under vite preview those served
// the SPA fallback and hydrated to React #418; the static server resolves
// them to .../index.html like Vercel. One direct load per case route pins
// that the panel renders with no hydration error, and that the URL stays
// slashless (no directory redirect, which would remap the .data URL).

const ASSETS = 'cortico/forum,cortico/fragment,cortico/meadow,town/skeleton'

for (const slug of ['platform', 'recorder', 'medley']) {
  test(`direct slashless load of /cortico/${slug} renders the panel`, async ({ page }) => {
    test.slow()
    const errors = trackErrors(page)
    await page.goto(`/cortico/${slug}?time=18:30`)
    await waitForTownDrawn(page, ASSETS)

    await expect(page.getByTestId('case-panel')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('panel-breadcrumb')).toHaveText(`cortico › ${slug}`)
    await expect(page.getByTestId('case-panel').getByRole('heading', { name: slug })).toBeVisible()
    // The server resolved the clean URL in place: no trailing-slash
    // redirect on the way in.
    expect(page.url()).toMatch(new RegExp(`/cortico/${slug}\\?time=`))

    expectNoErrors(errors)
  })
}

test('direct slashless load of /cortico renders the place page', async ({ page }) => {
  test.slow()
  const errors = trackErrors(page)
  await page.goto('/cortico?time=18:30')
  await waitForTownDrawn(page, ASSETS)

  await expect(page.getByRole('heading', { name: 'cortico' })).toBeVisible()
  expect(page.url()).toMatch(/\/cortico\?time=/)

  expectNoErrors(errors)
})

test('unknown project 404s instead of serving the town', async ({ page }) => {
  const response = await page.goto('/unknown-project?time=18:30')
  expect(response?.status()).toBe(404)
})

test('narrow open-case capture shows the bottom sheet (fol-ctd)', async ({ page }) => {
  test.slow()
  const errors = trackErrors(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/cortico/platform?time=18:30')
  await waitForTownDrawn(page, ASSETS)

  const panel = page.getByTestId('case-panel')
  await expect(panel).toBeVisible({ timeout: 15_000 })
  await expect(panel).toHaveAttribute('data-variant', 'bottom')
  await expect(page.getByTestId('panel-breadcrumb')).toHaveText('cortico › platform')
  await page.screenshot({ path: '/tmp/fol-ctd-narrow.png' })

  expectNoErrors(errors)
})
