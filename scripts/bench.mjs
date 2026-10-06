#!/usr/bin/env node
// Saturated frame throughput at the base-Air proxy on this Mac (D-055, D-063).
//
//   node scripts/bench.mjs                          # golden hour, the shipped AA
//   node scripts/bench.mjs aa=smaa 'time=22:00'     # one run per argument
//   node scripts/bench.mjs aa=msaa stress=2000      # add 2000 tiny instances (4000 sub-draws)
//
// Each argument is extra query params on top of `?perf=base`. It serves the
// last `react-router build` from build/client/ itself, so run
// scripts/verify.sh first (the gate builds before bench can run). Every run draws
// four bursts of 240 frames back to back (see src/perf/bench.ts) and prints ms per
// frame alongside the slice-exit verdict. Close other active scene tabs first
// so they do not compete for GPU time.

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { assertBuildFresh, CLIENT_INDEX } from './lib/fresh-build.mjs'
import { chromium } from '@playwright/test'

// Slice-exit budget and noise gate: read from the single source in
// src/perf/renderConfig.ts (D-063, D-075) so the three can never drift.
// Fail closed when a value cannot be parsed.
function readRenderConst(name) {
  const match = readFileSync('src/perf/renderConfig.ts', 'utf8').match(
    new RegExp(`${name}\\s*=\\s*([\\d.]+)`),
  )
  const value = match ? Number(match[1]) : NaN
  if (!Number.isFinite(value)) throw new Error(`bench: ${name} not found in src/perf/renderConfig.ts`)
  return value
}

// Slice-exit budget (D-063).
const SATURATED_BUDGET_MS = readRenderConst('SATURATED_BUDGET_MS')

// Noise gate: the burst-to-burst range the verdict trusts (D-075,
// fol-kes.16). Breadth fills the ~0.25 ms of D-072 headroom, so the gate
// refuses noisy runs before judging the budget.
const BENCH_SPREAD_THRESHOLD_MS = readRenderConst('BENCH_SPREAD_THRESHOLD_MS')

const PORT = 4299
const BURSTS = 4
const FRAMES = 240

const runs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['']
if (runs.some((run) => run.startsWith('-'))) {
  console.error('usage: node scripts/bench.mjs [query-params ...]   e.g. aa=smaa "time=22:00"')
  process.exit(2)
}
// Fail closed on a missing or stale build: bench numbers must come from the
// current sources, never from a bundle an older tree produced.
try {
  assertBuildFresh(CLIENT_INDEX)
} catch (error) {
  console.error(`bench: ${error.message}`)
  process.exit(1)
}

const server = spawn(process.execPath, ['scripts/serve-static.mjs', '--dir', 'build/client', '--host', '127.0.0.1', '--port', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
let browser
let failed = false
try {
  await waitForOwnServer(server)
  await waitForServer(`http://localhost:${PORT}/`)
  browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
  for (const run of runs) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`http://localhost:${PORT}/?perf=base${run ? `&${run}` : ''}`)
    await page.locator('canvas[data-assets="drawn"]').waitFor({ timeout: 60_000 })
    const bursts = []
    for (let i = 0; i < BURSTS; i++) {
      const result = await page.evaluate((frames) => window.foliaBench?.(frames), FRAMES)
      if (!result) throw new Error('window.foliaBench is missing: is ?perf=base still wiring the HUD?')
      bursts.push(result)
    }
    const ms = median(bursts.map((b) => b.ms))
    const cpu = median(bursts.map((b) => b.cpuMs))
    // Spread across bursts (D-075, fol-kes.16): the range (and stddev) the
    // median hides. Above the threshold the run measured noise, not the
    // scene, so the verdict refuses it before judging the budget.
    const wall = bursts.map((b) => b.ms)
    const range = Math.max(...wall) - Math.min(...wall)
    const mean = wall.reduce((a, b) => a + b, 0) / wall.length
    const stddev = Math.sqrt(wall.reduce((a, b) => a + (b - mean) ** 2, 0) / wall.length)
    const counts = (await page.locator('.perf-readout').textContent())?.split('\n').pop()
    // The budget binds the shipped default only (D-063); other knobs are
    // comparison levers, so their verdict is advisory. `time=` stays gated —
    // the budget holds at both keyframes — and `stress=0` adds no load.
    // Spread follows the same split: a noisy default run fails, a noisy
    // knob run only warns.
    const advisory =
      /(^|&)(aa|bloom|reflection|fit|shadows|sway)=/.test(run) || /(^|&)stress=[1-9]/.test(run)
    const over = ms > SATURATED_BUDGET_MS
    const noisy = range > BENCH_SPREAD_THRESHOLD_MS
    console.log(
      `${run || '(default)'}: ${ms.toFixed(2)} wall ms/frame · js ${cpu.toFixed(2)} · spread ${range.toFixed(2)} (sd ${stddev.toFixed(2)}) · ${counts} · budget ≤${SATURATED_BUDGET_MS.toFixed(2)}: ${over ? 'FAIL' : 'PASS'}${advisory ? ' (advisory)' : ''} · spread ≤${BENCH_SPREAD_THRESHOLD_MS.toFixed(2)}: ${noisy ? (advisory ? 'NOISY (advisory)' : 'NOISY') : 'ok'}`,
    )
    if (!advisory && over) {
      failed = true
      console.error(`  over budget: ${ms.toFixed(2)} > ${SATURATED_BUDGET_MS.toFixed(2)} wall ms/frame`)
    }
    if (noisy) {
      const note = `spread ${range.toFixed(2)} > ${BENCH_SPREAD_THRESHOLD_MS.toFixed(2)} wall ms/frame across ${BURSTS}×${FRAMES} bursts: close other scene tabs and re-run`
      if (advisory) console.error(`  noisy (advisory): ${note}`)
      else {
        failed = true
        console.error(`  noisy: ${note}`)
      }
    }
    if (errors.length > 0) {
      failed = true
      console.error(`  page errors: ${errors.join(' | ')}`)
    }
    await page.close()
  }
} finally {
  await browser?.close()
  server.kill()
}
process.exit(failed ? 1 : 0)

async function waitForServer(url) {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`static server never answered on ${url} — is port ${PORT} taken?`)
}

function waitForOwnServer(server) {
  return new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error(`static server startup timed out: ${output}`)), 10_000)
    const fail = (error) => {
      clearTimeout(timeout)
      reject(error)
    }
    server.on('error', fail)
    server.on('exit', (code) => fail(new Error(`static server exited ${code}: ${output}`)))
    server.stderr.on('data', (chunk) => { output += chunk.toString() })
    server.stdout.on('data', (chunk) => {
      output += chunk.toString()
      if (output.includes('serve-static: listening')) {
        clearTimeout(timeout)
        resolve()
      }
    })
  })
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
