import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { foliaAssets } from './assets/pipeline/vitePlugin.ts'

export default defineConfig({
  plugins: [react(), foliaAssets()],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
