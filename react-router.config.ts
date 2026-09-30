import type { Config } from '@react-router/dev/config'

export default {
  // Routes live under src/ instead of the default app/ directory.
  appDirectory: 'src',
  // Fully static: no runtime server, every route prerendered (D-003).
  ssr: false,
  // All routes load with the initial document: no runtime route manifest to
  // fetch from the static host.
  routeDiscovery: { mode: 'initial' },
  // Static prerender list. Adding a case study MDX means adding its path here.
  prerender: ['/', '/cortico', '/cortico/platform', '/cortico/recorder', '/cortico/medley'],
} satisfies Config
