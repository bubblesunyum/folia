// The gate's delivery-signal budget (fol-00p): per-neighborhood GLB byte+tri
// allowance plus shell/canvas JS gz caps, checked on exact local bytes.
// Runs in every lane. Runnable by hand as `pnpm budget` — the gate runs
// this exact file (scripts/verify.steps.sh: step "budget").
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { assertBuildFresh, CLIENT_INDEX } from './lib/fresh-build.mjs';

let failed = false;
const bad = (m) => { failed = true; console.error(`budget: failed: ${m}`); };
const say = (m) => console.log(`budget: ${m}`);

// Breadth starting allowance (D-072): 1 MB / 75k tris of town mid-LOD,
// plus 2 MB / 200k of route hero detail. Until separate LOD exports exist,
// enforce their combined ceiling across every asset in the neighborhood.
const HOOD_BYTES = 3_000_000;
const HOOD_TRIS = 275_000;
// Shell/canvas JS gz caps: shell re-measured post-router (fol-3qa) — the `/`
// initial-route chunk union is ~113 KB gz, so the cap holds ~20% headroom.
// Canvas re-measures at ~365 KB gz against its 450 KB cap.
const SHELL_GZ = 140_000;
const CANVAS_GZ = 450_000;

const manifest = JSON.parse(readFileSync('assets/manifest.json', 'utf8'));
const hoods = {};
for (const [asset, rec] of Object.entries(manifest)) {
  let bytes;
  try {
    bytes = statSync(join('public/assets', `${asset}.glb`)).size;
  } catch {
    bad(`${asset}.glb missing from public/assets`);
    continue;
  }
  if (bytes !== rec.bytes) {
    bad(`${asset}: manifest lists ${rec.bytes} bytes but the file is ${bytes} — rerun the asset build`);
  }
  const tris = Object.values(rec.triangles).reduce((a, b) => a + b, 0);
  const h = (hoods[asset.split('/')[0]] ??= { bytes: 0, tris: 0 });
  h.bytes += bytes;
  h.tris += tris;
}
for (const [hood, h] of Object.entries(hoods)) {
  say(`${hood}: ${(h.bytes / 1e6).toFixed(2)} MB glb, ${h.tris.toLocaleString('en-US')} tris`);
  if (h.bytes > HOOD_BYTES) bad(`${hood} glb bytes ${h.bytes} over allowance ${HOOD_BYTES}`);
  if (h.tris > HOOD_TRIS) bad(`${hood} tris ${h.tris} over allowance ${HOOD_TRIS}`);
}

// The client build must be current. React Router framework mode emits
// build/client (dist/ is pre-router output and must not be read). Fail closed
// when the build is missing or older than the sources that feed it.
const ASSET_DIR = join('build/client', 'assets');
if (!failed) {
  try {
    assertBuildFresh(CLIENT_INDEX);
  } catch (e) {
    bad(e.message);
  }
}
if (failed) process.exit(1);

const chunks = readdirSync(ASSET_DIR).filter((f) => f.endsWith('.js'));
const pick = (re, what) => {
  const hit = chunks.filter((f) => re.test(f));
  if (hit.length !== 1) {
    bad(`expected exactly one ${what} chunk, found ${hit.length}${hit.length ? ` (${hit.join(', ')})` : ''} — update the budget step`);
    return null;
  }
  return hit[0];
};
const gz = (f) => gzipSync(readFileSync(join(ASSET_DIR, f)), { level: 9 }).length;

// Shell JS is the `/` initial-route union from the React Router client
// manifest: the entry module plus its imports, the index route's chain up to
// the root (each route module plus its imports), and the manifest chunk
// itself, which the document imports before hydration. Anything ambiguous —
// not one manifest, not one index route, a broken parent chain — fails closed
// instead of measuring the wrong set.
const shellFiles = new Set();
{
  const manifests = chunks.filter((f) => /^manifest-[A-Za-z0-9_-]+\.js$/.test(f));
  if (manifests.length !== 1) {
    bad(`expected exactly one client manifest chunk, found ${manifests.length}${manifests.length ? ` (${manifests.join(', ')})` : ''} — update the budget step`);
  } else {
    const raw = readFileSync(join(ASSET_DIR, manifests[0]), 'utf8');
    const prefix = 'window.__reactRouterManifest=';
    if (!raw.startsWith(prefix)) {
      bad(`${manifests[0]} has an unexpected shape — update the budget step`);
    } else {
      let rr = null;
      try {
        rr = JSON.parse(raw.slice(prefix.length).replace(/;\s*$/, ''));
      } catch {
        rr = null;
      }
      if (!rr || !rr.entry || !rr.routes) {
        bad(`${manifests[0]} did not parse — update the budget step`);
      } else {
        const strip = (u) => String(u).replace(/^\/assets\//, '');
        shellFiles.add(manifests[0]);
        shellFiles.add(strip(rr.entry.module));
        for (const u of rr.entry.imports ?? []) shellFiles.add(strip(u));
        const indexRoutes = Object.values(rr.routes).filter((r) => r.index);
        if (indexRoutes.length !== 1) {
          bad(`expected exactly one index route, found ${indexRoutes.length} — update the budget step`);
        } else {
          let r = indexRoutes[0];
          const seen = new Set();
          for (;;) {
            if (seen.has(r.id)) {
              bad(`route parent chain loops at ${r.id} — update the budget step`);
              break;
            }
            seen.add(r.id);
            shellFiles.add(strip(r.module));
            for (const u of r.imports ?? []) shellFiles.add(strip(u));
            if (!r.parentId) break;
            r = rr.routes[r.parentId];
            if (!r) {
              bad('route parent chain leaves the manifest — update the budget step');
              break;
            }
          }
        }
      }
    }
  }
}
if (failed) process.exit(1);
{
  let total = 0;
  for (const f of [...shellFiles].sort()) {
    let n;
    try {
      n = gz(f);
    } catch {
      bad(`shell chunk ${f} missing from ${ASSET_DIR} — rebuild first`);
      continue;
    }
    total += n;
  }
  if (!failed) {
    say(`shell js gz ${(total / 1e3).toFixed(1)} KB across ${shellFiles.size} initial-route chunks (${[...shellFiles].sort().join(', ')})`);
    if (total > SHELL_GZ) bad(`shell js gz ${total} over cap ${SHELL_GZ}`);
  }
}
if (failed) process.exit(1);
const canvas = pick(/^TownCanvas-[A-Za-z0-9_-]+\.js$/, 'canvas');
if (canvas) {
  const n = gz(canvas);
  say(`canvas js gz ${(n / 1e3).toFixed(1)} KB (${canvas})`);
  if (n > CANVAS_GZ) bad(`canvas js gz ${n} over cap ${CANVAS_GZ}`);
}
if (failed) process.exit(1);
