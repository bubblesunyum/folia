import { expect, type Page, test } from '@playwright/test'

async function zoomOf(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    return canvas ? Number(canvas.dataset.zoom) : Number.NaN
  })
}

async function ctrlWheel(page: Page, deltaY: number, times: number): Promise<void> {
  await page.evaluate(
    ({ dy, n }: { dy: number; n: number }) => {
      const canvas = document.querySelector('canvas')
      if (!canvas) throw new Error('canvas has no bounds')
      for (let i = 0; i < n; i += 1) {
        canvas.dispatchEvent(
          new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true }),
        )
      }
    },
    { dy: deltaY, n: times },
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?time=18:30')
  await expect(page.locator('canvas[data-assets="drawn"]')).toBeVisible({ timeout: 60_000 })
})

test('ctrl+wheel dollies the camera in and out', async ({ page }) => {
  const start = await zoomOf(page)
  expect(start).toBeGreaterThan(0)

  await ctrlWheel(page, 100, 2)
  expect(await zoomOf(page)).toBeGreaterThan(start)

  await ctrlWheel(page, -100, 2)
  expect(await zoomOf(page)).toBeCloseTo(start, 1)
})

test('a plain wheel is not a zoom: it leaves the camera alone', async ({ page }) => {
  const start = await zoomOf(page)
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) throw new Error('canvas has no bounds')
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))
  })
  expect(await zoomOf(page)).toBe(start)
})

test('pushing past the far limit trips the rise detent', async ({ page }) => {
  await ctrlWheel(page, 100, 20)
  const rises = await page.evaluate(
    () => (window as unknown as { foliaRiseCount?: number }).foliaRiseCount ?? 0,
  )
  expect(rises).toBeGreaterThan(0)
  // The camera sits at the far limit: the readout measures it, not the model.
  expect(await zoomOf(page)).toBeCloseTo(90, 0)
})

test('escape signals rise without moving the camera', async ({ page }) => {
  const start = await zoomOf(page)
  await page.keyboard.press('Escape')
  const rises = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    return canvas ? Number(canvas.dataset.rises ?? 0) : 0
  })
  expect(rises).toBe(1)
  expect(await zoomOf(page)).toBe(start)
})

test('ctrl+wheel paints a frame through the demand loop', async ({ page }) => {
  await page.addInitScript(`
    window.foliaDrawCalls = 0
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const original = WebGL2RenderingContext.prototype[name]
      WebGL2RenderingContext.prototype[name] = function (...args) {
        window.foliaDrawCalls += 1
        return original.apply(this, args)
      }
    }
  `)
  await page.reload()
  await expect(page.locator('canvas[data-assets="drawn"]')).toBeVisible({ timeout: 60_000 })
  const calls = () =>
    page.evaluate(() => (window as unknown as { foliaDrawCalls: number }).foliaDrawCalls)
  await page.waitForTimeout(300)
  const resting = await calls()
  await page.waitForTimeout(300)
  expect(await calls()).toBe(resting)
  await ctrlWheel(page, 100, 2)
  await expect.poll(calls, { timeout: 10_000 }).toBeGreaterThan(resting)
})

test('the zoom buttons move the camera', async ({ page }) => {
  const start = await zoomOf(page)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  expect(await zoomOf(page)).toBeLessThan(start)
  await page.getByRole('button', { name: 'Zoom out' }).click()
  expect(await zoomOf(page)).toBeCloseTo(start, 1)
})
