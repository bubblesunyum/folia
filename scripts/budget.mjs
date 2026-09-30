// The gate's delivery-signal budget (fol-00p): per-neighborhood GLB byte+tri
// allowance plus shell/canvas JS gz caps, checked on exact local bytes.
// Runs in every lane. Runnable by hand as `pnpm budget` — the gate runs
// this exact file (scripts/verify.steps.sh: step "budget").
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

let failed = false;
const bad = (m) => { failed = true; console.error(`budget: failed: ${m}`); };
const say = (m) => console.log(`budget: ${m}`);

// Per-neighborhood allowance: cortico ships 1.82 MB / 171,540 tris.
const HOOD_BYTES = 2_500_000;
const HOOD_TRIS = 225_000;
// Shell/canvas JS gz caps (D-059 split): shell 70 KB, canvas 360 KB gz now.
const SHELL_GZ = 100_000;
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

const chunks = readdirSync('dist/assets').filter((f) => f.endsWith('.js'));
const pick = (re, what) => {
  const hit = chunks.filter((f) => re.test(f));
  if (hit.length !== 1) {
    bad(`expected exactly one ${what} chunk, found ${hit.length}${hit.length ? ` (${hit.join(', ')})` : ''} — update the budget step`);
    return null;
  }
  return hit[0];
};
const gz = (f) => gzipSync(readFileSync(join('dist/assets', f)), { level: 9 }).length;
const shell = pick(/^index-[A-Za-z0-9_-]+\.js$/, 'shell');
if (shell) {
  const n = gz(shell);
  say(`shell js gz ${(n / 1e3).toFixed(1)} KB (${shell})`);
  if (n > SHELL_GZ) bad(`shell js gz ${n} over cap ${SHELL_GZ}`);
}
const canvas = pick(/^TownCanvas-[A-Za-z0-9_-]+\.js$/, 'canvas');
if (canvas) {
  const n = gz(canvas);
  say(`canvas js gz ${(n / 1e3).toFixed(1)} KB (${canvas})`);
  if (n > CANVAS_GZ) bad(`canvas js gz ${n} over cap ${CANVAS_GZ}`);
}
if (failed) process.exit(1);
