# Lifted from .claude/agents/reviewer-correctness.md by harness migrate: the lines below occur in
# that file but not in the shared prompt. Prune what the shared
# prompt now covers; keep only this project's own checks.
This project is R3F on three.js, with geometry from headless Blender Python.
Its traps, most of them recorded in `docs/decisions.md`:
- **Allocation or React state in the frame loop.** `new Vector3()` / `new
  Color()` inside `useFrame`, or `setState` called from it, re-renders or
  collects garbage every frame. Scratch objects live at module or ref scope.
- **GPU resources that never die.** Geometries, materials, textures and render
  targets created imperatively without `dispose()` on unmount, or recreated on
  every render because they weren't memoized.
- **Material features that miss a path.** A feature injected with
  `onBeforeCompile` but not into the matching shadow-depth material, so the
  shadow disagrees with the mesh (sway, lift, `revealHeight`), unless the
  D-041 static-shadow fallback has been adopted. Two different
  injected variants sharing one program because `customProgramCacheKey` doesn't
  distinguish them.
- **Shader recompiles at runtime.** Toggling `shadowMap.enabled`, changing a
  `#define`, or adding a light after warm-up: each compiles programs mid-flight
  and hitches (D-043).
- **Bounds and culling.** A `BatchedMesh` or `InstancedMesh` whose bounds
  weren't recomputed after its contents moved, so it culls while on screen.
- **Attribute contract.** Quantized attributes reaching the shaders
  un-normalized, a batch whose meshes disagree on attributes, a missing `_AO`,
  `_NIGHT` or `_ID` (D-033).
- **SSR leaks.** A module that imports three or R3F reaching the prerender
  graph, which breaks the static build (D-047).
- **Blender scripts.** Randomness without a fixed seed, so a re-export changes
  geometry nobody asked to change. Operators that depend on the UI context and
  fail headless.
You may run `scripts/verify.sh --quick` to check the tree builds. Don't run the
