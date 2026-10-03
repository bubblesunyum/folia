# Code review: Phase 1 polish, the bug rounds and slice exit

Oct 3, 2026 · principal-engineer review of the 33 commits landed since the Sep 30 review (`e63653e`..`fc42105`): every source diff in `src/**`, `assets/pipeline/**` and `scripts/{budget,bench,twin-data,serve-static}.mjs` plus `scripts/lib/fresh-build.mjs`, the Blender sway and trailer changes, the default gate lane, and the golden-hour, night and panel captures. Reviewed against `spec.md` (Phase 1 exit and Phase 2), `decisions.md` (D-001–D-063) and the art pillars.

Not read: the Blender trailer, forum and export bodies past their headers; the dashboard and harness scripts; the e2e specs; the MDX remark plugin body; `styles.css`; the lockfile. The bench was not re-run, and `--full` was not run. The memory and cost figures below are calculated, not measured.

**Gate:** the default lane passed (456 unit, budget ok: shell 114.2 KB gz, canvas 370.1 KB gz, cortico 2.43 MB / 202,472 tris).

**Verdict:** solid work, but not ready for breadth. One bug is visible at night, two systems break once breadth starts streaming assets and adding motion, and none of the span's decisions reached the decision log.

Each finding names the bead that carries it. A finding marked *latent* is correct today and breaks as breadth arrives.

## P1: before or during the next piece of work

1. **Light pools land on roofs and open lawn** → fol-kes.4.
   - The night captures show orange pools on the voronoi canopy's roof, on the lotus petals, and loose on the grass by the east path.
   - `LightPools.tsx` grounds each pool on the first cream, gold or ground hit straight down; the 7.5 m ring passes under the canopy.
   - It also waits on the `data-drawn-assets` test hook as production readiness, and casts ~40 rays over ~200k triangles at load.
   - Fix: author pool spots in the asset's layout file at bake (the pedestal-anchor precedent) and delete the runtime raycast.
2. **Hit-volume picking reads deleted geometry** → fol-kes.5, gated on the decision fol-kes.2 (needs @bubbles). *Latent.*
   - `pickSlot.ts` scans each batch's whole buffer. `BatchedMesh.deleteGeometry` doesn't zero freed ranges, so an unmounted asset stays pickable until `optimize()`. Instance matrices and `setVisibleAt` are ignored; the old raycast respected both.
   - Memory: a full-resolution world-space triangle soup (~36 B/tri, ~7 MB now), rebuilt on the first pick after any registry change.
   - It contradicts the spec, which puts hit volumes in `export_extras` and picks Cortico at `/` through one invisible hit volume. Authored proxies or fixed derived volumes is @bubbles' call.
3. **Ambient motion contradicts Phase 2** → fol-kes.3 (decision, needs @bubbles), fol-kes.6, and fol-ixw now waits on fol-kes.3.
   - Phase 2 wants swaying trees with idle and reading at ~30 fps. Sway is `?sway=on` only, and the ripple never invalidates, so on the default build it moves only inside frames something else causes.
   - The clock advances only on frames, so the first frame after idle jumps the ripple by the whole gap: likely fol-ixw's "rest pose varies across loads".
   - Ripple drift is ~0.1 m/s against ~1.8 m noise features, so a short probe sees almost nothing even with frames running. Check this before a shader redesign.
4. **Breadth has no perf or delivery budget, and the headroom is mostly spent** → fol-kes.1 (decision, needs @bubbles), fol-cs8.
   - The slice exit moved 1.90 → 2.09 ms at golden hour against D-063's 2.5 ms, leaving ~0.4 ms for all of breadth.
   - Cortico is 2.43 MB, 97% of its 2.5 MB allowance, before the rest of Cortico exists.
   - The day pond mirror redraws every opaque batch, so daytime geometry roughly triples and scales with the town.
   - The shell cap moved 100 → 140 KB and the slice-exit bench ran, but neither is in the decision log.

## P2: settle before it scales

5. **Window bands assume world-baked geometry** → fol-kes.7. They read local `position` as world, while height fog walks the batch and instance path. Instanced housing would repeat one window pattern per copy. One shared world-position varying for fog, windows, reveal and foliage. *Latent.*
6. **The day mirror scales with the town** → fol-kes.8, after fol-kes.1. Limit it to batches near the pond, or a cheap proxy. *Latent.*
7. **Content ships twice to every importing chunk** → fol-kes.9. Two eager MDX globs (raw and compiled) inline every content file. Trivial at 1.2 KB, linear with real copy. Make the body glob lazy, per route. *Latent.*

## P3

- Night look pass → fol-snu.5:
  - the moon rim composes into the base lit set, so lawn and foliage rim too, though its comment says hero forms;
  - the sway ramp is absolute metres (0.5–2.5 m), so meadow clumps peak at ~0.4 weight and trailers at ~0.16;
  - the vantage shadow fit went ±8 → ±16 m, halving hero shadow sharpness;
  - the foliage shadow gate samples the shadow map a second time per leaf fragment.
- Cleanups → fol-5pr (`local-ok`):
  - a dead `ground` assignment in the sky gradient;
  - the registry fingerprint copied between `LightPools` and `pickSlot`;
  - route files still named for Cortico while serving every project;
  - a stale size comment in `budget.mjs`.

## Other

- None of the span's decisions were logged → fol-cs8. That covers height fog landing, 32 groups, the hit-volume approach, the day mirror, window bands, light pools, the shadow-fit change, the shell cap and the slice-exit numbers. D-063 still names `dist/`.
- Phase 1 was ticked with the beauty-check density gap ("a dozen blob trees vs a spilling jungle") deferred. Note it on the checklist so breadth inherits it (fol-cs8).
- Breadth now has an epic, fol-kes. Its three decisions (fol-kes.1–.3) come before the town skeleton.

## What's working, and worth repeating

Merged into the "Patterns worth repeating" section of `CLAUDE.md`.

- Fail-closed derivation: one build-freshness check shared by budget and bench, a shell measurement read from the router manifest, and pedestal slots and anchors derived from the manifest and the layout file with drift checks.
- Every new shader term (foliage back-light, height fog, moon rim, window bands) has a plain TypeScript mirror pinned in Vitest.
- The sky and the fog share uniform objects, so one write recolors both with no recompile.
- The overnight shadow freeze moves only the update flags, respecting the recompile trap.
- E2E runs against a static server that mimics Vercel, with direct-load tests.
