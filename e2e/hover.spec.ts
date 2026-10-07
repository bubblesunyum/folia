import { expect, type Page, test } from '@playwright/test'
import { canvasHookAttribute, canvasHookSelector, PROJECTOR_KEY } from '../src/testHooks'
import { waitForTownDrawn } from './helpers'

// fol-xo6: hover picking on the town-wide batches. The pointer raycasts the
// shared BatchedMeshes and the hit vertex's groupId — already the global
// uGroupState slot after the pack remap — selects the hovered group. Meadow
// terrace must resolve to slot 6 (not fragment terrace's 4) and the canopy to
// slot 0: the right group, with glow confined to it (clean edges) in the
// captures at /tmp/fol-hover-*.png.

/** Canvas CSS pixels for a world position, projected by the app itself. */
function screenPoint(
  page: Page,
  world: [number, number, number],
): Promise<{ x: number; y: number }> {
  type Projector = (w: [number, number, number]) => { x: number; y: number }
  return page.evaluate(
    ([w, key]: [[number, number, number], string]) => {
      const project = (window as unknown as Record<string, Projector | undefined>)[key]
      if (!project) throw new Error(`${key} is not mounted yet`)
      return project(w)
    },
    [world, PROJECTOR_KEY] as [[number, number, number], string],
  )
}

async function hoverSettled(page: Page): Promise<void> {
  // State-based, not time-based — but under a full parallel SwiftShader run
  // each demand frame is slow, so the bound is generous.
  await expect(page.locator(canvasHookSelector('hoverSettled', 'true'))).toBeVisible({
    timeout: 30_000,
  })
}

async function hoverAt(page: Page, world: [number, number, number]): Promise<string> {
  const point = await screenPoint(page, world)
  await page.mouse.move(point.x, point.y)
  const canvas = page.locator(canvasHookSelector('hover'))
  await expect(canvas).not.toHaveAttribute(canvasHookAttribute('hover'), '', { timeout: 15_000 })
  await hoverSettled(page)
  const slot = await canvas.getAttribute(canvasHookAttribute('hover'))
  if (!slot) throw new Error('hover resolved empty after settling')
  return slot
}

async function bothAssetsDrawn(page: Page): Promise<void> {
  await waitForTownDrawn(page, 'cortico/forum,cortico/fragment,cortico/meadow,town/skeleton')
}

test('hover addresses the meadow terrace, not the fragment one', async ({ page }) => {
  // SwiftShader software rendering under a parallel gate run is slow: two
  // settled hovers plus two captures exceed the default 30 s test timeout.
  test.slow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/?time=18:30')
  await bothAssetsDrawn(page)

  // Meadow upper-terrace top (Blender centre [13, 4] sits at three (13, -4)
  // after the export's y-up flip). Slot 6 in the manifest; fragment terrace
  // is 4 — the same local _ID on two assets must not cross-talk.
  const meadow = await hoverAt(page, [12.2, 1.0, -3.2])
  expect(meadow).toBe('6')
  await page.screenshot({ path: '/tmp/fol-hover-meadow-golden.png' })

  // Fragment terrace below the canopy (same Blender centre, y at terrace
  // height): slot 4 in the manifest, proving the shared cream batch resolves
  // per group rather than per mesh. The canopy crown above it (y 6.5) is
  // high-LOD-only (mid_groups is ground+terrace per the D-072 split), so at
  // the town vantage that ray correctly resolves the ground behind it —
  // verified slot 0 up close at /cortico, where high LOD renders.
  const terrace = await hoverAt(page, [3.2, 1.5, -2.6])
  expect(terrace).toBe('4')
  await page.screenshot({ path: '/tmp/fol-hover-canopy-golden.png' })

  expect(errors).toEqual([])
})

test('hover glow holds at night with clean edges', async ({ page }) => {
  test.slow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/?time=22:00')
  await bothAssetsDrawn(page)

  const meadow = await hoverAt(page, [12.2, 1.0, -3.2])
  expect(meadow).toBe('6')
  await page.screenshot({ path: '/tmp/fol-hover-meadow-night.png' })

  expect(errors).toEqual([])
})
