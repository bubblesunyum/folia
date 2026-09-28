# R3F / WebGL2 performance best practices for Folia (researched Sept 2026)

Scope: the stylized solarpunk portfolio town. It uses a fixed-yaw, long-lens perspective camera, about 9 streamed neighborhoods, a forest out to the horizon, 6–8 shared `MeshStandardMaterial`s extended by shader injection, one dynamic sun, a procedural-sky PMREM, one bloom pass and stylized water. Targets are 60 fps on a base M1/M2 Air, fewer than 100 draw calls, a first meaningful frame in under 1.5 s and an initial download under 3 MB.

> **Note (2026-09-27):** several recommendations here were revised by the [spec review](../reviews/2026-09-27-spec-review.md) and recorded as D-030 to D-050 in [decisions.md](../decisions.md). The main ones: merge unique architecture rather than instancing a kit (D-032); the quantization volume does not set attribute layout (D-033); the env cube is 256 px with no hemisphere light (D-040); shadows re-render per frame (D-041); the AA choice is spiked (D-042). Where this doc conflicts with the decision log, the log wins.

Where this doc says "verified in source", I read the published npm package or the GitHub API directly on 2026-09-27. Everything else links to its source inline.

---

## Recommendations (summary)

| # | Topic | Recommendation |
|---|---|---|
| 0 | **Renderer** | Stay on **`WebGLRenderer` (three r186) + R3F v9.8 + pmndrs `postprocessing` 6.39.x**. `WebGPURenderer`/TSL is real, but R3F v10 and drei v11 are still alpha. pmndrs postprocessing, `onBeforeCompile` and `ShaderMaterial` do **not** run on `WebGPURenderer`, even on its WebGL2 fallback. Write shader injections as small, self-contained GLSL snippets so a later TSL port is mechanical. |
| 1 | **Instancing** | Use **`BatchedMesh`, one per shared material**, for the building/prop kit. That comes to about 6–8 draws in the main pass, plus the same again in the shadow pass. Store per-instance color with `setColorAt`. Store extra per-instance data (hover, reveal, seed) in a small `DataTexture` indexed by `getIndirectIndex(gl_DrawID)`. Keep `InstancedMesh` for trees (one geometry, thousands of instances). Avoid drei `<Instances>`/`<Merged>` for the town: they cost one draw per mesh and have per-frame CPU overhead unless `frames={1}`. |
| 2 | **Forest** | Use three bands. **Near:** instanced low-poly trees with vertex-shader sway, 2 LODs, 3–4 species, chunked or `InstancedMesh2` for culling. **Mid:** a *single-view* normal-mapped impostor card, because the fixed yaw means you don't need octahedral impostors. **Far:** one noise-displaced "canopy skirt" mesh that fades into height/distance fog tinted from the sky gradient. |
| 3 | **Shader injection** | Use **`onBeforeCompile`** behind a tiny in-house "feature composer" (chunk replacements plus `customProgramCacheKey`). Apply the same injection to `customDepthMaterial` so sway and dissolve affect shadows. `three-custom-shader-material` 6.4 is fine but not needed. TSL isn't an option on this stack. |
| 4 | **Post** | Use `@react-three/postprocessing` **≥3.1.3** / `postprocessing` 6.39.5 (supports three <0.187). Configure `<Bloom mipmapBlur luminanceThreshold≈1 levels 5–6>`: mipmap bloom is already half-res at its first mip, and `resolutionScale` is deprecated/ignored in that mode. Use **Khronos PBR Neutral** tone mapping (`ToneMappingMode.NEUTRAL`) as the last effect. **Set `multisampling` explicitly** (the default is 8). Use MSAA 4× at DPR ≤1.5 and no AA or SMAA at DPR 2. |
| 5 | **Shadows** | Use **one `DirectionalLight` with a hand-fitted, texel-snapped ortho camera** around the ground footprint of the view frustum. Update it only when the camera or sun moves. You don't need CSM for a long-lens top-down view. The new `SunLight` addon (r186, 2 cascades) is an option for the far zoom-out only. Map size per tier: 1024 / 2048 / 4096. `PCFSoftShadowMap` has been removed; use `PCFShadowMap`, which is now soft. |
| 6 | **Env map** | Render the sky gradient into a small cube target (64–128 px). Then call `pmrem.fromCubemap(tex, reusedTarget)` only when the sun moves by more than about 1°, not every frame. Drive diffuse ambient from a `HemisphereLight` whose colors come from the same gradient, which costs nothing per frame. |
| 7 | **Assets** | Use a custom `gltf-transform` API script: `dedup → instance → prune → weld → (no simplify/join/palette for kit pieces) → meshopt(quantize, scene volume)`. Prefer **Meshopt over Draco**: about 7 KB vs about 59 KB decoder (brotli) and it keeps quantized VRAM. **Consider skipping KTX2 entirely**: the basis transcoder is about 217 KB brotli, and the flat-color art style barely uses textures. If you do use KTX2, use UASTC for normals/alpha atlases and ETC1S for albedo. Load with three's own `GLTFLoader` rather than drei's `three-stdlib` one. Skip `gltfjsx` for the data-driven town. |
| 8 | **Tiers** | Use `@pmndrs/detect-gpu` (**renamed package**, v6) only as a prior. Desktop Safari reports every Apple GPU as tier 3, and an iPad can pass as a Mac. The real signal is measured frame pacing plus GPU timer queries where they exist (Chrome desktop only by default). Use drei `PerformanceMonitor` with `flipflops`, and ignore 30 Hz throttling (iOS Low Power Mode). **120 Hz is not reachable in Safari by default**, because rAF is capped at 60 Hz on ProMotion. |
| 9 | **Measurement** | Use `stats-gl` 4.2 (`trackGPU`, Chrome; Safari needs a WebKit feature flag). `r3f-perf` is stale (last release Nov 2024). Set `gl.info.autoReset = false` and reset once per frame so draw counts include every composer pass. Budget scene draws separately from post draws. |
| 10 | **R3F + Router** | Keep one `<Canvas>` in `root.tsx` outside `<Outlet/>`. Routes drive a store and never mount or unmount the canvas. Give each neighborhood its own `<Suspense fallback={null}>`, switch neighborhoods with `startTransition`, and warm shaders with `gl.compileAsync`. `useGLTF.clear` only clears the JS cache and does not free GPU memory. With about 3 MB of low-poly content, **don't unload** neighborhoods; stream them for load time only. |
| 11 | **Safari** | Half-float render targets are fine (Safari 14/15+), but don't rely on linear filtering of *float32* textures on iOS. Handle `webglcontextlost`. Expect rAF throttling to 60 Hz on ProMotion, to 30 Hz in Low Power Mode, and in cross-origin iframes before interaction. `WEBGL_multi_draw` is supported (Safari 15+). Firefox lacks it, so BatchedMesh falls back to one draw per instance there. |

### Findings that would change the architecture
1. **Mipmap bloom has no "half-res" knob.** `resolutionScale` is deprecated/ignored when `mipmapBlur` is on, and the chain already starts at half resolution. Tune `levels` instead.
2. **120 Hz on Safari isn't possible by default.** The "strong GPU → 120 Hz" tier only applies to Chromium/Firefox on high-refresh displays.
3. **Frame-time tiering can't see headroom** through a vsync-locked rAF, and GPU timers aren't available in Safari. You have to probe (see §8).
4. **BatchedMesh beats per-mesh InstancedMesh for the draw-call budget.** Shadow-pass draws count too, and 30–40 kit meshes × 2 passes would already use most of the budget of 100.
5. **The fixed yaw removes the need for octahedral impostors.** A single-view baked card is enough, and it avoids a WIP dependency.
6. **KTX2 may not be worth its transcoder cost** for this art style.
7. **R3F v10/drei v11 (WebGPU/TSL-first) are alpha.** Keep GLSL snippets small so migrating in 2027 is cheap.
8. **React Router v8 shipped June 2026.** v7 is still maintained (7.18.4), and upgrading is mostly flipping future flags.

---

## Versions checked (npm/GitHub, 2026-09-27)

| Package | Latest | Date | Notes |
|---|---|---|---|
| three | 0.186.1 (r186) | 2026-09-24 | r183 Feb 20, r184 Apr 16, r185 Jul 1, r186 Sep 24 ([releases](https://github.com/mrdoob/three.js/releases)) |
| @react-three/fiber | 9.8.1 (v10.0.0-alpha.5) | 2026-09-24 | v9.8 adds React 19.3 and Activity fixes; v10 alpha is WebGPU-first ([releases](https://github.com/pmndrs/react-three-fiber/releases)) |
| @react-three/drei | 10.7.9 (11.0.0-alpha.7) | 2026-09-25 | |
| postprocessing | 6.39.5 (7.0.0-beta.16) | 2026-09-09 | "Requires three ≥ 0.168.0 < 0.187.0" ([releases](https://github.com/pmndrs/postprocessing/releases)) |
| @react-three/postprocessing | 3.1.3 | 2026-09-27 | 3.1.3 fixes composer resize on DPR change |
| @pmndrs/detect-gpu | 6.0.24 | 2026-09-27 | the old `detect-gpu` name stopped at 5.0.70 (Feb 2025) |
| @gltf-transform/* | 4.5.0 | 2026-09-01 | |
| meshoptimizer | 1.3 | 2026-09-25 | |
| three-custom-shader-material | 6.4.0 | 2025-10-12 | |
| @three.ez/instanced-mesh | 0.3.16 | 2026-07-26 | |
| stats-gl | 4.2.3 | 2026-07-10 | |
| r3f-perf | 7.2.3 | 2024-11-08 | stale |
| gltfjsx | 6.5.3 | 2024-11-04 | stale |
| react-router | 8.4.0 / 7.18.4 | 2026-09-15 | v8 shipped 2026-06-17 ([blog](https://remix.run/blog/react-router-v8)) |

Relevant three.js migration notes ([Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)):
- **r182:** `PCFSoftShadowMap` deprecated in `WebGLRenderer`, because `PCFShadowMap` is now soft (Vogel disk + IGN). The renderer gained `outputBufferType` and `setEffects()`.
- **r183:** `PostProcessing` was renamed `RenderPipeline` (WebGPU), `Clock` was deprecated in favor of `Timer`, shadow bias values may need retuning, and BatchedMesh gained per-instance opacity.
- **r185:** `KTX2Loader`/`DRACOLoader` use `new URL(..., import.meta.url)` defaults, and meshopt decoder 1.1.1 is included.
- **r186:** `PCFSoftShadowMap` was removed and warns. `SunLight` (CSM) was added as an addon, and `Object3D.dispose()` was added.

---

## 1. Instancing: InstancedMesh vs BatchedMesh vs drei `<Instances>`/`<Merged>`

**How they differ**
- `InstancedMesh` takes one geometry and one material and draws everything in one call. It is frustum-culled as a whole using an instance-aware bounding sphere. It is the best choice for >100k copies of one mesh.
- `BatchedMesh` holds many geometries with one material. On WebGL2 it uses `WEBGL_multi_draw`. It supports per-instance matrix, color (`setColorAt`), visibility, opacity (r183), per-object frustum culling (`perObjectFrustumCulled`, default true), sorting (`sortObjects`, default true), raycasting, and dynamic `addInstance`/`deleteInstance`/`setInstanceCount`/`setGeometrySize` (verified in r186 source).
- Forum consensus: use `InstancedMesh` for a single geometry, separate `InstancedMesh`es for 2–4 geometries, and `BatchedMesh` for many. MultiDraw "performs worse if you render a lot of instances (more than 100k)" (agargaro), see [three.js forum](https://discourse.threejs.org/t/how-to-choose-between-instancedmesh-and-batchedmesh/81221).
- drei `<Instances>` recomposes every instance matrix on the CPU **every frame** unless you pass `frames={1}` (verified in the drei 10.7.9 source). The docs say to use raw `THREE.InstancedMesh` "for cases like foliage where you want no CPU overhead with thousands of instances" ([drei docs](https://drei.docs.pmnd.rs/performances/instances)). `<Merged>` just creates one `<Instances>` per mesh, so it costs one draw per kit mesh.

**Recommendation for 20–40 kit meshes**
- Create one `BatchedMesh` per shared material (6–8), holding all kit geometries that use that material. Every neighborhood adds instances to the same batches, so streaming doesn't add draw calls.
- Draw calls: `renderer.info` counts a multiDraw as **1 call** (`info.update(elementCount, mode, 1)` in `WebGLBufferRenderer.renderMultiDraw`, verified). The main pass is about 8, the shadow pass about 8 (only casters), so the town costs about 16.
- The per-mesh `InstancedMesh` alternative costs 30–40 main plus 30–40 shadow draws. That uses most of the 100 budget before trees, water, sky and post.

**BatchedMesh caveats (r186)**
- **Consistent attributes:** every geometry must have the same attributes, all indexed or all non-indexed, with matching `itemSize` and `normalized` values (`_validateGeometry`, verified). Export every kit piece with the same attribute set, for example position, normal, uv and optionally color. With meshopt quantization, use `quantizationVolume: 'scene'`, or dequantize to float on load. See §7.
- **Firefox:** it lacks `WEBGL_multi_draw` ([MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/api/WEBGL_multi_draw.json): Chrome 86+, Safari 15+, Firefox no). three then falls back to a loop of draws with a `_gl_DrawID` uniform (`batching_pars_vertex`, verified). It still works, but costs one call per visible instance.
- **Instanced multi-draw:** `multiDraw*Instanced` isn't used yet ([#31935](https://github.com/mrdoob/three.js/issues/31935), open). Each instance is a separate sub-draw inside the multiDraw. That's fine for hundreds to low thousands of buildings.
- **Per-frame CPU cost:** culling and sorting run on the CPU every frame (`onBeforeRender`). For opaque-only batches, set `sortObjects = false`. Keep `perObjectFrustumCulled`.
- **Custom per-instance data:** there are no custom instanced attributes. Use a `DataTexture` (RGBA32F or RGBA16F, one texel per instance: hoverLift, glow, reveal, seed) and read it in the vertex shader with `texelFetch(..., getIndirectIndex(gl_DrawID))`, the same way three reads `batchingColorTexture`. Pass it to the fragment shader as a `flat` varying.
- **R3F:** there is no JSX sugar. Build the batch imperatively in a `useMemo`/`useLayoutEffect` and mount it with `<primitive object={batch} dispose={null}/>`. You own its disposal.
- **Capacity:** reserve `maxInstanceCount` / `maxVertexCount` up front for all neighborhoods, or grow with `setInstanceCount` / `setGeometrySize`, which reallocates.
- **Tooling:** `@three.ez/instanced-mesh` (`InstancedMesh2`, 0.3.16) adds BVH culling, LOD, shadow LOD and per-instance uniforms to `InstancedMesh` ([repo](https://github.com/agargaro/instanced-mesh)). It is the best fit for the forest, not the town.

---

## 2. Forest to the horizon

The fixed yaw is the key simplification. Every tree is seen from nearly the same direction (pitch is fixed and the long lens limits parallax), so **full octahedral impostors aren't needed**. agargaro's `octahedral-impostor` is still "wip", not on npm, and was last pushed Nov 2025 ([repo](https://github.com/agargaro/octahedral-impostor), [forum showcase](https://discourse.threejs.org/t/a-forest-of-octahedral-impostors/85735)).

Use three bands:
1. **Near (town edge):** 3–4 species × 2 LODs as `InstancedMesh` or `InstancedMesh2` (`addLOD`, `addShadowLOD`). With plain `InstancedMesh`, split the forest into spatial chunks so whole-mesh culling can work, because one mesh spanning the map never culls. Only this band casts shadows, and it uses the low LOD in the shadow pass.
2. **Mid:** a camera-facing (or ground-aligned, fixed-yaw) **impostor card**. Bake albedo and normal (optionally depth) into a small atlas from the same Blender scripts, rendered at the camera pitch. Light the card in the shader with the dynamic sun and hemisphere ambient, so time of day stays consistent. This is one `InstancedMesh` for the whole band.
3. **Far/horizon:** one ring or strip mesh with noise-displaced crown bumps, or a canopy shader on a plane. It sits under height and distance fog whose color is sampled from the sky-gradient function at the horizon. That makes the fog seam invisible and costs one draw.

Bruno Simon's 2025 folio is a useful practitioner reference. Its foliage is "camera-facing planes" with an SDF texture, and it instances trees, foliage and props and frustum-culls areas ([Awwwards case study](https://www.awwwards.com/brunos-portfolio-case-study.html)).

**Sway (vertex shader)**
- Inject after `#include <begin_vertex>`. Take the phase from the instance's world position: `instanceMatrix[3].xz` for `InstancedMesh`, or the batching matrix for `BatchedMesh`. Take the weight from a vertex-color channel painted in Blender (trunk 0, crown 1), or from `smoothstep` on local `position.y`.
- Offset: `transformed.xz += windDir * weight * amp * (sin(t*f + phase) + 0.3*sin(t*2.7f + phase*1.3))`.
- **Apply the identical snippet to `customDepthMaterial`** (a `MeshDepthMaterial` with the same `onBeforeCompile`), or the shadows won't move with the tree ([forum](https://discourse.threejs.org/t/customdepthmaterial-vertex-shader/45838)). On low tier, let the shadow pass skip sway.
- Drive `amp` with a per-tier uniform, and use 0 for the impostor band.

---

## 3. Shader injection: CSM vs `onBeforeCompile` vs TSL

- **TSL** compiles to WGSL or GLSL and runs on `WebGPURenderer`'s WebGL2 backend. However, "ShaderMaterial, RawShaderMaterial, and onBeforeCompile patches are not supported by WebGPURenderer, on the WebGPU backend **or** the WebGL 2 fallback". "EffectComposer and its passes don't run on WebGPURenderer. Neither does pmndrs/postprocessing, or @react-three/postprocessing." ([Utsubo migration guide, r186, Sept 2026](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)). You'd have to use three's `RenderPipeline`/`BloomNode`.
- The WebGL2 backend of `WebGPURenderer` can be slower than `WebGLRenderer` for some scenes ([forum](https://discourse.threejs.org/t/why-webgpurenderer-performance-significantly-lower-than-webglrenderer/77629)). Node-material setup can be 16–36× slower than WebGLRenderer in a 10k-mesh test ([#33821](https://github.com/mrdoob/three.js/issues/33821), Jun 2026, open).
- R3F's TSL hooks (`useUniforms`, `useNodes`, `useRenderPipeline`) exist only in **v10 alpha**.
- **Verdict: TSL is not ready for this stack in production.**
- **three-custom-shader-material 6.4.0** (Oct 2025) works on `WebGLRenderer`, with outputs such as `csm_Position`, `csm_DiffuseColor`, `csm_Emissive` and `csm_Roughness` ([repo](https://github.com/FarazzShaikh/THREE-CustomShaderMaterial)). It is convenient, but it rebuilds when `baseMaterial`, shader or uniform references change, and chaining several features needs manual scoping. It adds a layer without adding capability.
- **Recommended: `onBeforeCompile`** with a ~100-line helper. Each feature (instanceColor tint, sway, hover lift/glow, reveal dissolve) is `{defines, uniforms, vertexChunks, fragmentChunks}`. The helper:
  - composes the features into a material's `onBeforeCompile`;
  - sets `customProgramCacheKey()` to the sorted feature list, so the 6–8 base materials share programs;
  - generates the matching `MeshDepthMaterial`/`MeshDistanceMaterial` variant for shadows. The reveal dissolve must `discard` in the depth pass too.
  - Keep uniforms in shared objects so one `uTime` update feeds every material.
- Warm programs before reveal with `renderer.compileAsync(scene, camera)`, which uses `KHR_parallel_shader_compile` (Chrome 76+, Safari 14.1+; [MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/api/KHR_parallel_shader_compile.json)).
- **Pitfall:** changing the number of shadow-casting lights, `renderer.shadowMap.enabled` or fog type after start triggers recompiles of every program. Fix these settings at boot.

---

## 4. Postprocessing, bloom, tone mapping, AA

- **Library:** use pmndrs `postprocessing` 6.39.5 with `@react-three/postprocessing` 3.1.3.
  - pmndrs merges compatible effects into one `EffectPass`. Since 3.1.0, `mergeMode: 'auto'` keeps at most one convolution effect per pass ([releases](https://github.com/pmndrs/react-postprocessing/releases)).
  - three's own `EffectComposer` on WebGL works, but costs more passes. `RenderPipeline` is WebGPU-only.
  - Pin postprocessing's three range: 6.39.5 requires three <0.187.
- **Composer defaults (verified in 3.1.3 source):** `frameBufferType = HalfFloatType`, which is good for HDR bloom input. **`multisampling = 8`**, which is expensive, so set it explicitly. The composer forces `renderer.toneMapping = NoToneMapping` and restores it on unmount (3.0.5).
- **Bloom (postprocessing `BloomEffect`, verified in source)**
  - Defaults: `mipmapBlur: true`, `luminanceThreshold: 1.0`, `luminanceSmoothing: 0.03`, `radius: 0.85`, `levels: 8`.
  - `kernelSize`, `resolutionScale`, `resolutionX/Y` are "Deprecated. Use mipmapBlur instead." The mipmap chain halves the resolution at every level starting from the first (`MipmapBlurPass.setSize`), so it is effectively half-res already.
  - The luminance pre-pass runs at full res by default (`LuminancePass resolutionScale = 1`). You can set `bloom.luminancePass.resolution.scale = 0.5` and measure the result.
  - Perf knobs: reduce `levels` to 5–6 (each level is one down-sample and one up-sample quad), and keep the threshold at about 1.0 in linear HDR. Author neon and gold emissives with `emissiveIntensity` > 1, so only they bloom and the sunlit whites don't.
- **Tone mapping: Khronos PBR Neutral** (`ToneMappingMode.NEUTRAL`, verified in the enum).
  - It is "guaranteed to avoid all hue shifts" and only desaturates at extreme brightness ([Khronos](https://github.com/KhronosGroup/ToneMapping/blob/main/PBR_Neutral/README.md)).
  - ACES makes "canary yellow, bright greens and blues … impossible to output", and "the highlights on the golden sphere become white instead of yellow". AgX also "severely desaturates" ([model-viewer comparison](https://modelviewer.dev/examples/tone-mapping)). That is the opposite of what saturated neon and gold need.
  - The three.js editor switched its default to Neutral in r183.
  - Put `<ToneMapping mode={NEUTRAL}/>` last, and add an optional `LUT3DEffect` grade on high tier.
- **AA**
  - With a composer, canvas `antialias` doesn't apply. Set it to false and use composer MSAA (WebGL2) or `SMAAEffect`. MSAA is cheap but conflicts with depth-based effects ([pmndrs wiki](https://github.com/pmndrs/postprocessing/wiki/Antialiasing)).
  - At DPR 2 (Retina Air), aliasing is mostly invisible, so use no MSAA or SMAA. At DPR 1–1.5, use MSAA 4.
  - Historical iOS issue: MSAA combined with depth/stencil broke on iOS 15.4+ ([#412](https://github.com/pmndrs/postprocessing/issues/412)), so test it. 6.39.5 also added a multisampling fallback for contexts where `renderbufferStorageMultisample` throws ([#749](https://github.com/pmndrs/postprocessing/issues/749)).

---

## 5. Shadows

- **Fit the camera yourself** each time the view pans or zooms, or the sun changes:
  1. Intersect the 4 frustum corner rays with the ground plane (y=0), and add the tallest roof height.
  2. Transform those points into light space.
  3. Take the AABB as the ortho `left/right/top/bottom`.
  4. Snap its center to whole shadow texels so edges don't shimmer while panning.
  5. Set `near/far` from the scene height range.
- The r186 `SunLight` does the same thing internally: a bounding-sphere fit plus texel snapping, "more stable under rotation than AABB-based fitting" ([PR #34221](https://github.com/mrdoob/three.js/pull/34221)).
- Use `light.shadow.autoUpdate = false` and set `needsUpdate = true` only on camera or sun change, or throttle to every N frames while panning.
- **CSM:** with a long lens looking down, the view's depth range is shallow, so a single map covers it at good texel density. That makes CSM not worth the extra shadow pass per cascade.
- `SunLight` (`three/addons/lights/SunLight.js`, r186) uses **2 cascades** by default (reduced from 4), at 1024² each, and ignores `camera.left/right/...` (verified in source). It was only merged in r186, so treat it as new. Consider it for an optional "zoomed-out horizon" state.
- **Map size per tier:** low 1024, mid 2048 (M1 Air default), high 4096. This agrees with [Utsubo's 100 tips (r186)](https://www.utsubo.com/blog/threejs-best-practices-100-tips): mobile 512–1024, desktop 1024–2048, quality-critical 4096.
- **Casters:** only the town batches and near-band trees cast shadows. Impostors, the far canopy, water and the ground don't; the ground only receives.
- `PCFShadowMap` is now soft (r182+), and `PCFSoftShadowMap` is removed in r186. Retune `bias`/`normalBias` after upgrading ([Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)).

---

## 6. Env map from a dynamic sky

- **Cost:**
  - r186 replaced the PMREM separable blur with a spiral blur (40 taps vs 78). "Total `fromScene()` time is unchanged (sub-millisecond either way)" on the author's machine ([PR #32367](https://github.com/mrdoob/three.js/pull/32367)).
  - A third-party measurement shows about 4–5 ms on an RTX 4060 laptop and 185–1198 ms on SwiftShader.
  - Animating PMREM every frame is a known performance trap ([forum](https://discourse.threejs.org/t/bad-performances-when-animating-a-pmremgenerator-environment/48043)).
- **API detail (verified in r186 source):** `WebGLRenderer`'s `PMREMGenerator.fromScene()` allocates a **new** target on every call, so you must dispose the old one. `fromCubemap(cubemap, renderTarget)` and `fromEquirectangular(tex, renderTarget)` **accept a reusable target**.
- **Recommended:**
  1. Render the sky-gradient mesh into a small `WebGLCubeRenderTarget` (64–128 px) with a `CubeCamera`.
  2. Call `pmrem.fromCubemap(cubeRT.texture, pmremRT)` into a reused `pmremRT`.
  3. Regenerate only when sun elevation or azimuth changes by more than about 1°, or on time-of-day scrub end. Amortize by never doing it in the same frame as a shadow re-render.
  4. Use `scene.environmentIntensity` for per-frame smooth dimming in between.
- **Cheaper alternative (low tier):** keep a small static PMREM for specular, and move diffuse ambient to a `HemisphereLight` whose sky and ground colors are evaluated from the gradient every frame (free). With stylized rough materials and baked AO, this is nearly indistinguishable.
- **Other options:** pre-bake K PMREMs (e.g. 6 times of day) at load and switch between them. That is fast, but it steps unless you add a two-envMap blend by shader injection.

---

## 7. Asset pipeline

- **Don't run `gltf-transform optimize` with its defaults on kit pieces.** Verified defaults in the 4.5.0 CLI:
  - `--compress meshopt` and `--texture-compress auto`;
  - `--simplify true` (decimates your authored smooth low-poly), `--join true` + `--flatten true` (merges meshes you want separate for batching/picking), and `--palette true` (merges materials);
  - `--instance true` and `--texture-size 2048`.
- **Write a small API script** (Node, runs after Blender export):
  ```js
  await doc.transform(
    dedup(), instance(), prune(), weld(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizationVolume: 'scene' }), // shared dequant volume → BatchedMesh-safe
  );
  ```
  - Use `quantizationVolume: 'scene'`, or dequantize on load. Per-mesh quantization puts a dequantization transform on the node, and BatchedMesh requires matching `normalized` flags across geometries.
  - Use `palette()` only for pieces that don't use per-instance color.
- **Meshopt vs Draco:** prefer Meshopt.
  - The decoder is about 7 KB brotli vs about 59 KB for Draco (wasm + wrapper; measured from three r186 `examples/jsm/libs`).
  - It decodes faster, keeps quantized attributes in VRAM (Draco decodes to float), and also compresses animation.
  - Serve `.glb` with brotli or gzip, because meshopt is designed to be followed by general-purpose compression ([meshoptimizer gltf docs](https://meshoptimizer.org/gltf/)). Check that your host actually compresses `model/gltf-binary`.
  - three r183+ `GLTFLoader` also reads `KHR_meshopt_compression`. gltf-transform 4.5 writes `EXT_meshopt_compression`, and gltfpack writes KHR with `-ce khr`/`-cz`.
- **KTX2**
  - Basis transcoder: 527 KB wasm (≈204 KB brotli) plus a 57 KB JS worker (≈14 KB brotli). For a mostly flat-color, per-instance-tinted art style, that is a large part of the first-load budget.
  - Use KTX2 only if texture VRAM becomes significant, for example the impostor atlases and water normals. Otherwise use WebP/PNG, and never on the critical path.
  - If you use it:
    - **UASTC** (with RDO) for normals, ORM and alpha-edged atlases; **ETC1S** for albedo/emissive ([Khronos KTX Artist Guide](https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXArtistGuide.md)). gltf-transform's own ktx2 path uses UASTC level 4, RDO λ4 for normal/occlusion/MR and ETC1S quality 255 for the rest.
    - It needs **KTX-Software ≥4.4.0** (`ktx` CLI; verified in the CLI source).
    - Keep dimensions a multiple of 4, or power-of-two for mips.
- **Loader setup (three r186)**
  - `KTX2Loader` defaults to `new URL('../libs/basis/…', import.meta.url)` when no path is set (r185+, verified). Vite dep pre-bundling can break `import.meta.url` inside `node_modules`, so copy `three/examples/jsm/libs/basis/*` to `public/basis/` and call `ktx2.setTranscoderPath('/basis/').detectSupport(gl)`. `detectSupportAsync` is deprecated (r181).
  - Use `gltf.setMeshoptDecoder(MeshoptDecoder)` from `three/addons/libs/meshopt_decoder.module.js`.
  - Create loaders once and share them.
- **drei `useGLTF` gotcha:** it uses **`three-stdlib`**'s `GLTFLoader` (three-stdlib 2.36.1, Nov 2025, with no `KHR_meshopt_compression`) and a gstatic Draco CDN default (verified in drei 10.7.9 source). Prefer R3F `useLoader(GLTFLoader /* three/addons */, url, ext)` with your own configured loaders, or at least pass `extendLoader`.
- **gltfjsx** (6.5.3, Nov 2024) is useful for hand-placed hero models (`--types`, `--instance`). Its `--transform` path defaults to Draco and WebP 1024 ([readme](https://github.com/pmndrs/gltfjsx)). The town is data-driven into `BatchedMesh`, so skip it there.

---

## 8. Tier detection

- **@pmndrs/detect-gpu** is the new package name; `detect-gpu` is frozen at 5.0.70 ([README](https://github.com/pmndrs/detect-gpu)).
  - It **looks up** the renderer string in gfxbench-derived tables; it does not benchmark live. The data source "stopped updating in December 2025".
  - By default it fetches the tables from unpkg, so self-host them via `benchmarksURL` for CSP and offline use.
  - Desktop Safari reports "Apple GPU" for every M-chip. A capability-fingerprint approach failed because M1 Max, M2 and M4 scored identically ([PR #128](https://github.com/pmndrs/detect-gpu/pull/128), closed). The merged fix maps desktop Apple GPU to **tier 3** ([PR #159](https://github.com/pmndrs/detect-gpu/pull/159), Apr 2026).
  - So an M1 Air and an M4 Max look the same. iPadOS Safari sends a Mac UA by default, so also check `navigator.maxTouchPoints > 1`.
  - Use detect-gpu only to choose the *starting* tier.
- **Frame-time probing:** rAF is vsync-locked, so a GPU at 60 Hz with 15 ms of work looks identical to one with 5 ms. drei `PerformanceMonitor` is purely rAF cadence: 250 ms samples × 10 iterations, default `bounds = rr > 100 ? [60,100] : [40,60]` (verified in source). It detects *misses*, not headroom. Recommended:
  1. Boot at the prior tier, run `compileAsync`, and exclude load and stream hitches (pause the monitor while a neighborhood is streaming).
  2. **Downgrade** with `<PerformanceMonitor flipflops={3} onDecline onFallback>`. Use discrete tier steps rather than continuous DPR changes, because every DPR change reallocates composer targets.
  3. **Upgrade and headroom check:**
     - Where `EXT_disjoint_timer_query_webgl2` exists (Chrome/Edge desktop), read GPU ms directly. It is unavailable by default in Safari and Firefox: [MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/api/EXT_disjoint_timer_query_webgl2.json), and a pending [BCD PR](https://github.com/mdn/browser-compat-data/pull/30644) for Safari is disputed.
     - Elsewhere, run a short one-off *stress probe* during the reveal. Render the next tier's settings for about 1 s and require fewer than 5% missed vsyncs. Or time a `gl.finish()`-bracketed frame once, which is acceptable only during loading.
  4. **Ignore throttled cadence.** iOS throttles rAF to **30 fps in Low Power Mode**, and cross-origin iframes are throttled before interaction ([WebKit bug 168837](https://bugs.webkit.org/show_bug.cgi?id=168837), [Motion](https://motion.dev/magazine/when-browsers-throttle-requestanimationframe)). A tight 33.3 ms cluster should not trigger a downgrade.
  5. The M1 Air is fanless, so keep monitoring with hysteresis for thermal drift.
- **120 Hz:** Safari locks page rendering near 60 fps on ProMotion by default. It needs a user-toggled feature flag ("Prefer Page Rendering Updates near 60fps") ([MacRumors](https://www.macrumors.com/how-to/enable-smoother-120hz-browsing-in-safari/)). Only Chromium/Firefox on 120 Hz+ displays benefit. Detect the refresh rate from rAF (`PerformanceMonitor`'s `refreshrate`).
- **`AdaptiveDpr`** only reacts to `state.performance.current`, which drops when something calls `regress()`. It is an interaction-time DPR dip, not a monitor. It needs `@react-three/postprocessing` ≥3.1.3 so the composer resizes on DPR change.

---

## 9. Performance measurement

- **stats-gl 4.2.3** reports FPS, CPU and GPU for WebGL and WebGPU (`new Stats({ trackGPU: true })`). "To support GPU monitoring on Safari you need to enable Timer Queries under WebKit Feature Flags" ([README](https://github.com/RenaudRohlinger/stats-gl)). Use it in dev and on a `?perf` flag.
- **r3f-perf** 7.2.3 is WebGL-only, and its last release was Nov 2024, so treat it as unmaintained ([Utsubo](https://www.utsubo.com/blog/threejs-best-practices-100-tips)). three's **Inspector** (r184+: timeline, CPU/GPU graphs, overdraw mode) targets `WebGPURenderer`.
- **Draw calls with post:**
  - `renderer.info.autoReset` defaults to true and resets on each `render()`, so with a composer you'd only see the last pass. Set `gl.info.autoReset = false` and call `gl.info.reset()` at the start of each frame (for example in a `useFrame` with a negative priority).
  - Log main-pass draws separately by reading `info.render.calls` right after the RenderPass, for example in a custom `renderPass` prop (react-postprocessing 3.1.0+).
  - Shadow-map draws are counted too. A BatchedMesh multiDraw counts as 1 call.
- **Budget split:** scene main plus shadow < 100 calls. Post adds about 2 × bloom `levels` quads, plus luminance, the effect pass and output. Those are cheap full-screen draws.
- **GPU timer availability:** Chrome/Edge desktop 70+ support `EXT_disjoint_timer_query_webgl2`. Chrome Android, Firefox and Safari don't by default (Safari needs a flag).

---

## 10. R3F + React Router (framework mode, prerender)

- **Persistent canvas:**
  - Render `<Canvas>` once in `root.tsx` (App or Layout), as a sibling of `<Outlet/>`, positioned behind the DOM.
  - Routes write "focused neighborhood / camera target" into a store (zustand), and the scene reads it. Avoid mounting 3D content per route, because the R3F pitfalls page says to avoid "indiscriminate mounting/unmounting" and to toggle `visible` instead ([R3F pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls)).
  - `tunnel-rat` is an alternative if routes must inject JSX into the canvas.
  - R3F 9.8.1 fixed `<Activity>` wrapping a Canvas and renderer disposal on root unmount ([release](https://github.com/pmndrs/react-three-fiber/releases)).
- **Prerender/SSR:** the prerendered HTML should carry the portfolio text (real LCP) plus a CSS gradient placeholder matching the first sky frame. Lazy-load the 3D bundle (`React.lazy` inside a client-only boundary) so three, R3F and post don't block hydration.
- **First frame < 1.5 s:**
  1. Mount the Canvas with only sky and ocean, and fix the renderer config (shadows, fog, light count) at boot.
  2. Mount `EffectComposer` after the first frame.
  3. Fetch the KTX2 transcoder only if and when needed.
  4. Stream neighborhoods by camera proximity.
- **Suspense:** wrap **each neighborhood in its own `<Suspense fallback={null}>`**. A single boundary around the scene would blank sky and water while any glTF loads. Perform "load next neighborhood" state changes inside `startTransition`, so already-revealed content never flips back to a fallback. Preload neighbors with `useLoader.preload`.
- **Disposal:**
  - `useGLTF.clear(url)` / `useLoader.clear` only evict the JS/suspense cache and do not free GPU buffers.
  - "Primitives will not dispose of the object they carry on unmount" ([R3F objects](https://r3f.docs.pmnd.rs/api/objects)).
  - With BatchedMesh, the source glTF geometries are *copied* into the batch. Drop your references and clear the cache after `addGeometry`; they were never uploaded, so there is no GPU leak.
  - Removing a neighborhood means `deleteInstance` (and `deleteGeometry` if unique), with an occasional `optimize()`.
  - At about 3 MB total, keeping everything resident after load is simpler and avoids re-compile and re-upload hitches. Use streaming for time-to-first-frame, not for memory.

---

## 11. Safari / iPadOS WebGL2 gotchas

- **Float render targets:** `EXT_color_buffer_half_float` has been in Safari since 14 and `EXT_color_buffer_float` since 15. `OES_texture_float_linear` is "Only supported on iPadOS" on iOS ([MDN BCD](https://github.com/mdn/browser-compat-data)). So use HalfFloat for HDR targets, which are filterable, and never rely on linear filtering of 32-bit float textures.
- **Compressed textures:** Apple GPUs support ASTC and ETC2, and Macs also support S3TC/BC (Safari 12+/13.1+/8+ respectively per BCD). KTX2Loader picks the transcode target automatically after `detectSupport`.
- **Extensions:** `WEBGL_multi_draw` has been in Safari since 15, so BatchedMesh gets true multiDraw there. `KHR_parallel_shader_compile` has been in Safari since 14.1.
- **rAF:** capped near 60 Hz on ProMotion by default, 30 Hz in iOS Low Power Mode, and throttled in cross-origin iframes until interaction (see §8). Don't downgrade tiers on these.
- **GPU timing:** no timer queries without a WebKit feature flag.
- **MSAA:** composer MSAA combined with depth/stencil has broken on some iOS versions before ([#412](https://github.com/pmndrs/postprocessing/issues/412)). Keep an SMAA fallback and test on a real iPad.
- **Memory and context loss:** iOS kills WebGL contexts under memory pressure. Handle `webglcontextlost`/`restored`, keep textures small and compressed, and cap DPR at 2 (iPad DPR is 2).
- **WebGPU:** Safari 26 (Sept 2025) ships WebGPU on macOS, iOS and iPadOS ([Utsubo](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)). This matters for a future `WebGPURenderer` migration, not for this build.

---

## Draw-call budget sketch (mid tier)

| Item | Main | Shadow |
|---|---|---|
| Town BatchedMeshes (7 materials) | 7 | 7 |
| Near trees (4 species × 2 LOD) | 8 | 4 (low LOD only) |
| Impostor band + far canopy | 2 | 0 |
| Terrain/ground chunks | 4–9 | 0 |
| River + ocean water | 2 | 0 |
| Sky | 1 | 0 |
| Hover/selection helpers, misc | ~5 | ~2 |
| **Scene total** | **~30–35** | **~13** |
| Post (luminance + 6 bloom levels ×2 + effect + tone map) | ~15 quads | |

That leaves roughly 50 calls of headroom under the 100 target for props, signage, birds and UI-in-world.
