# Code review: the breadth decision round

Oct 4, 2026 · principal-engineer review of the 18 commits landed since the Oct 3 review (`2cc35f5`..`2bf6746`): every source diff in `src/**`, `assets/pipeline/**`, `assets/blender/cortico/fragment.py`, `scripts/budget.mjs`, `vite.config.ts` and the changed e2e specs, the decision entries D-064–D-074, the three handoffs, the default gate lane, and the golden-hour and night captures. Reviewed against `spec.md` (Phase 2) and `decisions.md`.

Not read: the bodies of `lightPoolPlacement.test.ts`, `hitVolumes.test.ts` and `worldPosition.test.ts`; the frontmatter strip's tests; the generated `fragment-layout.json` past its header. The bench was not re-run and `--full` was not run. The client-navigation and ambient-cadence findings are inferred from code, not reproduced.

**Gate:** the default lane passed (506 unit, budget ok: shell 114.5 KB gz, canvas 375.0 KB gz, cortico 2.43 MB / 202,472 tris).

**Verdict:** clean code and a well-kept decision log, but one pipeline bug, one dropped test guard, and no Phase 2 feature built. The span settled the decisions breadth was waiting on; the breadth work itself has no beads yet.

Each finding names the bead that carries it. A finding marked *latent* is correct today and breaks as breadth arrives.

## P1: before or during the next piece of work

1. **The fragment bake rewrites its own hashed input** → fol-kes.10.
   - `fragment.py` writes `fragment-layout.json` every build; `assetSources` hashes any `<asset>-layout.json` as a source, and `buildAsset` takes the hash before Blender runs.
   - Retune `pools.spacing` and build once: the manifest records a hash over the old layout, Blender rewrites it, and `assets:check` reports stale until a second build. The dev watcher double-builds; a failed pack leaves the layout changed and the GLB not.
   - Fix: name the generated file outside the source rule, or write it from `build.ts` after a successful pack.
2. **The idle-rest guard is gone for the still path** → fol-kes.11.
   - "The scene rests while idle" became "redraws when the camera moves"; the `?sway=off` test checks only that the ambient attribute is absent, never draw calls.
   - A stray invalidate loop would now pass every test. Restore zero draws at rest under `?sway=off` and bound default-path draws by ambient frames.
3. **Phase 2 has no beads** → fol-kes.18. `fol-kes`'s nine decision children are closed and the epic is the only ready bead.

## P2: settle before it scales

4. **Client navigation likely shows an empty body until the chunk loads** → fol-kes.12. Body warming runs in server loaders; fully static prerender has no `clientLoader`, so client navigation renders the lazy wrapper behind `fallback={null}`. The comments claim otherwise. Verify with an e2e, then add a `clientLoader` that warms and calls `serverLoader()`.
5. **The night lost its warm counterpoint** → fol-snu.6, after fol-kes.10. The bake keeps pools a full radius inside the terrace edge: 5 pools, about 2 visible. Night reads mint on navy, against D-068.
6. **The ambient clock likely drops ticks** → fol-kes.13. A 34 ms interval against a strict 33.3 ms due check skips a frame on any early fire, the likely cause of the 22–26 Hz probe. The faster ripple makes the stepping visible.
7. **Picking and the day mirror rescan the town per call** → fol-kes.14. *Latent.* The picking fingerprint walks, allocates and string-joins every instance per pick; the mirror scans every instance per frame using exceptions for liveness and toggles `setVisibleAt` around the draw (two draw-list rebuilds a frame). Cache on a `TownRegistry` version.
8. **Light pools sit outside lift, reveal and fog** → fol-kes.15. *Latent.* Hovering Cortico at night hides them under the lifted terraces, the reveal will show them early, and spots are fragment-local.
9. **Bench noise exceeds the headroom** → fol-kes.16. Golden read 2.17, 2.58 and 2.25 within the span with no new geometry, against ~0.25 ms of headroom; the 2.09 → 2.25 rise is unexplained.
10. **Ambient frames are full frames** → fol-kes.17. ~25 Hz idle redraws the shadow map and reflection pass, the fan problem D-056 was written for. Skip the shadow update when only the clock moved (a flag flip, never `shadowMap.enabled`).

## P3

11. The water tint TS mirror hand-copies the shader constants → fol-snu.7.
12. The ambient rig writes two canvas data attributes every tick in production → fol-snu.8.
13. `LightPools` bundles the whole 17 KB layout file, outlines included → fol-snu.9, after fol-kes.10.
14. `spec.md` still says Vercel doesn't compress `.glb` (retired by D-059) → fol-snu.10.

## What's working

- **A declared requirement between features.** One shared world-position varying, and the composer throws when a consumer is composed without it — the reading feature declares nothing, so the program carries one declaration.
- **Bake-time placement gated on owner identity.** Pool spots come from the bake, and the rig enables them on asset registration, never batch names or a test hook.
- **Draw-pass state restored in `finally`.** The mirror pass restores render target, clear color, shadows, materials and visibility even when the draw throws.
- **Decision entries that separate built from decided.** D-064–D-071 record the span as fact and name the open bead; D-072–D-074 record the calls with numbers.

## Other feedback

- **Ceremony outweighed product.** About a third of the commits are ledger-sync and audit bookkeeping; account usage went 56→96% and 21→79% against an under-20% aim, with no breadth feature landed.
- **Recommended order** (carried in fol-kes.18): fix the P1s and the navigation flash; town skeleton with per-neighborhood placement first, since hover, flights, the mirror scope and pools all assume Cortico at the origin; then the mid/high LOD split and its budget check; fix bench noise before the rest of Cortico (the density gap); then camera with the fol-j08 device check, reveal with warm-up, tiers and context loss, forest edge.
