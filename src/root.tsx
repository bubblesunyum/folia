import { type ComponentType, type ReactNode, useEffect, useState } from 'react'
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'
import { CanvasHost } from './shell/CanvasHost'
import { SkyShell } from './shell/SkyShell'
import './styles.css'

// The root route must live at <appDirectory>/root.tsx, i.e. src/root.tsx.

// The document shell, shared by the app, the hydrate fallback and the error
// boundary so the shell never remounts between them.
export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Previews stay out of search indexes until the launch subdomain (D-026). */}
        <meta name="robots" content="noindex" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

// One persistent canvas for the whole session (D-003): the root layout never
// remounts on navigation, so route changes swap the outlet content while the
// town stays mounted. three/R3F stay behind the lazy boundary in CanvasHost
// and out of the prerender graph (D-047).
export default function App() {
  const [Bench, setBench] = useState<ComponentType | null>(null)
  // Client-only, like the canvas chunk: the bench module reads window at
  // import, so it loads in an effect and stays out of the prerender graph.
  useEffect(() => {
    let live = true
    void import('./shell/BenchHost').then(
      (module) => {
        if (live) setBench(() => module.BenchHost)
      },
      (error: unknown) => console.error('folia: bench chunk failed', error),
    )
    return () => {
      live = false
    }
  }, [])
  return (
    <CanvasHost>
      <Outlet />
      {Bench === null ? null : <Bench />}
    </CanvasHost>
  )
}

// Shown while the client hydrates: the same shell the prerendered HTML
// carries, without the canvas.
export function HydrateFallback() {
  return (
    <CanvasHost>
      <SkyShell />
    </CanvasHost>
  )
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const notFound = isRouteErrorResponse(error) && error.status === 404
  return (
    <CanvasHost>
      <article className="route-content">
        <h1>{notFound ? 'not here yet' : 'something broke'}</h1>
        <p>
          {notFound
            ? 'this corner of the town is still under construction'
            : 'the town hit a snag loading this place'}
        </p>
      </article>
    </CanvasHost>
  )
}
