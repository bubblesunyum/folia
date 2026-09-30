# Code review: Milestone 1 spikes 4–7 and pipeline hardening

Sep 29, 2026 · principal-engineer review of the 27 commits landed that day (`3c7cd51`..`548b4a2`): every source diff in `src/**`, `assets/pipeline/**`, `scripts/check-ssr-boundary.mjs` and `e2e/**`, plus the golden-hour and night captures. Harness scripts were skimmed only. Reviewed against `spec.md`, `decisions.md` (D-001–D-061) and the art pillars.

Each finding names the bead that carries it. A finding marked *latent* is correct today and breaks as breadth arrives.

## P1: before or during the vertical slice

1. **Per-asset batches contradict D-032's town-wide batches** → fol-l1r.7.
   - `BlenderAsset` builds its own `BatchedMesh` per material for each asset, about 7 per asset plus the glow shell. Calls scale as assets × materials, and the shadow and reflection passes multiply them. Around 15 assets blows the ~100-call budget.
   - `WaterReflection` finds the pond with `getObjectByName('water')` and walks only `scene.children`. A second water batch, or batches nested inside a group, break it silently.
   - Fix: a town-level registry that assets add geometry into, with LOD swaps through `setGeometryAt`. It lands with the persistent canvas.
2. **The shell-to-canvas handoff flashes and drops the page's content** → fol-l1r.8.
   - The shell's light sky gradient cuts to the env's dark-green ground hemisphere at the look-dev camera.
   - `App` unmounts `SkyShell` on the first frame, taking the only `<main>`/`<h1>` with it.
   - Fix: hide only the gradient layer, keep the content layer mounted, and crossfade into a color-matched first frame.
3. **The asset hash is over-broad** → fol-4b5.
   - `assetSources` hashes all of `palette.ts` and all of `features.ts`. `features.ts` is there only for `MAX_GROUPS`, and Blender reads only `palette.mint`.
   - Result: any shader tweak or sky-color save re-exports every asset through Blender and commits a new GLB.
4. **iPad pinch likely double-counts** → fol-crx.
   - iOS Safari fires `gesturechange` for touch pinches alongside the pointer events that `ZoomRig` already tracks.
   - Fix: ignore gesture events while two touch pointers are down.
5. **The zoom rig keeps stale state and jumps** → fol-etn.
   - `ensureState` caches the camera distance once, so any other camera move makes the next zoom snap back.
   - Key and button steps jump 4 m with no easing.
   - Fix: re-read the distance per event, have the model emit a target that the rig eases toward, and make the detent give visibly.

## P2: design debts before breadth

6. **16 append-only global group slots won't survive the town.** One fragment already uses 5, and renames leak slots. Build D-032's data-texture path inside the material-system bead → fol-l1r.9 (blocks fol-l1r.2).
7. **No ambient-motion clock.** `Sway` invalidates every frame at display rate, against the spec's ~30 Hz at rest. Build one scheduler that owns the shader time uniforms before a second animated thing arrives → fol-s6f (blocks fol-ixw).
8. **The water pass always runs.** Skip it when the pond is off-frustum or `look.night` is near zero. The ripple costs ~24 `sin` per pixel: fine for a pond, but the river wants a baked normal texture → fol-4zo.
   - Beauty: the ripple reads as regular teal stripes, and in daylight the pond reflects none of the architecture. Drawing the occluders with a cheap lit color at golden hour would fix that → fol-snu.2.
9. **fol-779 must not toggle `castShadow`.** A change in the shadow-casting light count recompiles every program. Set `autoUpdate = false` with one final `needsUpdate` at daylight zero instead (a note is on fol-779).
10. **Two geometry bugs appear with instancing** (*latent*) → fol-esq.
    - `neonGlow` inflates along a batch-space normal added to object-space `transformed`, so a rotated instance gets a skewed shell.
    - Sway takes its phase from local `position` and has no height weight, so instanced trees would sway in lockstep and their trunks would slide.
11. **The SSR-boundary walker is 305 lines of regex parsing.** Check Vite's build manifest or use `es-module-lexer` once the React Router entries exist → fol-s4f.
12. **`ZoomRig` owns a global Escape.** Route keys through one intent layer before the panel's Close lands → fol-l1r.10 (blocks fol-l1r.5).

## P3

- Test hooks are scattered across production code (`dataset.zoom/sun/rises/rendered`, `window.foliaRiseCount`). Centralize them → fol-di2.
- Hex fallbacks in `styles.css` and `index.html` repeat the palette. Emit CSS vars at prerender instead (D-024) → fol-95g.
- `snapShadowToTexels` accumulates target drift across sun changes → fol-jc9.
- The manifest lock has no heartbeat, so a pack slower than 30 s could lose it to a waiter → fol-nnr.

## Other

- Night reads as one navy tone, with black foliage. It needs a warm counterpoint → fol-snu.3 (pairs with fol-2rl, fol-0sj).
- Committed GLBs grow the repo by a blob per rebuild. How to store them is an open decision → fol-7fm.
- About a third of the day's commits were harness work, mostly edge cases in the ledger export. Timebox it while the slice is in flight.

## What's working, and worth repeating

These became the "Patterns worth repeating" section of `CLAUDE.md`.

- Pure modules with thin R3F wrappers (`zoomModel`/`sources`/`ZoomRig`, `shadowFit`, `look.ts`), unit-tested in Vitest.
- Spikes that end with measured cost tables in `decisions.md`.
- Fail-closed guards: the boundary gate, pack refusing unmapped `_ID`s, the manifest lock, inert shader defaults.
- Render on demand (D-056), with an e2e test proving it.
- URL switches (`?bloom=off`, `?reflection=off`, `?shadows=static`) that are really the quality tiers waiting for the D-036 ladder.
- E2E tests that wait on `data-*` state rather than timeouts or pixels.
- Visually: the golden-hour dappled shadow under the canopy and the gold-trimmed cream shell match the boards.
