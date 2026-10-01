import { defineConfig, devices } from '@playwright/test'

const port = 4199

export default defineConfig({
  testDir: 'e2e',
  // SwiftShader rasterizes every pixel on the CPU, so parallel workers each
  // saturate cores and demand frames take seconds: dt-clamped eases then
  // outrun 30s waits (fol-u9i: 6/33 flaked in parallel, all green alone).
  // Serial workers reproduce the known-green alone condition.
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${port}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    // Headless Chromium has no GPU; SwiftShader gives it a real WebGL2 context.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    // The production build, the same bundle Vercel serves. The gate builds first.
    command: `node_modules/.bin/vite preview --outDir build/client --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
  },
})
