# Code review: Phase 1 vertical slice and the stable-state rounds

Sep 30, 2026 · principal-engineer review of the 44 commits landed that day (`97da5b5`..`7c0fc95`): every source diff in `src/**`, `assets/pipeline/**` and `scripts/{budget,bench,check-ssr-boundary}.mjs`, the gate run in both lanes, and the golden-hour, night and panel captures. Reviewed against `spec.md`, `decisions.md` (D-001–D-063) and the art pillars.

Not read: the harness scripts (dashboard, model probes, agent runner, brief) beyond a skim; `styles.css`; most e2e specs; the Blender `forms.py`, `terraces.py` and meadow scripts; the content schema and markdown parser beyond a skim. The bench was not re-run, and the memory and raycast costs below are calculated or inferred, not measured.

**Gate:** the default lane passed (321 unit). `--full` failed 6 of 33 e2e; all 6 passed when re-run alone.

Each finding names the bead that carries it. A finding marked *latent* is correct today and breaks as breadth arrives.

## P1: before the next piece of work

1. **The size budget measures a build from before the router** → fol-3qa.
   - `budget.mjs` reads `dist/`, last written at 15:18, before the React Router move; the build now lands in `build/client`. The "shell 69.8 KB, ok" readout is stale.
   - Real shell-side JS is ~117 KB gz (upper bound), over the 100 KB cap, and is now many chunks, so the "exactly one `index-*.js`" rule no longer fits.
   - `bench.mjs` guards on the same stale `dist/index.html`.
   - Fix: point both at `build/client`, sum the initial-route chunks, fail closed on a build older than the sources, delete `dist/`.
2. **E2E is effectively unguarded.**
   - The starter pickup made `AGENTS.md` and the `verify.sh` header say `--full` equals the default, but `verify.steps.sh` runs e2e only under `--full` → fol-9r3. Keeping a local fix stable across starter updates is har-v6s in harness-starter.
   - Under `--full`, 6 of 33 fail from load on parallel SwiftShader → fol-u9i. Cap the workers.
3. **The wisp redraws every frame while a case is open** → fol-p8k. `WispLight` invalidates unconditionally for its bob, so the longest dwell state renders at display rate, against D-056. Put the bob on the 30 Hz ambient clock and add a panel-open idle-rest e2e.
4. **Town batches over-allocate ~16×** → fol-3w2. Capacity assumes 3 vertices per triangle; the GLBs carry 0.74. That is ~100 MB GPU plus a CPU mirror for ~6 MB of geometry. Size from vertex and index counts written to the manifest.

## P2: before breadth

5. **Pedestal slots are literals pinned to themselves** → fol-ihd. The allocator now reuses freed slots, so a forum rework can silently remap clicks. Read them from `groupSlots`.
6. **Placement is hand-copied in three places** (forum centre, pedestal anchors, fragment terrace) → fol-bll. Export anchors at pack. *Latent.*
7. **`MAX_GROUPS` is still 16, with 11 used** → fol-6if. fol-l1r.9 closed as surviving breadth, but one more forum-sized asset throws at pack. *Latent.*
8. **Sway ramps on world height** → fol-a83. Batches are world-baked, so terrace foliage sways from its base. Bake a per-vertex weight. *Latent.*
9. **The registry never compacts** → fol-k2r. Deletes leave holes and growth doubles. Call `optimize()` before growing. *Latent.*
10. **Picking raycasts every triangle in town** → fol-hft. Unmeasured; grows with breadth. Use D-021's hit volumes. *Latent.*
11. **A new case touches four hand-kept lists** → fol-ya7. Glob the content and derive the prerender list. *Latent.*
12. **The spec checklist and the ledger disagree** → fol-b41 (needs @bubbles). Phase 1 boxes are unticked though the epic closed; height fog has no consumer (now fol-snu.4), "MDX" is a markdown subset, and the beauty check filed ~8 backlog deficits.
13. **fol-dnq is the trailing-slash trap, not an app bug** → fol-dnq (retitled). Reproduced: `/cortico/platform` breaks under `vite preview`, `/cortico/platform/` works. Serve e2e like Vercel and test direct loads, the way shared links arrive.

## P3

- Close pushes `/cortico`, so Back reopens the panel → fol-e6h.
- `ZoomRig` reads reduced motion itself instead of the shared reader → fol-582.
- The panel's `data-variant` stays "side" after a direct load on a phone → fol-d96.
- Hover writes test hooks and allocates every frame → fol-o3v.
- A keyframe without fog silently gets a default → fol-egb.
- The pipeline lock grew from ~10 to ~100 lines; consider something smaller → fol-alg.

## Other

- About a quarter of the day's churn was harness (~2.7k lines), mostly the starter pickup, and that pickup caused finding 2. Diff project overlays against contract prose whenever the starter lands.
- The pixels: golden hour reads as a flat teal void and night foliage goes black (fol-snu). The slice closed on mechanism, not beauty.

## What's working, and worth repeating

Merged into the "Patterns worth repeating" section of `CLAUDE.md`.

- Pure core, thin rig held under pressure: the town registry, the panel dolly, the Escape resolver and the reflection skip are small, tested and three-free.
- Classifying batches by material identity, not name, made the reflection immune to renames and nesting.
- The registry registers all-or-nothing and disposes replaced meshes only after React commits.
