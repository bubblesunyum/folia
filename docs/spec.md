# Portfolio Town: Build Spec

Sep 27, 2026 · @bubbles · revised after the design grilling session and the [spec review](reviews/2026-09-27-spec-review.md)

> **Decision log:** every choice below is recorded with its reasoning in **[decisions.md](decisions.md)**. IDs like `D-004` and `R-006` are referenced inline. Agents should read the log before changing direction, and append to it when a new decision is made.
> Also see: [art-direction/README.md](art-direction/README.md) · [research/perf-best-practices.md](research/perf-best-practices.md) · [reviews/](reviews/)

## Overview
A 3D portfolio site built as a solarpunk town seen from above. Each neighborhood is one project, and objects or buildings within it hold case studies. It should feel visual first, text second, and snappy to navigate.

- **Stack:**
  - Vite + React Router v8 in framework mode with `prerender`, fully static (D-003, R-008). One persistent `<Canvas>` lives in the root layout, and three and R3F stay out of the SSR module graph (D-047).
  - React Three Fiber 9 + drei + pmndrs postprocessing on WebGL2 (three r186) (R-001). Revisit WebGPU after launch, once its effects ecosystem matures.
  - TypeScript strict, pnpm, Vitest, Playwright and Biome (D-029).
  - Hosted on Vercel (D-026).
- **Asset pipeline** (D-001, D-002, D-034):
  - Headless **Blender Python scripts** in `assets/blender/**` are the procedural source of truth for all geometry. Each asset has a JSON params file.
  - The scripts assemble each neighborhood in place, bake `_AO` and `_NIGHT` vertex lighting, emit LOD tiers, and export through a custom gltf-transform step to Meshopt glTF with a schema validator (D-031, D-033).
  - A Blender MCP is used for live art direction, editing params only.
  - Look-dev happens in the browser, with a live tweak panel that writes back to `palette.ts` and the keyframe JSON.
- **Scale:** 9 neighborhoods (D-015). Only a few have full case studies; some have several.
- **First goal:** one gorgeous neighborhood, **Cortico**, that makes the concept exciting enough to keep building.

## World
One coherent town with a real layout, filling the whole screen. Beyond it, lush forest runs to the horizon.

- **Layout:** a **chronological river** winds from the horizon (oldest work) to the foreground (newest) (D-016).
  - Neighborhoods sit along its banks: Early work → Blackjack Genius → Glyphite → Purple Republic → Express Your Mess → Express Your Yes → Iron Ox → **Cortico**.
  - Cortico is front and center, where visitors land facing.
  - **Art** sits on a hill off the river.
  - Plot positions live in content data (`townLayout`, later `pathLayout`).
- **Camera** (D-007, D-008):
  - A perspective camera with FOV as part of every preset.
  - At town level, a long lens (~15–20°) gives a near-isometric view with a **fixed yaw**. Users can pan across the town and out over the forest.
  - Neighborhoods allow a limited orbit (~±35°) that springs back to the preset.
  - The far plane is bounded; fog and a horizon skirt do the rest (D-050).
- **Aesthetic:** futuristic solarpunk, not Blade Runner. **"Stylized-real"**: biomorphic, flowing architecture; gold and cream shells; bold colors; lush greenery; neon that traces the architecture's own curves. Detail is spent by camera distance. See [art-direction](art-direction/README.md) (D-027, D-028).
- **Surfaces and shading:**
  - Smooth stylized geometry with generous bevels (D-011).
  - Stylized PBR with about 6–8 shared, parameter-driven materials, lit by the sun plus an env map. The env map is rendered at 256 px from a small env scene: sky gradient, HDR sun glow, cloud bands, a dark-green ground and optionally a town silhouette. It supplies both specular and diffuse ambient, with no hemisphere light alongside it (D-012, D-040).
  - Baked `_AO` darkens indirect light only (D-031).
  - Foliage has its own shading feature: proxy-volume normals, back-light translucency, and hue and value jitter (D-045).
  - Glass is faked, never `transmission`. Hero cream may try `clearcoat` (D-050).
  - Khronos PBR Neutral tone mapping, plus a per-keyframe color grade and height + distance fog (R-006, D-046).
- **Palette:** built on the brand, from one `palette.ts` shared by the materials and the panel CSS (D-024).
  - Structure: gold and cream.
  - Bold paints: tangerine, butter, mint, lavender and hot pink.
  - Neon: **one signature color per neighborhood** (Cortico = mint).
  - Nature: forest-green foliage, and teal-to-lavender water at dusk.
- **Time of day** (D-013, D-037):
  - One gradient drives sun angle, sky, fog, the env map, the emissive multiplier, bloom intensity and threshold, and the color grade.
  - The system supports 4 keyframes (dawn, midday, golden hour, night). **Milestone 1 art-directs two**: golden hour (the default) and night. Dawn and midday interpolate until they're art-directed later.
  - By day the materials carry the look; at night the neon and its baked light spill do.
  - `?time=HH:MM` overrides the time for QA and demos, and there's a dev scrubber.
  - Later, the sun matches the real time at the visitor's location. The browser timezone (via Intl) maps to a representative lat/long through a zone table (D-050). Never show a geolocation prompt.
- **Night** (D-038):
  - Neon always blooms at night, and hover adds more.
  - `_NIGHT` baked spill, light-pool decals and a dim moon light make it light the world around it.
  - A built-in fake glow keeps night readable when bloom is off.
- **Water** (D-039):
  - A stylized shader with env reflection and Fresnel.
  - Depth tint, shore foam and the dusk gradient come from a baked depth / shore-distance texture.
  - On mid and high tiers, a quarter-res neon-only mirrored pass gives the night reflection streaks.
- **Cheap aliveness (early):** swaying trees, a few looping birds, drifting clouds.
- **Richer life (later):** people, plants opening and closing, time-based activity.

## Poppy
Poppy is a small faerie companion with a very fae personality: androgynous, leaning femme. She is the navigation UI in character form.

- **Stays in frame:** she flies to remain visible, which solves the problem of signs anchored to buildings drifting off screen.
- **Breadcrumbs:** she carries the neon sign showing where you are (e.g. "cortico › platform"), in the neighborhood's neon color.
- **Leads movement:** on zoom-out she darts up first and the camera follows.
- **Conjures 2D panels:** she summons them from particles and dissolves them away. When a panel is open she **perches on its top-right edge**, as if holding it open (D-023).
- **Guides:** she points out the fast-path portals on arrival and nudges idle visitors toward a neighborhood.
- **Expresses through motion:** bobbing, circling, going still while you read. Minimal text.
- **Milestone 1:** a placeholder **glowing wisp** (point light, sprite and bob) behind a `PanelPresenter` seam, so Poppy slots in later (D-010). Its point light is always in the scene, at intensity 0 when hidden (D-038).

## Navigation
Depth follows content, not a fixed level count. Every move is a camera flight toward whatever is actually there.

- **Hover a neighborhood:** its buildings and objects lift off the ground and glow neon.
  - On touch, the first tap lifts and the second tap enters.
  - Picking uses one invisible low-poly hit volume per neighborhood.
  - Hover state is per group (`_ID`), so a hover is one uniform write (D-032).
- **Click a neighborhood:** the camera flies to its predefined vantage point. High-LOD hero geometry swaps in mid-flight while motion masks it (D-050). You can then look around at the objects representing parts of the project.
- **Case-study objects:** inside a neighborhood, only the case-study objects are interactive, e.g. Cortico's three forum pedestals. The rest is scenery. Clicking one opens its case study, and switching between case studies **replaces** history (D-021).
- **Skip empty steps:** a project with one case study redirects straight into it, with no lobby level, unless the neighborhood is rich enough to be worth seeing (D-005).
- **Enter a building (later):** a museum-style gallery on rails.
  - The camera dollies between exhibit stops (click, arrow keys or swipe to advance), with free look at each stop.
  - Stops show design captures and short placards.
  - There's no free first-person walking.
  - Each gallery is its own lazily loaded scene.
- **Input mapping (D-006, D-048):**
  - Two-finger swipe pans and pinch zooms. Pinch arrives three ways, all normalized into one zoom delta:
    - `ctrl+wheel` in Chromium and Firefox;
    - `GestureEvent` in Safari, which must be `preventDefault`ed;
    - pointer events on the iPad.
  - **Zooming out past a Place's minimum rises one level after a resistance detent.**
  - Escape rises one level. Rising uses the same easing every time.
  - `+`/`−` keys and a visible zoom affordance cover mouse-wheel users until notch detection lands.
- **Orientation:** breadcrumbs live in the world (neon signage carried by Poppy), never in flat UI chrome.
- **Fast path:** labeled portals or floating gems in the sky give one-click access to Resume, Contact, Best work and Simple (the plain portfolio view at `vintage.bubblesbuilds.com`). Labels are plain and legible.

## Routing and accessibility
Every place in the town has a URL, and every piece of content has an HTML equivalent. Recruiters share links, not directions.

- **Routes (D-004):**
  - `/` is the town overview.
  - `/<project>` is a neighborhood, e.g. `/cortico`.
  - `/<project>/<case>` is a case study, e.g. `/cortico/platform`.
  - Slugs are unique within their parent. Reserved top-level words (`resume`, `contact`, `simple`, …) are enforced at build.
  - Deep links load straight into that camera state. URL and camera stay in sync, including browser back and forward.
  - Entering a Place or rising **pushes** history. Gallery stops use `?stop=N` via `replaceState`.
  - Links use `<Link prefetch="intent">` so content chunks are warm before a flight starts (D-047).
- **Camera state:** a serializable `{ place, offset }`. The offset (pan, zoom, look-around) is ephemeral and never in the URL, but the model is ready for a future `?cam=` share param.
- **HTML content layer:** each route renders real, prerendered HTML (titles, text, images, meta tags) from the same MDX that feeds the panels, serving crawlers, link previews and screen readers.
- **Camera system:** one camera controller, with per-location presets (position, target, FOV, `yawRange`, zoom limits) defined in content data, driving every flight.
- **Keyboard:** each Place renders real `<a>` links. Focus drives the same 3D lift and glow as hover, and Enter follows the link. Escape zooms out.
- **Reduced motion:** honor `prefers-reduced-motion` with shortened or cut camera flights and animations.

## Content model
Content is data-driven so new projects slot in without new code: **MDX with Zod-validated frontmatter**, plus a registry mapping each content `kind` to its 3D renderer (D-019).

```
content/cortico/
  index.mdx        ← project: title, townLayout, camera preset, neon color, meta
  platform.mdx     ← case study: kind: "panel", object: "laptop", camera preset, body
  recorder.mdx
  medley.mdx
  media/
```

| Level | Represents | Holds |
|---|---|---|
| Neighborhood | A project | Visual overview; objects standing for project components |
| Pedestal object / building | A case study | Opens a 2D panel, or later a walkable gallery |
| Poster / billboard | A lighter project | Text and gallery images placed around the area |
| 2D panel | Work that reads better flat | A typical case-study page (screens, type, flows) |

- Lighter projects are never empty lots. One option is posters and billboards instead of buildings; "Early work" is a neighborhood made of them.
- **2D panels (D-022, D-050):**
  - A side sheet on the **right** (~45% of the width, max ~640px of readable measure) that scrolls internally. It's solid or pre-tinted, with no `backdrop-filter`.
  - The camera reframes with `setViewOffset` so the world sits centered in the uncovered left area.
    - The offset animates with the panel and is re-applied on every resize.
    - Shadows fit the visible frustum.
    - The world stays live and hoverable.
  - Below ~900px the panel becomes a bottom sheet.
  - It has a one-word **"Close"** button. Escape, the zoom-out detent, clicking the wisp or clicking empty world also close it.
  - Panels are real DOM over the canvas: crisp text, links, accessibility and responsive layout.
  - Later, they materialize out of a "quantum soup" of particles and dissolve back. The particle effect runs in WebGL behind the DOM, synced with a DOM mask or opacity reveal.
- The vocabulary will expand and change, so new kinds are added by registering a renderer, not by rewriting.

## Typography (D-025)
- **Parkinsans** for panels and headings. Headings are lowercase.
- **Optician Sans** for buttons.
- An OFL pixel font (Silkscreen or Pixelify Sans) as a sparing accent.
- In-world neon signs use Parkinsans lowercase as SDF text with an emissive tube shader.

## Mobile
The town animates and rearranges itself as the viewport narrows, becoming a winding vertical path.

- Neighborhoods zigzag down the screen (top right, center left, bottom right, and so on), like the Duolingo lesson path, **in river order**.
- Users scroll the path. Tapping a neighborhood behaves as clicking does on desktop.
- The reflow is animated, not a hard switch, so resizing a desktop window shows the town reorganizing. Store two layout targets per neighborhood (town and path), tween between them, and debounce resize.

## Performance
Performance is a first-class requirement: fast and beautiful, never one at the expense of the other. Research is in [research/perf-best-practices.md](research/perf-best-practices.md); where it conflicts with [decisions.md](decisions.md), the decisions win.

- **Geometry granularity (D-032):**
  - Unique architecture is merged at build time per *(neighborhood × material × LOD)* and added to one `BatchedMesh` per shared material.
  - A per-vertex `_ID` attribute identifies buildings and pedestals for hover, lift and glow.
  - True repeats (trees, planters, lamps, seating, crane parts) are instanced.
- **Attribute contract (D-033):**
  - One schema per batch, enforced by a build-time validator.
  - Geometry is dequantized to Float32 at load.
  - Meshopt is pinned to `level: 'medium'` with ≥10-bit normals.
- **Shared, parameter-driven materials (R-005, D-044):**
  - `onBeforeCompile` feature injection covers group color, sway, lift and glow, `_AO`, `_NIGHT`, foliage and `revealHeight`. It is also applied to the shadow-depth materials.
  - **No `discard` in shared materials.** Draw order is opaque, then alpha-tested, then translucent.
- **Fidelity by distance (D-028, D-042):**
  - The town view uses mid-LOD geometry and opaque foliage clumps.
  - The mid LOD removes sub-pixel detail: bigger Voronoi cells, closed lattices, and neon thickened with distance.
  - Neighborhood vantages stream in high-LOD hero geometry, preloaded on hover-intent.
  - The forest horizon uses single-view baked cards (R-010). Vantages avoid framing the cards at a new pitch.
- **Renderer setup (D-043):**
  - `<Canvas flat gl={{ antialias: false, alpha: false }}>`, with `PCFShadowMap` set by hand and tone mapping owned by the composer.
  - `shadowMap.enabled` is never toggled.
  - Shader warm-up uses a composer-matching render target plus one forced shadow render during loading.
  - Context loss is handled from day one.
- **Lighting (D-031, D-038, D-040, D-041):**
  - Baked `_AO` and `_NIGHT` vertex lighting.
  - One hand-fitted directional shadow, re-rendered every frame on mid and high tiers (spike 5 confirms). The frustum is fit to the visible view, texel-snapped and size-quantized.
  - The env map is regenerated via PMREM when the sun moves about 1°.
- **Bloom and neon (R-006, D-038):**
  - One global mipmap bloom, with threshold and intensity driven by the time of day.
  - Specular is clamped out of the bloom input.
  - Neon has a fake-glow fallback for when bloom is off.
  - No selective-bloom passes.
- **Antialiasing (D-042):** spike 3 decides between DPR 1.5 + MSAA 4× and DPR 2 + SMAA. Cutout foliage uses `alphaToCoverage`.
- **Quality tiers (D-036, R-002, R-003):**
  - **Down:** 60 Hz cap first, then DPR, then shadows (intensity 0), then bloom (fake glow).
  - **Up:** MSAA, a 4096 shadow map, the water reflection pass, and later SSAO. Never DPR above 2.
  - 120 Hz only in Chromium and Firefox, and only while the camera moves.
  - Tiers are chosen by a frame-time probe, plus a stress probe for upgrades that runs after the reveal while idle. The result is cached per renderer and screen. `detect-gpu` is only a prior.
  - Idle and panel-reading drop ambient motion to ~30 fps.
- **Asset compression and delivery (R-009, D-047):**
  - Meshopt for geometry. No KTX2 until textures justify its ~217 KB transcoder.
  - Vercel doesn't compress `.glb`, so spike 6 picks the workaround.
- **Loading and reveal (D-018, D-044):**
  - The sky gradient and a cream "ocean" wave shader appear first while the town streams.
  - The town then rises through the opaque cream, and a glossy cream band flows off it as a color and roughness blend above `revealHeight`. There's no clipping and no fluid simulation.
  - The reveal never waits on itself, is capped at about 2.5 s, is shortened on repeat visits and deep links, and respects reduced motion.
  - Each neighborhood streams in its own Suspense boundary (R-011). Don't unload in Milestone 1; revisit at 3+ neighborhoods.
- **Measure (D-035):**
  - The HUD shows FPS, **GPU ms** (timer query, Chrome), CPU ms, `render.calls`, **multi-draw sub-draws**, triangles and texture memory from day one.
  - `?perf=base` fixes the base Air's 1280×800 CSS size and caps at 60 Hz. The buffer is 1920×1200 with the chosen DPR 1.5 + MSAA mode, or 2560×1600 with DPR 2 modes (D-055). For now the proxy on the Max is the only performance check. Calibration on real low-end hardware (a base Air, a mid-range Android, in-app browsers) is deferred until before launch (D-051).
  - **Budget** (calibrated on the Max proxy; real-device factors before launch):
    - ≤ 2.5 ms saturated-frame wall on the M1 Max under default `?perf=base` (MSAA, 1920×1200), at golden hour and at night; `scripts/bench.mjs` prints the verdict (D-063). Timer-query GPU ms stays indicative only (D-055).
    - Under ~100 `render.calls`, plus sub-draws ≤ 3000.
    - Download and time-to-sky budgets per entry route and network profile, e.g. "`/` on Fast 4G: sky within 1.5 s" (D-047).
  - On phones, cap the pixel ratio at 1.5–2.

## Sound, fallback and design rules
- **Sound:** ambient audio (birdsong, a soft town hum). Off by default, enabled through a clever in-world control.
- **Fallback:** if WebGL fails or the device is too weak, redirect to `vintage.bubblesbuilds.com`. Before redirecting, sample frame time early and step down quality tiers; redirect only if the lowest tier still struggles. The Simple portal offers the plain view by choice too.
- **Labels:** keep labels for fields and controls very short, ideally one word ("Message", not "Get in touch"; "Close").
- **Section separation:** use generous spacing, not dividers or rules.
- **No eyebrows:** no small uppercase kicker lines above headlines.
- **In-world first:** avoid flat website chrome wherever a 3D object can do the job.

## Hosting (D-026)
- Vercel. Previews go to a `noindex` subdomain (e.g. `town.bubblesbuilds.com`).
- At launch the town takes over `design.bubblesbuilds.com`, and the Framer site moves to `vintage.bubblesbuilds.com`.
- The old slugs (`/cortico`, `/webtoy`, `/glyphite`) redirect to the new routes.

## Milestone 1: one exciting neighborhood (Cortico)
Build a single real neighborhood that looks good enough to sustain momentum. Beauty is the success test. The work runs **spikes → vertical slice → breadth**, so the biggest unknown (can scripted buildings be as beautiful as the boards?) is answered first (D-049).

### Phase 0: spikes
Timebox each at 1–3 days, and log each result in [decisions.md](decisions.md).

- [x] **0. Minimal scaffold:** Vite + R3F canvas with the D-043 config, a stats-gl HUD (GPU ms, calls, sub-draws), a leva or tweakpane panel and `?time=`.
- [x] **1 + 2. Hero look-dev slice and the Blender → three round trip.** Build one Cortico fragment: a Voronoi canopy over a terrace, gold trim, a cream shell, one foliage clump and one neon curve.
  - **Pipeline:** pinned Blender, params JSON, Dual-Mesh Voronoi, `_AO` and `_NIGHT` bakes in placed context, glTF export, the schema validator, then a Float32 `BatchedMesh` with a `_ID` group.
  - **Render it** with the real material composer, env scene and grade, at golden hour and at night. Compare it side by side with the boards.
  - **Measure** save-to-pixels time (target under 10 s).
  - **Settles** B-1, B-2, S-1 and S-13. If the fragment isn't exciting, stop and fix the look before anything else.
- [x] **3. Perf proxy on the Max.** Run one test scene under `?perf=base`; the Metal GPU timer proved unstable, so saturated-frame throughput is the gated proxy (D-063). Set the sub-draw budget and choose between DPR 1.5 + MSAA 4× and DPR 2 + SMAA (D-055). Real low-end device testing remains deferred (D-051).
- [x] **4. Night and water.** Neon at night-level emissive with bloom; the fake-glow fallback with bloom off; the quarter-res neon reflection on water; baked spill. Light-pool decals deferred to fol-0sj (D-038, D-039, D-057).
- [x] **5. Shadows and dapple.** The Voronoi canopy's dappled shadow resolves at the town fit and the vantage fit with 2048 PCF; per-frame re-render with sway costs nothing resolvable, so D-041's live default stands (D-058).
- [x] **6. Delivery.** A Vercel preview with a prerendered route, a client-only lazy canvas and a Meshopt `.glb` with a compression workaround. Measure transferred bytes and time-to-sky on throttled Fast 4G and Slow 4G, and set the per-route budgets (D-047).
- [x] **7. Input.** Safari `GestureEvent`, Chromium `ctrl+wheel` and iPad pointers normalized into one zoom model with the resistance detent (D-048, D-060). On-device tuning on the Max and the iPad deferred to fol-j08.

### Phase 1: vertical slice
- [x] React Router v8 prerender with the persistent canvas; routes `/cortico` and `/cortico/<slug>`; the MDX + Zod content schema and kind registry
- [x] Shared material system with all features (group color, sway, lift/glow, `_AO`, `_NIGHT`, foliage, `revealHeight`) and `palette.ts`
- [x] Time-of-day gradient with **golden hour and night** art-directed, the env scene, grade, height fog, `?time=` and the dev scrubber
- [x] The Cortico **forum** with its **three pedestals** (laptop, phone, audio glyph) and mint neon, at hero LOD
- [x] Hover or first tap lifts and glows a pedestal; click or second tap goes to `/cortico/<slug>` and opens the right-side DOM panel with the wisp placeholder, `PanelPresenter` seam, view offset and "Close"
- [x] Beauty check against the boards at golden hour and night, then saturated frame throughput against the calibrated budget (D-063)

Completed in fol-l1r, reconciled by fol-b41: real build-time MDX (D-019), sky-colored height + distance fog (D-046), and all six slice requirements are implemented. Golden hour and night pass the ≤2.5 ms/frame saturated budget; the remaining water-ripple redesign stays in polish (fol-ixw). Remaining breadth concern (2026-10-03 review, fol-cs8): the beauty density gap — current blob-tree planting vs the spilling-jungle references — is deferred into breadth, unresolved here.

### Phase 2: breadth
- [ ] The rest of **Cortico**: an interconnected solarpunk complex (housing, food growing, curated and wild greenery, leisure) around the forum, at mid and high LOD
- [ ] Town skeleton: terrain, river (baked depth and shore texture), paths, 8 **construction-site** plots, Art hill; Cortico front and center
- [ ] Forest edge fading to the horizon (instanced trees, baked cards, horizon skirt in height fog)
- [ ] Simple cream-ocean loading reveal (blend, no `discard`), with shader and shadow warm-up behind it
- [ ] Pan, pinch zoom, zoom-out detent rise, Escape and `+`/`−`, all with consistent easing
- [ ] Hover at `/` (Cortico lifts and glows via its hit volume); camera flights to preset vantages with a mid-flight LOD swap; limited orbit at `/cortico`
- [ ] Swaying trees, with idle and reading dropping to ~30 fps
- [ ] Seed the 3 Cortico case studies by splitting the existing case study
- [ ] Keyboard navigation through the HTML content layer; reduced motion
- [ ] Quality tiers (D-036), context-loss handling
- [ ] Hit the budgets: GPU ms on the `?perf=base` proxy, `render.calls` and sub-draws, and the per-route delivery budgets (120 Hz is checked on the Max in Chromium only)
- [ ] Beauty density gap (fol-cs8, from the 2026-10-03 review): current blob-tree planting vs the spilling-jungle references, deferred from the Phase 1 beauty check

Out of scope for now: Poppy herself (the wisp stands in), the real-time sun (the gradient system is in), dawn and midday art direction, mobile reflow, sound, galleries, particle panel materialize, portals, SSAO.

## Later milestones
1. **Full town:** all 9 neighborhoods, data-driven content, dynamic-depth navigation, posters for lighter projects. Revisit unloading (D-047).
2. **Case studies:** walkable galleries with placards; 2D panels with the particle materialize and dissolve.
3. **Poppy:** companion behaviors, in-world breadcrumbs, zoom-out lead, panel conjuring.
4. **Launch essentials:** fast-path portals, fallback redirect, mobile path reflow, domain takeover, and perf calibration on real low-end devices (D-051).
5. **Atmosphere:** real-time sun (with the zone → lat/long table), dawn and midday keyframes, sound with an in-world toggle, birds, clouds, richer life, SSAO on the high tier, and the cream-reveal drips and splash.

## Open questions
Tracked at the bottom of [decisions.md](decisions.md#open-questions-not-yet-decided).
