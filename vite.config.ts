import { reactRouter } from '@react-router/dev/vite'
import { defineConfig } from 'vitest/config'
import { foliaAssets } from './assets/pipeline/vitePlugin.ts'

export default defineConfig({
  // reactRouter() owns the React transform (as in the framework template), so
  // the standalone react() plugin is dropped to avoid a double transform.
  plugins: [reactRouter(), foliaAssets()],
  test: {
    include: ['src/**/*.test.ts', 'assets/pipeline/**/*.test.ts'],
  },
})
