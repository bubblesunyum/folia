@AGENTS.md

# Portfolio Town (folia)

A 3D solarpunk-town portfolio site built with React Three Fiber. Beauty is the
success test, and speed is a requirement alongside it, never traded against it.

## Read before working
- **[docs/spec.md](docs/spec.md)**: the build spec and the milestone checklist. Milestone 1 runs spikes → vertical slice → breadth (D-049).
- **[docs/decisions.md](docs/decisions.md)**: the decision log. Don't contradict an entry without raising it with @bubbles first. A new decision gets the next `D-0xx` entry, and a replaced one is marked `Superseded by D-0xx`, never deleted. Each spike ends by logging its result there.
- [docs/art-direction/README.md](docs/art-direction/README.md): the look, the reference boards and the art pillars.
- [docs/research/](docs/research/): research notes with sources. Where they conflict with `decisions.md`, the decisions win.
- [docs/reviews/](docs/reviews/): expert reviews of the plan and of the code. Adopted plan findings are recorded as decisions (D-030 onward), and code findings as beads named in the review. The `principal-review` skill writes a new one.

## Stack
Vite + React Router v8 (framework mode, `prerender`, fully static), R3F 9 + drei + pmndrs postprocessing on WebGL2 (three r186), TypeScript strict, pnpm, Vitest, Playwright, Biome, Vercel. Geometry comes from headless Blender scripts in `assets/blender/**`, pinned by `assets/blender/VERSION` (Blender 5.2 LTS lives at `/Applications/Blender.app/Contents/MacOS/Blender`; it isn't on PATH).

## Standards
- **Geometry is generated.** Change the params JSON or the script and re-export; a Blender MCP may tune params, not meshes. Hand-modeling is an escape hatch for hero pieces only (D-001, D-002, D-034).
- **One palette.** Colors come from `palette.ts`, shared by the materials and the panel CSS (D-024). No hex literals elsewhere.
- **Shared materials, features injected.** Architecture and props use the 6–8 shared materials, with features injected through the material composer (`onBeforeCompile`), shadow-depth materials included. The decided special surfaces have their own programs: water, the cream ocean, neon and fake glow, fake glass, hero clearcoat, the env-scene sky (R-005, D-018, D-038, D-039, D-040, D-050).
- **Mesh names are `<hood>.<object>.<material>.<lod>`** (D-034).
- **Tests:** Vitest for pure logic (the time-of-day gradient, tier ladder, content schema, attribute validator). Playwright for routes and screenshots. Visual changes need a capture at golden hour and at night, written to `/tmp/fol-<name>.png` so `scripts/review.sh` hands it to the design reviewer.
- **UI copy:** one-word labels, spacing instead of rules, no eyebrow kickers, in-world before flat chrome (spec: design rules).

## Patterns worth repeating
These have paid off (review 2026-09-29), so new systems should follow them.
- **Pure core, thin rig.** Logic lives in plain modules with Vitest (`zoomModel`, `sources`, `shadowFit`, `look.ts`); the R3F component only wires events and uniforms.
- **Spikes end with numbers.** A cost table goes in the decision entry, measured on the `?perf=base` proxy.
- **Fail closed.** Gates and pipeline steps throw on a contract break rather than degrade quietly: the SSR-boundary step, pack's `_ID` remap, the manifest lock, inert shader defaults.
- **Render on demand (D-056).** Anything that animates goes through one scheduler and keeps the e2e idle-rest test green.
- **URL switches are the tier ladder in waiting.** `?bloom=off`, `?reflection=off` and `?shadows=static` become D-036 tier inputs, not a second system.
- **Tests wait on state, not time.** E2E reads `data-*` flags the app sets; it never waits on a timeout.

## Traps that are already known
Each of these is a decision because it has bitten someone before.
- Never toggle `renderer.shadowMap.enabled` at runtime: it recompiles every program. Shadow tiers set intensity to 0 instead (D-043, D-036).
- No `discard` in shared materials; the reveal is a color and roughness blend (D-044).
- No `transmission` glass, no hemisphere light next to the env map, no selective-bloom passes, no DPR above 2 (D-050, D-040, spec: Performance, D-036).
- No gltf-transform `instance()` on anything headed into a `BatchedMesh`, and batched geometry is dequantized to Float32 at load (D-033).
- `<Canvas flat gl={{ antialias: false, alpha: false }}>`. Tone mapping belongs to the composer (D-043).
- three and R3F stay out of the SSR module graph (D-047).
- Vercel Brotli-compresses `.glb` (D-059 retired the old no-compression premise; no workaround).
- GLBs are in Git LFS (D-062). A clone without git-lfs gets pointer files, and `pnpm assets:check` says so.
- Perf is judged with the saturated-frame benchmark under `?perf=base` against ≤2.5 ms wall on the Max (D-063); timer-query GPU ms in the HUD is indicative on Metal.
