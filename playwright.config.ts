import { defineConfig, devices } from '@playwright/test'

const port = 4199

export default defineConfig({
  testDir: 'e2e',
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
    command: `node_modules/.bin/vite preview --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
  },
})
