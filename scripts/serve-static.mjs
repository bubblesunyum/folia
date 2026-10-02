#!/usr/bin/env node
// Vercel-like static server for e2e and bench (fol-dnq).
//
// vite preview serves the SPA fallback (home html) for slashless nested
// routes like /cortico/platform, so hydration throws React #418 and the error
// boundary renders — while /cortico/platform/ works. Vercel resolves clean
// URLs to .../index.html instead, and shared case links arrive slashless, so
// e2e and bench must serve the same way: exact file, then <path>.html, then
// <path>/index.html. No directory redirects (those push slashed entries that
// remap .data URLs, the rr-slashed-data trap) and no SPA fallback (404 like
// Vercel with no rewrites configured).
//
//   node scripts/serve-static.mjs --dir build/client --port 4199
//   node scripts/serve-static.mjs --port 4299 --host 127.0.0.1

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, normalize, resolve, sep } from 'node:path'

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json'],
  ['.map', 'application/json'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.wasm', 'application/wasm'],
  ['.glb', 'model/gltf-binary'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.xml', 'application/xml'],
])

function flag(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

const ROOT = resolve(String(flag('--dir', 'build/client')))
const PORT = Number(flag('--port', process.env.PORT ?? '4199'))
const HOST = String(flag('--host', '127.0.0.1'))

async function isFile(abs) {
  try {
    return (await stat(abs)).isFile()
  } catch {
    return false
  }
}

// Vercel clean-URL resolution: the exact file, then <path>.html, then the
// directory index — so slashless /cortico/platform serves
// cortico/platform/index.html with the URL untouched.
async function resolveFile(pathname) {
  const safe = normalize(pathname).replace(/^\.\.(?=$|[\\/])/, '')
  const abs = join(ROOT, safe)
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return null
  if (pathname.endsWith('/')) {
    const index = join(abs, 'index.html')
    return (await isFile(index)) ? index : null
  }
  if (await isFile(abs)) return abs
  if (await isFile(abs + '.html')) return abs + '.html'
  const index = join(abs, 'index.html')
  return (await isFile(index)) ? index : null
}

function contentType(abs) {
  const dot = abs.lastIndexOf('.')
  const ext = dot === -1 ? '' : abs.slice(dot).toLowerCase()
  // Unknown extensions (notably RR's .data payloads) ride as
  // application/octet-stream, the same as Vercel's static file serving.
  return MIME.get(ext) ?? 'application/octet-stream'
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    const file = await resolveFile(pathname)
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`not found: ${pathname}`)
      return
    }
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': contentType(file), 'content-length': body.length })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`serve-static: ${error.message}`)
  }
})

server.listen(PORT, HOST, () => {
  console.log(`serve-static: listening on http://${HOST}:${PORT} (root ${ROOT})`)
})
