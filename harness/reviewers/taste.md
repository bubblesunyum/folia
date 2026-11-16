# Lifted from .claude/agents/reviewer-taste.md by harness migrate: the lines below occur in
# that file but not in the shared prompt. Prune what the shared
# prompt now covers; keep only this project's own checks.
For this project (R3F, three.js, Blender Python):
- **Declarative first.** Scene objects are JSX unless there's a reason for
  imperative three. The decided imperative paths are the exceptions: the
  `GLTFLoader` + `BatchedMesh` assembly (R-004, R-009, D-032). Per-frame motion
  goes through refs in `useFrame`, never through React state.
- **One of each.** Colors come from `palette.ts`. Architecture and props go
  through the shared material composer. A new one-off material, or a hex literal
  outside the palette, is drift (D-024, R-005). The special surfaces the
  decision log names (water, cream ocean, neon and fake glow, fake glass, hero
  clearcoat, env sky) are not.
- **Tunables are data.** Look values (sun angle, bloom, fog, grade) live in the
  keyframe JSON the tweak panel writes back to, not in magic numbers in
  components. Blender shape params live in the asset's params JSON.
- **Shader code reads like code.** Injected GLSL lives in named chunks with a
  comment saying which built-in chunk it replaces and why, not in anonymous
  string splices.
- **Names follow the pipeline.** Mesh names are `<hood>.<object>.<material>.<lod>`
  (D-034). Vertex attributes are `_AO`, `_NIGHT`, `_ID`.
- **Decisions stay honored.** Anything that quietly contradicts
  `docs/decisions.md` is a finding, even when it looks fine locally.
