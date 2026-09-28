# Spec review: Portfolio Town (pre-Milestone 1)

Sep 27, 2026 · senior review of `spec.md`, `decisions.md`, `art-direction/README.md` (+ 3 boards) and `research/perf-best-practices.md`

API claims below were checked against source on 2026-09-27: three.js `r186` tag and `dev`, `@react-three/fiber` 9.8.1 dist, `postprocessing` 6.39.5, glTF-Transform `main`, and ANGLE `main`. Links are inline.

## Verdict

The product thinking is strong. The decision log is unusually disciplined, and most of the renderer choices are right for this stack: WebGLRenderer, BatchedMesh, PBR Neutral, Meshopt, a hand-fit shadow and a throttled PMREM. **The plan is not ready to start Milestone 1 as written, for three reasons:**

1. The asset contract between Blender and three.js is undefined or wrong in places. This covers how AO is stored, what counts as an "instance", and the quantization assumptions.
2. The performance proxy can't verify the Milestone 1 exit criterion.
3. Several fidelity pillars have no technique behind them, so the plan can't reach them as written. Night neon, water reflections and lush foliage matter most here, because the refs are carried by exactly those three things.

None of this is hard to fix. It mostly needs decisions and a few spikes before the kit generator is written. Milestone 1 is also about twice the size it should be for a "does this look exciting?" gate.

---

## Blocker

### B-1 Baked AO has no storage mechanism, and every obvious one conflicts with the batching plan
**Where:** spec §Overview, §Performance › Lighting; R-007 ("bake AO only"); D-012 ("almost no image textures"); R-004; Milestone 1 checklist item 2.

**What's wrong:**
- AO is on the Milestone 1 checklist, but nothing says *where it lives*.
- three's `aoMap` is a per-material texture. With one `BatchedMesh` per shared material, every geometry in a batch would have to share one AO atlas. That means one UV2 atlas per material, spanning every neighborhood's pieces, and it breaks per-neighborhood streaming.
- Putting AO in `COLOR_0` with `vertexColors: true` is wrong: vertex colors multiply `diffuseColor`, so AO would darken *direct* sunlight as well.
- AO baked per kit piece in isolation (the "kit + runtime `townLayout` placement" model) captures none of the contact occlusion that sells the refs: terraces over terraces, a canopy over the forum, buildings meeting the ground and planters against walls.

**Why it matters:** this decides the vertex layout for every exported mesh (see S-1), the Blender bake step and the material injection. Changing it after the kit exists means re-exporting everything.

**Recommendation:**
- Bake AO in Cycles into a **custom float attribute `_AO`**. Cycles can bake to color attributes (`target='VERTEX_COLORS'`); copy the result to a generic attribute.
- Bake it **in placed context**: Blender reads the neighborhood layout, assembles the scene, bakes, then splits for export (see B-2).
- Inject it into the existing `aomap_fragment` path, so it multiplies only `indirectDiffuse` and drives three's built-in `computeSpecularOcclusion` ([aomap_fragment.glsl.js](https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/aomap_fragment.glsl.js)).
- Add bevel and edge-loop density where AO gradients need it. This is a script parameter per LOD.
- For ground contact, bake a small AO/"dirt" term into terrain vertex colors or a single low-res ground texture.

This respects D-012 (no image textures on buildings). Record the result as a new decision.

### B-2 "Kit + per-instance BatchedMesh" is the wrong granularity for unique biomorphic architecture, and the ~100 draw-call metric hides the real cost
**Where:** R-004, spec §Performance › Batching, D-001, D-028, research §1.

**What's wrong:**
- **The instancing model:** the plan models the town like Townscaper, with many reused kit pieces instanced by `townLayout`. The refs and pillars 1–2 describe *unique* flowing buildings, such as terraced shells and Voronoi canopies fitted to one site. Those will rarely repeat, so instancing saves little. It still costs a per-instance CPU cull and sort every frame for every camera (main, shadow and env cube; `BatchedMesh.onBeforeRender`/`onBeforeShadow`), and a split of each building across ~4 material batches.
- **Draw-call count vs driver cost:** `renderer.info` counts a multi-draw as one call, but it is not one draw for the driver. On Safari and Chrome-on-Mac, WebGL runs on ANGLE's Metal backend, where `multiDrawElements` is implemented as `MultiDrawElementsGeneral`, a loop of individual draws ([ANGLE ContextMtl.mm](https://chromium.googlesource.com/angle/angle/+/refs/heads/main/src/libANGLE/renderer/metal/ContextMtl.mm)). So "~7 draws" can be hundreds of real draws per pass. That is still far cheaper than JS-side calls, but the HUD metric will say 30 while the GPU front end does 600.
- **Firefox:** it still has no `WEBGL_multi_draw` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_multi_draw)). three falls back to one real `drawElements` plus a `_gl_DrawID` uniform per visible instance, so fine-grained instancing is exactly the worst case there.

**Recommendation:** decide the granularity explicitly:
- **Unique architecture** is merged at build time into one geometry per *(neighborhood × material × LOD)*. Each becomes a handful of BatchedMesh instances per neighborhood. Sub-object identity (e.g. each pedestal, each building for the hover lift) lives in a small per-vertex `_ID` attribute, looked up in a per-group state uniform or texture. This makes AO in context (B-1) trivial, keeps multi-draw sub-draws in the tens, makes Firefox a non-issue, and simplifies LOD swaps (`setGeometryIdAt`).
- **True repeats** (trees, planters, lamps, seating, crane parts) stay instanced: `InstancedMesh`, or `BatchedMesh` for mixed props.
- **HUD:** show both `info.render.calls` and the **sum of `_multiDrawCount` across batches**, and budget the latter too.

This is compatible with D-001 (the scripts are still the parametric source). It revises R-004's framing.

### B-3 `?perf=base` and the "≤ ~4 ms on M1 Max" target can't verify "60 fps on a base Air"
**Where:** D-020, spec §Performance › Measure, Milestone 1 item "Hit the performance budget".

**What's wrong:**
- **Raw gap:** the M1 Max 32-core GPU has roughly 4× the ALU and ~6× the memory bandwidth of a base M1 Air: 400 GB/s vs 68 GB/s, and a 32- vs 7/8-core GPU.
- **Ambiguous proxy:** "Render at about 2× pixels" doesn't say 2× relative to what. The 16" Max panel is already ~7.7 MP against the Air's ~4.1 MP at DPR 2.
- **4 ms doesn't scale to 16.7 ms:** a 4 ms frame scaled by ALU is ~16 ms, with no margin. Scaled by bandwidth it is ~24 ms. Bloom, the HalfFloat composer targets, MSAA resolve and shadow-map fill are bandwidth-bound, which is exactly this plan's profile.
- **Wrong measurement tool:** "frame time" measured via rAF on a vsync-locked display can't show any of this (research §8 already notes it). Only GPU timer queries can, in Chrome desktop.
- **Blind spots:** mid-range Android phones and in-app browsers are not covered at all, and those browsers (LinkedIn, Slack, Instagram) are where recruiters open shared portfolio links.

**Why it matters:** Milestone 1's exit criterion is "hit the performance budget (proxy)". With this proxy, the milestone can pass on the Max and still miss 60 fps on an Air.

**Recommendation:**
- Define the metric as **GPU ms via `EXT_disjoint_timer_query_webgl2` in Chrome on the Max** (stats-gl `trackGPU`) plus CPU ms. Set the Max budget at **≤ 2.5–3 ms GPU at the Air's pixel count** (2560×1600), or ≤ 4 ms at ~2× that pixel count, and state which one.
- **Calibrate the proxy once against real hardware.** A used base M1 Air is ~$400. BrowserStack or LambdaTest real devices are the fallback, and should cover one mid-range Android (e.g. a Pixel 6a or Galaxy A5x) and an iPhone 12/13.
- Record the calibration factor in D-020's successor.
- The owner should decide whether a real device is in scope. D-020's context says "no low-end hardware available".

---

## Should-fix

### S-1 The quantization/BatchedMesh reasoning in R-004/R-009 is wrong, and the real pitfalls are unlisted
**Where:** R-004 ("export with meshopt `quantizationVolume: 'scene'`" so layouts match), research §1 and §7.

**What's wrong** (verified in [glTF-Transform `quantize.ts`](https://github.com/donmccurdy/glTF-Transform/blob/main/packages/functions/src/quantize.ts), [`meshopt.ts`](https://github.com/donmccurdy/glTF-Transform/blob/main/packages/functions/src/meshopt.ts) and [three `BatchedMesh.js`](https://github.com/mrdoob/three.js/blob/r186/src/objects/BatchedMesh.js)):
- **Volume doesn't set layout.** The quantization volume changes only the dequantization transform written onto parent nodes. It does not change the attribute layout or the `normalized` flags. Both `'mesh'` and `'scene'` produce normalized Int16 positions. You must fold the node matrix into the instance matrix either way.
- **What actually breaks layout:**
  - `quantize` **skips `TEXCOORD_n` outside [0,1]** and **custom `_ATTR` outside [-1,1]** with only a warning, leaving them Float32 non-normalized.
  - One tiling UV or an AO value slightly >1 therefore makes a mesh's `normalized` flag differ, and `BatchedMesh._validateGeometry` throws: "All attributes must have a consistent itemSize and normalized value".
  - Storage type follows the *first* geometry added. Later geometries with a different array type are converted component-wise, which is silently lossy if the first one was Int8.
- **Normals get crushed on 'high'.** `meshopt({ level: 'high' })`, the default, caps normals at **8 bits** (octahedral filter). 8-bit normals band visibly in the tight highlights of glossy cream and gold bevels. The research uses `'medium'` (10-bit), which is right, but R-009 doesn't pin it.
- **Scene volume costs precision.** `'scene'` over a placed neighborhood (~200 m) at 14 bits is ~1.2 cm per step, which rounds off a 20 cm stylized phone's bevels.

**Recommendation:**
- Either **dequantize to Float32 when copying into the BatchedMesh** (a few MB of VRAM at this scale, and it removes the whole class of bugs), or keep quantized data with a build-time validator that fails on any primitive whose attribute set, component type or normalized flag differs from the batch schema.
- Pin `level: 'medium'`, `quantizeNormal ≥ 10`, and `quantizePosition: 16` if a volume spans a placed neighborhood.
- Skip gltf-transform `instance()` for anything headed into BatchedMesh. It emits `EXT_mesh_gpu_instancing`, which GLTFLoader turns into an `InstancedMesh` you'd then have to unpack.

### S-2 Shadow policy contradicts animated casters
**Where:** R-007 ("updated only on pan or sun change") vs R-005 (injection on `customDepthMaterial` "so sway and dissolve show up in shadows"); D-021 (hover lifts the whole neighborhood); D-018 (the reveal rises the town).

**What's wrong:** with `autoUpdate = false`, swaying trees, the lifting neighborhood and the rising reveal all leave stale shadows. Camera flights and the ±35° orbit are continuous "pans" anyway. So the static-shadow saving only exists while the camera is idle, and even then only if nothing sways.

**Recommendation:** pick one policy and write it down:
- (a) Re-render the shadow map every frame on mid and high tiers. With B-2's granularity that is ~10–15 sub-draws at 2048², which is cheap on M-series.
- (b) Static shadows while idle; exclude sway from the depth pass (tiny amplitude, nobody will notice); let hover lift detach from its shadow on purpose (it reads as levitation, which is arguably nicer).
- (c) Fake the dappled canopy motion with a scrolling light-cookie term on receivers instead of animating casters.

Also quantize the shadow frustum **size** in power-of-two steps as well as texel-snapping the center, or zoom will shimmer.

### S-3 The bloom policy kills the night look it's meant to create
**Where:** spec §Neon ("only hovered objects' emissive rises above it"), R-006, D-020 low tier "shadows and bloom off", art pillar 6.

**What's wrong:**
- **The threshold rule:** if only hovered emissives exceed the threshold, night neon never blooms, even though "at night the neon does [carry the look]". The night boards are almost entirely glow halos on water and foliage.
- **The low tier:** dropping bloom there removes night entirely on exactly the devices least able to afford alternatives.
- **Golden-hour speculars:** the sun's specular on low-roughness gold regularly exceeds 1.0 in linear HDR. Expect sparkling, flickering bloom on thin gold bevels while panning (specular aliasing feeding bloom).

**Recommendation:**
- Drive the emissive multiplier *and* the bloom intensity/threshold from the time-of-day gradient. At night, neon sits at 2–4× the threshold always; hover adds more.
- Clamp specular contribution into the bloom input, or raise `luminanceSmoothing`.
- For low tier, give the neon tube shader a built-in **fake glow**: a fresnel/view-angle falloff on slightly oversized tube shells, or additive halo ribbons generated in Blender along the same curves. Night then reads without post.

### S-4 Night lighting is underspecified: emissives don't light anything
**Where:** R-007 ("Emissives carry night"), D-013, pillar 6.

**What's wrong:** in a forward renderer, emissive surfaces light nothing around them. The night refs are made of *light spill*: lantern pools on paths, neon washing terraces, lit windows glowing onto foliage. Emissives on dark PBR shapes read as glowing lines on black silhouettes. Real point lights change the program light count, which is part of the program cache key (`numPointLights` in [WebGLPrograms](https://github.com/mrdoob/three.js/blob/dev/src/renderers/webgl/WebGLPrograms.js)), and add per-fragment cost to every material.

**Recommendation:**
- **Bake a night-light layer** in Cycles: emission-only lighting from neon, lanterns and windows, into a second vertex attribute `_NIGHT` (RGB). The shader adds it to `indirectDiffuse`, scaled by the gradient's night weight. It is nearly free and matches the fixed, art-directed geometry.
- Add **additive light-pool decals** (ground quads) under lanterns and along paths.
- Add a dim, cool moon directional light.
- Keep the **wisp's point light permanently in the scene** (intensity 0 when hidden), and decide the maximum dynamic light count at boot.

### S-5 Water can't show the refs' reflections as specified
**Where:** D-017 (no planar reflections; "neon picked up as emissive streaks"), spec §Water, pillar 5.

**What's wrong:**
- **No reflection source:** "emissive streaks" with no reflection source can't know where the neon is. Hand-placing them per neighborhood contradicts "data-driven".
- **The draw-call premise:** D-017's reason ("would double draw calls") predates R-004's batching. With batches, a planar pass is ~10 draws, not ×2 of a large budget.
- **Depth cues:** the water also has no depth, shoreline or refraction cue, and the day refs show clear teal water with depth gradients.

**Recommendation** (this **contradicts D-017 as written**, so it's the owner's call):
- On mid and high tiers, render a **quarter-res, neon-and-emissive-only mirrored pass**. That is one or two draws: the neon batch, lit windows, plus the sky. Blur it vertically, distort it by the water normal and add it to the water. It delivers the signature night reflection streaks at a fraction of a full planar pass.
- Independently, **bake a river depth/shore-distance texture** from the Blender terrain for depth tint, shoreline foam and the teal-to-lavender gradient.

### S-6 The ambient model double-counts, and the env map has nothing for gloss and gold to reflect
**Where:** spec §Time of day ("hemisphere light, env map"), D-012, R-007, research §6.

**What's wrong:**
- **Double ambient:** `scene.environment` already supplies diffuse irradiance *and* specular to every `MeshStandardMaterial`. Adding a `HemisphereLight` driven by the same gradient double-counts ambient, which flattens the stylized-real contrast. The research offers the hemisphere as an *alternative*; the spec lists both.
- **Empty env content:** a pure sky gradient gives glossy cream undersides a bright sky reflection where the refs show dark green ground bounce. Gold (metalness 1) is *only* its reflections, and against a smooth gradient it reads as mustard plastic.
- **API detail (verified):** in r186, `fromCubemap` sizes the PMREM from the source (`_setSize(texture.image[0].width)`, [r186 PMREMGenerator](https://github.com/mrdoob/three.js/blob/r186/src/extras/PMREMGenerator.js)). A 64 px cube therefore gives a 64 px PMREM with very few mip levels (`LOD_MIN = 4`), which is too blurry for roughness 0.15–0.3 gloss. three `dev` (r187) adds `MIN_SIZE = 256`, so behavior changes on the next upgrade.

**Recommendation:**
- Choose **env for spec + diffuse** (hemisphere only on the low tier, with env diffuse disabled via injection), or env for spec + hemisphere for diffuse (inject to zero the env irradiance). Don't use both.
- Render the env cube at **256** from a small "env scene": sky gradient, a warm sun-glow lobe (HDR >1), horizon cloud bands, a **dark-green ground hemisphere** and optionally a low-poly town/forest silhouette ring.
- Regenerate it on the ~1° rule as planned.

### S-7 The AA strategy won't hold up for sub-pixel lattices, neon lines and foliage
**Where:** research §4 ("no MSAA or SMAA at DPR 2"), R-006.

**What's wrong:**
- **Sub-pixel detail:** at town level the long lens puts Voronoi struts, neon tubes and railings well below a pixel. At DPR 2 with no AA they crawl and moiré during every pan and flight, and bloom amplifies the flicker (S-3).
- **Alpha-tested foliage:** leaf cards alias no matter what without alpha-to-coverage.
- **What three already does:** three's `geometryRoughness` specular AA ([lights_physical_fragment](https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/lights_physical_fragment.glsl.js)) helps bevel highlights but not geometric sub-pixel edges.

**Recommendation:**
- Make the **mid LOD responsible for removing sub-pixel detail**: fewer, larger Voronoi cells, closed-off lattices, and neon tubes thickened by distance. This is a script parameter per tier.
- Test **DPR 1.5 + MSAA 4×** against **DPR 2 + SMAA** on the Air-class proxy, and prefer whichever is steadier in motion.
- Use `alphaToCoverage` for any cutout foliage when MSAA is on.
- On high tier, consider a cheap temporal term (TRAA is heavy; at minimum, don't jitter).

### S-8 Program-variant and recompile hazards the plan walks into
**Where:** D-020 / spec tiers ("shadows and bloom off"), research §3/§10 ("mount EffectComposer after the first frame", "warm with `compileAsync`").

**Verified hazards:**
- **Toggling shadows recompiles everything:** toggling `renderer.shadowMap.enabled` at runtime recompiles every program (`shadowMapEnabled` is in the cache key). The research says to fix it at boot, but the tier ladder toggles it. **Fix:** never toggle it. Set `light.shadow.intensity = 0` and stop updating the map on low tier.
- **`compileAsync` can warm the wrong variants:** program parameters depend on the **current render target**. Tone mapping is only baked into programs when rendering to the screen (`currentRenderTarget === null`; [WebGLPrograms](https://github.com/mrdoob/three.js/blob/dev/src/renderers/webgl/WebGLPrograms.js)). If `compileAsync` runs before the composer exists, or with no target bound, it warms screen variants, and the first composer frame compiles *again* synchronously, right at the reveal. **Fix:** bind a render target matching the composer's input buffer (HalfFloat, linear) before `compileAsync`.
- **Shadow programs aren't warmed:** `WebGLRenderer.compile` doesn't compile shadow-depth programs on WebGL (only the node path renders shadows there). **Fix:** force one `shadow.needsUpdate` render during loading, behind the cream ocean.
- **R3F defaults fight the plan** (verified in the 9.8.1 dist):
  - `toneMapping = ACESFilmicToneMapping` unless `flat`. The pre-composer frames would be ACES, then shift color when the composer mounts.
  - `antialias: true`.
  - `shadows` → `PCFSoftShadowMap`, which r186 removes with a warning.
  - **Fix:** pass `flat` and `gl={{ antialias: false, alpha: false }}`, and set `gl.shadowMap.type = PCFShadowMap` yourself.
- **BatchedMesh color variant:** the `batchingColor` variant appears on the first `setColorAt`. Set colors before the first render or warm-up.

### S-9 `discard` everywhere defeats Apple's hidden-surface removal
**Where:** R-005 (reveal dissolve `discard`s in main and depth passes), D-018, foliage clumps.

**What's wrong:** Apple GPUs are TBDR. A fragment shader containing `discard` produces "feedback" fragments that HSR can't cull early, and Apple recommends drawing opaque, then alpha-tested, then translucent ([WWDC20 "Optimize Metal Performance for Apple silicon Macs"](https://developer.apple.com/videos/play/wwdc2020/10632/)). Compiling the dissolve's `discard` into *every* material permanently turns the whole town into feedback fragments on the target hardware. That is overdraw you pay every frame for a 2.5 s effect.

**Recommendation:**
- The reveal doesn't need `discard`. The town rises *through an opaque cream ocean*, so depth already hides everything below the line. Implement the "glossy cream band" as a **color/roughness blend** above `revealHeight`, with no coverage change.
- Keep `revealHeight` as a uniform per D-018. It just doesn't clip.
- Keep foliage at mid LOD as **opaque geometry clumps**. Put cutout cards in their own late-drawn batch.

### S-10 Download and memory numbers don't add up, and Vercel won't compress the models
**Where:** spec budget (initial <3 MB, first frame <1.5 s), D-028 (Cortico hero stream ~2–4 MB), R-011 ("~3 MB total, don't unload"), R-009, D-026.

**What's wrong:**
- **Vercel won't compress the models:** Vercel's CDN only compresses an allowlist of MIME types, and `model/gltf-binary` isn't on it ([Vercel compression docs](https://vercel.com/docs/how-vercel-cdn-works/compression)). Meshopt output is designed to be followed by gzip/brotli, so uncompressed `.glb` is typically ~1.5–2× larger on the wire.
- **The size figures conflict:** a `/cortico` deep link puts the 2–4 MB hero stream on the critical path, which alone breaks "<3 MB initial". Nine neighborhoods at that density is ~20–35 MB, not "3 MB total", so R-011's "don't unload" premise doesn't hold at full scope, least of all for iOS Safari context-loss limits.
- **"<1.5 s" has no network profile.** On Lighthouse "Slow 4G", ~400 KB of brotli'd JS (three + R3F + React + RR + postprocessing + troika) alone takes about 2 s.

**Recommendation:**
- **Spike serving:** e.g. separate `.bin` geometry buffers with a header override to an allowlisted type, or confirm whether Vercel honours an overridden `Content-Type`. Measure the transferred bytes.
- State the budget per entry route (`/` vs `/cortico/platform`) and per network profile (e.g. "Fast 4G, 1.5 s to sky").
- Keep R-011 for Milestone 1, but mark it "revisit at 3+ neighborhoods".

### S-11 Pinch zoom in Safari isn't `ctrl+wheel`
**Where:** D-006 ("Pinch (`ctrl+wheel`) → zoom").

**What's wrong:** Safari on macOS delivers trackpad pinch as proprietary `gesturestart/gesturechange/gestureend` with a cumulative `scale`, not as ctrl+wheel ([d3-zoom #229](https://github.com/d3/d3-zoom/issues/229), [Dan Burzo, "Pinch me, I'm zooming"](https://danburzo.ro/dom-gestures/)). Unhandled, the gesture zooms the whole page. This is the owner's own browser and device class.

**Recommendation:** the input layer handles three sources (`wheel`+`ctrlKey` in Chromium and Firefox, `GestureEvent` in Safari, and pointer events on iPad) and normalises them into one zoom delta that feeds the detent. Call `preventDefault` on `gesturestart`. The decision in D-006 stands; only the mechanism note is wrong.

### S-12 Milestone 1 is too big for a beauty gate, and it's sequenced infrastructure-first
**Where:** spec §Milestone 1, D-013 (4 keyframes), D-014 (whole town skeleton), D-020 (tier ladder order).

**What's wrong:**
- **Too many unknowns at once:** the checklist has 16 items. It builds a Blender pipeline from zero (Blender isn't installed yet, per D-002), a material system, a four-keyframe lighting rig, a town skeleton, a forest, a reveal, navigation, routing, content, accessibility and a tier system. The one real unknown, *can procedural scripts produce buildings as beautiful as the boards?*, gets answered last.
- **Keyframe cost:** "every hour must look good" roughly doubles the look-dev work.
- **Tier order:** capping 120 → 60 Hz is the cheapest, least visible saving, but it's listed *last*.

**Recommendation:**
- Re-sequence as spike → vertical slice → breadth (see Spikes).
- For Milestone 1, art-direct **two** keyframes (golden hour and night, since night is the neon test) and let dawn and midday interpolate. This **contradicts D-013**, so it's the owner's call.
- Move the 60 Hz cap to the **first** down-step on high-refresh displays. This **contradicts D-020's ordering**.
- Consider running 120 Hz only while the camera is moving.

### S-13 The Blender pipeline needs a contract, a params/data split and a fast loop
**Where:** D-001, D-002, R-009, spec §Overview.

**Gaps:**
- **Write-back will drift.** "Anything liked in a live MCP session must be written back into the scripts" relies on discipline. Split *procedures* (Python) from *parameters* (a JSON or TOML per asset). The MCP or an add-on panel edits parameters, and saving writes the file. Write-back becomes a file save, not a code edit.
- **No conventions exist yet.** Pin a **Blender version** (e.g. 4.5 LTS; the API and exporter change between majors) and check it at startup. Fix exporter settings in code:
  - `export_apply=True`.
  - Colors: in Blender 4.1+, color attributes export only when wired into a material unless you set the 4.2+ "export color attributes with meshes" option ([Blender #123925](https://projects.blender.org/blender/blender/issues/123925), [glTF-Blender-IO #1740](https://github.com/KhronosGroup/glTF-Blender-IO/issues/1740)).
  - Custom attributes need `export_attributes=True` and a leading underscore.
  - Metadata such as batch, LOD, `_ID` groups and the hit volume go in `export_extras`.
  - Naming: `<hood>.<object>.<material>.<lod>`.
  - Units in metres, +Y up.
- **Techniques for the hard forms are unnamed.** Suggested:
  - Voronoi canopies: remesh → triangulate → **Dual Mesh** (Geometry Nodes) → per-face inset and delete → solidify → subdivision gives the bone-like lattice from the boards.
  - Terraces: curve-swept profiles with per-level offset noise.
  - Shells and petals: SDF/metaball or voxel remesh, then decimate.
  - Avoid `scipy`, which isn't bundled with Blender, or pin it in a vendored site-packages.
- **Iteration speed.** Rebuilding every asset headless on each tweak will kill art direction. Add per-asset content hashing (script + params → skip if unchanged), a watch mode, and a Vite plugin that hot-swaps the `.glb` in the running scene. Target <10 s from parameter save to pixels.
- **Look-dev happens in the browser, not Blender.** Eevee won't match three's shading, tone mapping or bloom. Put material and lighting parameters in a live tweak panel (leva or tweakpane) that writes back to `palette.ts` and the keyframe JSON.

### S-14 Foliage shading, the core of solarpunk, has no technique
**Where:** D-012 (foliage is one of 6–8 materials), pillar 4, research §2 (sway only).

**What's wrong:** lush, stylized-real foliage needs more than a green PBR material with sway. Without the pieces below, clumps look like green noise or green blobs, and at golden hour, the Milestone 1 default, backlighting is the whole look.

**Recommendation:** a foliage feature in the composer:
- **Normals transferred from a proxy volume** (sphere or ellipsoid per clump, done in Blender with Data Transfer) so clumps shade as soft masses.
- A **cheap translucency/back-light term**: wrap lighting plus view-to-sun alignment, times a thickness proxy.
- Per-instance hue and value jitter.
- An AO gradient toward the clump core (the `_AO` from B-1).
- Specular kept low.
- Keep D-012's toon-ramp option behind the same feature flag.

### S-15 No color grading or height fog, even though both are cheap and central to the look
**Where:** R-006 (tone mapping only; LUT "optional on high tier"), spec §Time of day ("fog").

**Recommendation:**
- Add a tiny grade effect to all tiers: lift, gamma and gain, saturation, and a warm/cool split-tone, with parameters **per keyframe** interpolated by the gradient. It merges into the existing `EffectPass` at almost no cost. Golden hour and night need different grades far more than they need a higher shadow resolution.
- Replace three's distance fog with **height + distance fog** injected via the composer, with its color sampled from the sky gradient at the view direction. This also hides the forest horizon seam (R-010).

---

## Consider

- **C-1 `setViewOffset` details** (D-022):
  - Re-apply it on every resize. R3F's resize updates the aspect, but `view.fullWidth/fullHeight` goes stale.
  - Fit shadows to the *visible* (offset) frustum.
  - Animate the offset with the panel.
  - Avoid `backdrop-filter` on the panel over a live canvas. The browser re-blurs every frame, which is expensive in Safari. Use a solid or pre-tinted panel.
- **C-2 LOD swap during flights:** swap mid → high hero geometry with `BatchedMesh.setGeometryIdAt` mid-flight while motion masks it, or with a short dithered crossfade. Reserve high-LOD vertex capacity up front so the swap never reallocates.
- **C-3 Depth precision:** a long lens plus "forest to the horizon" pushes `far` out and z-fights paths and river edges against terrain. Keep geometry within a bounded far plane and let fog and the horizon skirt do the rest. `reversedDepthBuffer` exists in r186 but needs `EXT_clip_control`, so check Safari. Avoid `logarithmicDepthBuffer`: it writes `gl_FragDepth` and kills early-Z and HSR.
- **C-4 Forest cards at neighborhood vantages** (R-010): the fixed-yaw premise holds only at town level. At `/cortico` (±35° orbit, lower pitch, 45–55° FOV) the card band may be seen at a different pitch. Either keep vantages from framing it, or bake cards at two pitches.
- **C-5 Hover state by group, not by instance:** store a group ID per instance or vertex (B-2) and keep hover, glow and lift in a small uniform array per group. A hover is then one uniform write and a spring on the CPU, with no DataTexture re-upload.
- **C-6 Stress probe timing** (R-003): running a 1 s next-tier probe during the reveal risks visible quality flips and jank in the hero moment. Probe after the reveal while idle, and cache the tier in `localStorage` keyed by the renderer string and screen.
- **C-7 Power:** swaying trees keep a laptop rendering at 60–120 fps forever. Drop to ~30 fps sway when idle (no input for N seconds) and while a panel is being read. D-010 already has Poppy "going still while you read".
- **C-8 Glass:** never use `MeshPhysicalMaterial.transmission`. It triggers a full extra opaque-scene render into a transmission target (`renderTransmissionPass` in [WebGLRenderer](https://github.com/mrdoob/three.js/blob/dev/src/renderers/WebGLRenderer.js)). Use fake glass: env reflection, Fresnel alpha and a tinted interior card. Put glass in its own late, non-shadow-casting batch.
- **C-9 Glossy cream:** consider `clearcoat` on the hero-LOD cream only (a Physical material variant) for the ceramic double-highlight in the boards. Budget it as a separate program.
- **C-10 Screen-space AO on high tier** (e.g. N8AO at half resolution) to cover contact that B-1's bake misses: moving props and the wisp. Not for Milestone 1.
- **C-11 Display P3 output** for the neon mint on Apple displays. It's a real fidelity win on the target hardware; check pmndrs composer support before committing.
- **C-12 Prerender specifics** (D-003, R-008):
  - React Router v8 requires React ≥19.2.7, Vite ≥7 and Node ≥22.22, and is ESM-only. `splitRouteModules` is now on by default ([changelog](https://reactrouter.com/changelog)).
  - Keep three, R3F and the scene out of the SSR module graph entirely, using a client-only lazy boundary, or the prerender will import browser-only addons.
  - Use `<Link prefetch="intent">` so MDX chunks are warm and loaders don't delay the start of a flight.
- **C-13 Mouse-wheel users** (D-006 deferred): recruiters on Windows mice currently can't zoom at all, since every notch pans. That's fine to defer, but add +/− keys and a visible zoom affordance so they aren't stuck.
- **C-14 Upward tiers:** "higher DPR" above 2 on the Max is supersampling with poor returns. Spend high-tier headroom on MSAA, a 4096 shadow map, the reflection pass (S-5) and SSAO instead.
- **C-15 Context loss:** handle `webglcontextlost`/`restored` from day one. It's cheap now and painful to retrofit into imperatively built batches.

## Nitpick

- **N-1 R-004 wording:** it says the DataTexture is "indexed by draw ID". It must be indexed by `getIndirectIndex(gl_DrawID)`. `gl_DrawID` is the position in the culled and sorted list and changes every frame. Research §1 has it right. Also, `gl_DrawID` exists only in the vertex stage; pass the result as a `flat` varying.
- **N-2** R-011 mentions `useGLTF.clear`, but R-009 says not to use `useGLTF`. Reword it as `useLoader.clear`.
- **N-3** The spec's budget line "~7 main plus 7 shadow draws" assumes every batch casts. Glass, neon and water shouldn't, so it's lower. The research draw-call table omits neon, glass, troika text (one draw per sign) and the wisp sprite.
- **N-4** `sortObjects = false` for opaque batches is right on Apple TBDR, but front-to-back sorting still helps early-Z on desktop Intel and NVIDIA. It's cheap to leave on for small instance counts.
- **N-5** "Approximate location from the browser timezone" gives an IANA zone, not coordinates. You'll need a zone → representative lat/long table for sunrise and sunset.
- **N-6** The R-006 note says "`@react-three/postprocessing` defaults to 8" multisampling. Also set `antialias: false` on the canvas (S-8), or the default framebuffer allocates MSAA it never uses.
- **N-7** The spec says tiers step "up" to "higher DPR". The owner's iPad, like every Safari, is locked near 60 Hz (R-002), so the 120 Hz tier is Chromium- and Firefox-only on the Max. Say so in the Milestone 1 checklist so it isn't tested on the iPad.

---

## Suggested spikes before Milestone 1

Timebox each at 1–3 days. Write each result into `decisions.md`.

1. **Hero look-dev slice (the beauty gate).** Build one Cortico building fragment: a Voronoi canopy over a terrace, gold trim, cream shell, one foliage clump and one neon curve. Render it in the browser with the real material composer, env and grade, at golden hour and night. Compare side by side with the boards. If this isn't exciting, nothing downstream matters.
2. **Blender → three round trip.** Pinned headless Blender, then parameters JSON, then Dual-Mesh Voronoi, then a Cycles AO bake to `_AO` and a night bake to `_NIGHT`, then glTF export, then the gltf-transform validator, then a Float32 BatchedMesh. Measure save-to-pixels time. This settles B-1, B-2, S-1 and S-13.
3. **Perf proxy calibration.** Run the same test scene on the Max (GPU timer), a real base Air or a cloud device, and one mid-range Android. Derive the `?perf=base` factor and the Max ms budget (B-3).
4. **Night and water.** Neon at night-level emissive with bloom, the fake-glow fallback with bloom off, the quarter-res neon-only reflection on water, and the baked light spill. This decides S-3, S-4 and S-5, and whether to revisit D-017.
5. **Shadows and dapple.** Test the Voronoi canopy's dappled shadow at the town fit and the vantage fit with 2048 PCF. Measure per-frame re-render cost with sway, then choose the S-2 policy.
6. **Delivery.** Deploy a Vercel preview with a prerendered route, a lazy canvas, meshopt `.glb`, and a compression workaround. Measure transferred bytes and time-to-sky on throttled Fast 4G and Slow 4G (S-10, C-12).
7. **Input.** Test Safari `GestureEvent` pinch, Chromium ctrl+wheel and iPad pointers normalised into one zoom model, plus the resistance detent. Tune the feel on the owner's devices (S-11).

## Things the plan gets right

- **Staying on WebGLRenderer** with a clean GLSL-snippet seam for a later TSL port. The WebGPU reasoning is accurate.
- **Material-keyed `BatchedMesh`** as the batching primitive, with draw calls budgeted *including* the shadow pass.
- **Khronos PBR Neutral** for saturated neon and gold, and the correct `mipmapBlur` knobs.
- **Meshopt over Draco, and no KTX2** until textures earn it.
- **A hand-fit, texel-snapped single shadow map** instead of CSM for a long-lens view.
- **PMREM regenerated on a threshold**, not per frame, with a reused target.
- **The fixed-yaw town**, which buys composition control, shadow fit and cheap forest cards.
- **A persistent canvas with a URL-addressed camera**, a prerendered HTML content layer that doubles as the keyboard and screen-reader interface, and hit volumes for picking.
- **`revealHeight` in every material from day one**, and a `PanelPresenter` seam so Poppy slots in later.
- **Tier detection that knows rAF can't see headroom** and treats `detect-gpu` as a prior only.
- **A decision log with rationale**, which made this review fast.
