// The fast loop (D-034): in dev, saving a Blender script, params file or the
// palette rebuilds the assets that depend on it and hot-swaps the GLB in the
// running scene, with no page reload. Also serves `virtual:folia-assets`, the
// asset → content-hash map the client puts on each GLB URL.

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { Plugin } from 'vite'
import type { BuildResult } from './build.ts'

const ID = 'virtual:folia-assets'
const RESOLVED = `\0${ID}`
const DEBOUNCE_MS = 120

/** The `folia:asset` HMR payload. */
export interface AssetEvent {
  asset: string
  hash: string
  /** `Date.now()` when the save was seen, for the save-to-pixels measurement. */
  savedAt: number
}

export function foliaAssets(): Plugin {
  let root = process.cwd()
  return {
    name: 'folia-assets',
    configResolved(config) {
      root = config.root
    },
    resolveId: (source) => (source === ID ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return
      const manifest = JSON.parse(
        readFileSync(join(root, 'assets/manifest.json'), 'utf8'),
      ) as Record<string, { hash: string; groups?: Record<string, number> }>
      const hashes = Object.fromEntries(Object.entries(manifest).map(([a, r]) => [a, r.hash]))
      // Global group slots (D-061): the hover writer addresses groups by
      // name; picking reads the slot straight from the geometry.
      const slots = Object.fromEntries(
        Object.entries(manifest).map(([a, r]) => [a, r.groups ?? {}]),
      )
      return `export default ${JSON.stringify(hashes)}\nexport const groupSlots = ${JSON.stringify(slots)}`
    },
    async configureServer(server) {
      // Imported at runtime, not bundled into the config: otherwise every edit
      // to the pipeline or the batch schema would restart the dev server. Only
      // the source listing comes from here; builds run in a fresh process, so
      // they always use the pipeline code as it is on disk.
      const script = join(root, 'assets/pipeline/build.ts')
      const build: typeof import('./build.ts') = await import(pathToFileURL(script).href)
      const buildAsset = async (asset: string): Promise<BuildResult | null> => {
        const { stdout } = await promisify(execFile)(process.execPath, [script, asset, '--json'], {
          cwd: root,
          maxBuffer: 16 * 1024 * 1024,
        })
        return JSON.parse(stdout.trim().split('\n').at(-1) ?? 'null')
      }
      const pending = new Set<string>()
      let savedAt = 0
      let timer: ReturnType<typeof setTimeout> | undefined
      let running: Promise<void> = Promise.resolve()

      const rebuild = async (assets: string[], at: number) => {
        for (const asset of assets) {
          try {
            const result = await buildAsset(asset)
            if (!result) continue
            const seconds = Object.entries(result.seconds).map(([k, v]) => `${k} ${v}s`)
            server.config.logger.info(`folia: rebuilt ${asset} (${seconds.join(', ')})`, {
              timestamp: true,
            })
            const virtual = server.moduleGraph.getModuleById(RESOLVED)
            if (virtual) server.moduleGraph.invalidateModule(virtual)
            const event: AssetEvent = { asset, hash: result.hash, savedAt: at }
            server.ws.send({ type: 'custom', event: 'folia:asset', data: event })
          } catch (error) {
            const { stderr, message } = error as { stderr?: string; message: string }
            server.config.logger.error(`folia: ${stderr || message}`, { timestamp: true })
          }
        }
      }

      server.watcher.on('change', (file) => {
        const assets = build.listAssets().filter((a) => build.assetSources(a).includes(file))
        if (!assets.length) return
        for (const asset of assets) pending.add(asset)
        savedAt ||= Date.now()
        clearTimeout(timer)
        timer = setTimeout(() => {
          const batch = [...pending]
          const at = savedAt
          pending.clear()
          savedAt = 0
          running = running.then(() => rebuild(batch, at))
        }, DEBOUNCE_MS)
      })
    },
  }
}
