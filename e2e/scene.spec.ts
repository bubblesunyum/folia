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

test('?perf=base renders at the base Air size and benches a burst', async ({ page }) => {
  await page.goto('/?perf=base&aa=smaa')
  await expect(page.locator('canvas[data-assets="drawn"]')).toBeVisible({ timeout: 60_000 })
  const size = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    return canvas && [canvas.width, canvas.height]
  })
  expect(size).toEqual([2560, 1600])
  const result = await page.evaluate(() => window.foliaBench?.(3, 1))
  expect(result?.frames).toBe(3)
  expect(result?.ms).toBeGreaterThan(0)
})

test('the scene redraws when the camera moves', async ({ page }) => {
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
  await page.goto('/?time=18:30')
  const canvas = page.locator('canvas[data-assets="drawn"]')
  await expect(canvas).toBeVisible({ timeout: 60_000 })
  const calls = () =>
    page.evaluate(() => (window as unknown as { foliaDrawCalls: number }).foliaDrawCalls)
  await page.waitForTimeout(300)
  const beforeMove = await calls()

  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas has no bounds')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 30, {
    steps: 8,
  })
  await page.mouse.up()
  expect(await calls()).toBeGreaterThan(beforeMove)
})
