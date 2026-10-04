import { expect, type Page, test } from '@playwright/test'
import { expectNoErrors, trackErrors, waitForTownDrawn } from './helpers'

// fol-kes.12: the route loaders warm the lazy mdx body chunk, but the fully
// static build has no server loader at navigation time, so a client
// navigation must warm it in a clientLoader or the body renders empty until
// the chunk arrives. A MutationObserver records every commit in which the
// route's heading is on screen without its body copy; one such commit is the
// flash.

const ASSETS = 'cortico/forum,cortico/fragment,cortico/meadow'

declare global {
  interface Window {
    __bareCommits?: string[]
  }
}

/** Record commits where `heading` shows (inside `scope`) without `copy`. */
async function watchBareCommits(
  page: Page,
  scope: string,
  heading: string,
  copy: string,
): Promise<void> {
  await page.evaluate(
    ({ scope, heading, copy }) => {
      window.__bareCommits = []
      const check = () => {
        const root = document.querySelector(scope)
        const h1 = root?.querySelector('h1')
        if (root === null || h1 === null || h1 === undefined) return
        if (h1.textContent !== heading) return
        if (!(root.textContent ?? '').includes(copy)) {
          window.__bareCommits?.push(root.textContent ?? '')
        }
      }
      new MutationObserver(check).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      })
    },
    { scope, heading, copy },
  )
}

test('client navigation commits each route with its mdx body copy', async ({ page }) => {
  test.slow()
  const errors = trackErrors(page)
  await page.goto('/?time=18:30')
  await waitForTownDrawn(page, ASSETS)
  await expect(page.getByText('a solarpunk town seen from above')).toBeVisible()

  // town -> project
  await watchBareCommits(
    page,
    'article.route-content',
    'cortico',
    'a conversation platform, grown as a solarpunk forum',
  )
  await page.getByRole('link', { name: 'cortico', exact: true }).click()
  await expect(page).toHaveURL(/\/cortico$/)
  await expect(page.getByText('a conversation platform, grown as a solarpunk forum')).toBeVisible()
  expect(await page.evaluate(() => window.__bareCommits)).toEqual([])

  // project -> case
  await watchBareCommits(
    page,
    '[data-testid="case-panel"]',
    'platform',
    'how cortico holds large conversations',
  )
  await page.getByRole('link', { name: 'platform' }).first().click()
  await expect(page).toHaveURL(/\/cortico\/platform$/)
  await expect(page.getByTestId('case-panel')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('how cortico holds large conversations')).toBeVisible()
  expect(await page.evaluate(() => window.__bareCommits)).toEqual([])

  // case -> town (back to the home route, still client-side)
  await page.goBack()
  await page.goBack()
  await expect(page).toHaveURL(/localhost:\d+\/(\?.*)?$/)
  await expect(page.getByText('a solarpunk town seen from above')).toBeVisible()

  expectNoErrors(errors)
})
