"""Town skeleton (fol-l7d.1): terrain, river, paths, construction plots, art hill.

Procedures only (D-034): the layout is single-sourced in `content/town/`
(one file per neighborhood plus `river.json`), which this module reads at
bake and the runtime reads through its own parser — never a hand copy, and
both fail closed on drift. `town.json` next to this file carries build-only
params (resolution, sizes, bake); plot positions and the river course live
only in `content/town/`.

Layout defaults (D-016, open questions settled one at a time with @bubbles;
these are sane spec defaults, stated not decided):
- river: an S-curve from the horizon (north, oldest work) to a mouth south
  of Cortico (newest, front and center at the origin). It passes west of the
  Cortico disc, clear of the meadow annex to the east.
- plots: the 8 non-Cortico hoods alternate banks in river (chronological)
  order. Art's plot sits on its own mound off-river to the east.
- bake: terrain/pads/scaffolds ride the standard placed-context `_AO` /
  `_NIGHT` bake (no neon in the skeleton, so `_NIGHT` is black sky); the
  river's depth/shore look is a generated top-down texture (D-039), written
  beside the export on every build so it can never drift from the course.

Cortico's placement is the identity: the skeleton is authored in world space
around the origin, so `POOL_OWNER_OFFSET` stays `[0, 0, 0]` and the pools
ride untouched until a placement moves the fragment.
"""

import json
import math
from pathlib import Path

import numpy as np

from folia import foliage, forms
from folia.mesh import Part, new_object
from folia.terraces import place

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent
PLACEMENT_DIR = ROOT / "content" / "town"
TEXTURE_OUT = ROOT / ".cache" / "blender" / "town" / "river-shore.png"

_FOLIAGE_PARAMS = json.loads((HERE / "foliage_params.json").read_text())

TAU = math.tau


# --- placement: the single source ------------------------------------------------

def _read_json(path):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        raise ValueError(f"town: missing placement file {path}")
    except json.JSONDecodeError as e:
        raise ValueError(f"town: {path.name} is not valid JSON ({e})")


def _require_finite(value, what):
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"town: {what} is not a finite number ({value!r})")
    return float(value)


def load_placement():
    """Per-hood placements plus the river, validated fail-closed.

    Returns `(hoods, river)` where each hood is a dict with at least
    `hood`, `centre` [x, z], `yaw`, `radius`, and river holds `course`
    [[x, z]...], `width`, `depth`, `banks`. A missing file, an unknown
    shape, or a non-finite number throws — never a half-built town.
    """
    if not PLACEMENT_DIR.is_dir():
        raise ValueError(f"town: missing placement dir {PLACEMENT_DIR}")
    hoods = []
    for path in sorted(PLACEMENT_DIR.glob("*.json")):
        if path.name == "river.json":
            continue
        raw = _read_json(path)
        for key in ("hood", "centre", "yaw", "radius"):
            if key not in raw:
                raise ValueError(f"town: {path.name} has no {key!r}")
        cx, cz = raw["centre"]
        hoods.append({
            "hood": raw["hood"],
            "centre": [_require_finite(cx, f"{path.name} centre[0]"),
                       _require_finite(cz, f"{path.name} centre[1]")],
            "yaw": _require_finite(raw["yaw"], f"{path.name} yaw"),
            "radius": _require_finite(raw["radius"], f"{path.name} radius"),
            "order": int(raw.get("order", 99)),
        })
    river = _read_json(PLACEMENT_DIR / "river.json")
    course = river.get("course")
    if not isinstance(course, list) or len(course) < 2:
        raise ValueError("town: river.json course needs at least 2 points")
    river["course"] = [[_require_finite(x, "river course x"), _require_finite(z, "river course z")]
                       for x, z in course]
    for key in ("width", "depth", "banks"):
        if key not in river:
            raise ValueError(f"town: river.json has no {key!r}")
        river[key] = _require_finite(river[key], f"river {key}")
    hoods.sort(key=lambda h: h["order"])
    names = [h["hood"] for h in hoods]
    if len(set(names)) != len(names):
        raise ValueError(f"town: duplicate hood placements {names}")
    if "cortico" not in names:
        raise ValueError("town: no cortico placement (the skeleton builds around it)")
    return hoods, river


# --- curves ----------------------------------------------------------------------

def _chaikin(points, iterations=2):
    pts = [tuple(p) for p in points]
    for _ in range(iterations):
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            out.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
            out.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
        out.append(pts[-1])
        pts = out
    return np.array(pts)


def resample(points, step):
    """Evenly spaced stations along a polyline, endpoints kept."""
    pts = np.asarray(points, dtype=float)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    total = seg.sum()
    n = max(2, int(round(total / step)) + 1)
    dist = np.linspace(0, total, n)
    edges = np.concatenate([[0], np.cumsum(seg)])
    out = []
    j = 0
    for d in dist:
        while j < len(seg) - 1 and edges[j + 1] < d:
            j += 1
        t = 0.0 if seg[j] == 0 else (d - edges[j]) / seg[j]
        out.append(pts[j] + (pts[j + 1] - pts[j]) * t)
    return np.array(out)


def dist_to_course(x, z, course):
    """Distance from each (x, z) to a polyline course (vectorized)."""
    shape = np.broadcast_shapes(np.shape(x), np.shape(z))
    p = np.stack([np.broadcast_to(x, shape).ravel(), np.broadcast_to(z, shape).ravel()], axis=-1)
    a = course[:-1][None, :, :]
    b = course[1:][None, :, :]
    ab = b - a
    denom = np.maximum((ab ** 2).sum(axis=-1), 1e-9)
    t = np.clip(((p[:, None, :] - a) * ab).sum(axis=-1) / denom, 0.0, 1.0)
    d = np.linalg.norm(p[:, None, :] - (a + ab * t[..., None]), axis=-1).min(axis=-1)
    return d.reshape(shape)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# --- height field: the one function everything samples ----------------------------

def base_height(x, z, course, river, hoods, art, und):
    """Terrain height before plot flattening (vectorized over x/z arrays)."""
    x = np.asarray(x, dtype=float)
    z = np.asarray(z, dtype=float)
    h = und * np.sin(x * 0.05 + 1.7) * np.cos(z * 0.043 + 0.6)
    h = h + 0.5 * und * np.sin(x * 0.11) * np.sin(z * 0.09 + 2.0)
    half = river["width"] / 2
    d = dist_to_course(x, z, course)
    carve = river["depth"] * (1 - smoothstep(0, half + river["banks"], d))
    carve = carve + 0.3 * (1 - smoothstep(0, half, d))
    h = h - carve
    if art is not None:
        ax, az = art["centre"]
        mh = float(art.get("mound_height", 7.0))
        sigma = float(art.get("mound_sigma", 16.0))
        h = h + mh * np.exp(-((x - ax) ** 2 + (z - az) ** 2) / (2 * sigma * sigma))
    return h


def pad_height(cx, cz, course, river, hoods, art, und):
    return float(base_height(np.array([cx]), np.array([cz]), course, river, hoods, art, und)[0])


def town_height(x, z, course, river, hoods, art, und, pads, cortico_floor, cortico_r, cortico_feather):
    """Final terrain height: base, flattened under Cortico and each plot pad."""
    h = base_height(x, z, course, river, hoods, art, und)
    d0 = np.hypot(np.asarray(x) - 0.0, np.asarray(z) - 0.0)
    f = 1 - smoothstep(cortico_r, cortico_r + cortico_feather, d0)
    h = h * (1 - f) + cortico_floor * f
    for (cx, cz, r, top) in pads:
        d = np.hypot(np.asarray(x) - cx, np.asarray(z) - cz)
        g = 1 - smoothstep(r, r + 4.0, d)
        h = h * (1 - g) + (top - 0.12) * g
    return h


# --- pieces -----------------------------------------------------------------------

def build_terrain(p, course, river, hoods, art, pads, group):
    t = p["terrain"]
    n = t["steps"]
    axis = np.linspace(-t["size"] / 2, t["size"] / 2, n + 1)
    gx, gz = np.meshgrid(axis, axis)
    h = town_height(gx, gz, course, river, hoods, art, t["undulation"], pads,
                    t["cortico_floor"], t["cortico_radius"], t["cortico_feather"])
    verts = np.stack([gx.ravel(), gz.ravel(), h.ravel()], axis=1)
    faces = []
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i
            faces.append((a, a + 1, a + n + 2, a + n + 1))
    # Blender Z-up: grid (x, y) with height as z.
    ob = new_object("terrain", [(vx, vy, vz) for vx, vy, vz in verts.tolist()], faces)
    return Part(ob, "ground", group)


def ribbon(name, line, half_widths, height_fn):
    """A flat-following ribbon along `line` (N,2), one height sample per edge."""
    line = np.asarray(line, dtype=float)
    tangent = np.gradient(line, axis=0)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-9)
    normal = np.stack([tangent[:, 1], -tangent[:, 0]], axis=1)
    half = np.broadcast_to(np.asarray(half_widths, dtype=float), (len(line),))
    left = line + normal * half[:, None]
    right = line - normal * half[:, None]
    verts = []
    for (lx, ly), (rx, ry) in zip(left, right):
        verts.append((lx, ly, float(height_fn(lx, ly))))
        verts.append((rx, ry, float(height_fn(rx, ry))))
    faces = [(2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1) for i in range(len(line) - 1)]
    return new_object(name, verts, faces)


def build_river(p, course, river, group, height_fn):
    stations = resample(_chaikin(course), p["water"]["ribbon_step"])
    half = river["width"] / 2 + 2.0
    level = p["water"]["level"]
    ob = ribbon("river", stations, half, lambda x, y: level)
    return Part(ob, "water", group)


def walk_lines(course, offset):
    """Riverside walks: the course offset to both sides."""
    pts = resample(_chaikin(course), 2.0)
    tangent = np.gradient(pts, axis=0)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-9)
    normal = np.stack([tangent[:, 1], -tangent[:, 0]], axis=1)
    return [pts + normal * offset, pts - normal * offset]


def nearest_on_lines(x, z, lines):
    best = None
    for line in lines:
        d = np.linalg.norm(line - np.array([x, z]), axis=1)
        i = int(np.argmin(d))
        if best is None or d[i] < best[0]:
            best = (float(d[i]), line[i])
    return best[1]


def build_paths(p, course, river, hoods, group, height_fn):
    pp = p["paths"]
    parts = []
    lines = walk_lines(course, pp["walk_offset"])
    for i, line in enumerate(lines):
        ob = ribbon(f"walk{i}", line, pp["width"] / 2,
                    lambda x, y: float(height_fn(x, y)) + pp["lift"])
        parts.append(Part(ob, "ground", group))
    for hood in hoods:
        if hood["hood"] == "cortico":
            continue
        cx, cz = hood["centre"]
        foot = nearest_on_lines(cx, cz, lines)
        spur = resample(np.array([[cx, cz], foot]), 2.0)
        ob = ribbon(f"spur-{hood['hood']}", spur, pp["spur_width"] / 2,
                    lambda x, y: float(height_fn(x, y)) + pp["lift"])
        parts.append(Part(ob, "ground", group))
    return parts


def _garden_params(p, radii):
    return {**p["garden"], "radii": list(radii),
            "sway_base_m": _FOLIAGE_PARAMS["sway_base_m"],
            "sway_top_m": _FOLIAGE_PARAMS["sway_top_m"]}


def build_plot(p, rng, hood, pad_top, g_pad, g_scaffold, g_planting):
    """One construction site: paved pad, scaffold frame, crane silhouette,
    half-grown garden clumps. Boxes read as scaffolding at town distance;
    detail arrives with the neighborhood builds."""
    parts = []
    pp = p["plots"]
    cx, cz = hood["centre"]
    r = hood["radius"]
    outline = forms.blob_outline(r, [0.05, 0.03], rng, pp["pad_samples"]) + np.array([cx, cz])
    parts.append(Part(forms.slab(f"pad-{hood['hood']}", outline, pad_top, pp["pad_thickness"],
                                0.12, pp["pad_rings"], 2, 1.5), "cream", g_pad))
    s = pp["post_size"]
    corners = [(cx - r * 0.55, cz - r * 0.55), (cx + r * 0.55, cz - r * 0.55),
               (cx + r * 0.55, cz + r * 0.55), (cx - r * 0.55, cz + r * 0.55)]
    for k, (px, py) in enumerate(corners):
        post = forms.box(f"scaffold-{hood['hood']}.{k}", s, s, pp["post_height"])
        parts.append(Part(place(post, px, py, pad_top + pp["post_height"] / 2), "gold", g_scaffold))
    for k, (a, b) in enumerate([(0, 1), (2, 3)]):
        ax, ay = corners[a]
        bx, by = corners[b]
        mx, my = (ax + bx) / 2, (ay + by) / 2
        length = math.hypot(bx - ax, by - ay) + s
        lintel = forms.box(f"lintel-{hood['hood']}.{k}", length, s, s)
        yaw = math.atan2(by - ay, bx - ax)
        parts.append(Part(place(lintel, mx, my, pad_top + pp["post_height"], yaw), "gold", g_scaffold))
    # Crane: a pylon with a jib, the construction read from the town view.
    px, py = cx + r * 0.4, cz - r * 0.4
    pylon = forms.box(f"crane-{hood['hood']}", 0.35, 0.35, pp["crane_height"])
    parts.append(Part(place(pylon, px, py, pad_top + pp["crane_height"] / 2), "gold", g_scaffold))
    jib = forms.box(f"jib-{hood['hood']}", pp["crane_jib"], 0.22, 0.22)
    parts.append(Part(place(jib, px + pp["crane_jib"] / 2 - 1.0, py,
                            pad_top + pp["crane_height"] - 0.3, 0.15), "gold", g_scaffold))
    # Half-grown gardens: small clumps on the pad rim.
    for k in range(int(p["garden"]["clumps_per_plot"])):
        angle = rng.uniform(0, TAU)
        gx = cx + math.cos(angle) * r * 0.75
        gy = cz + math.sin(angle) * r * 0.75
        ob = foliage.clump(f"garden-{hood['hood']}.{k}",
                           _garden_params(p, p["garden"]["radii"]), rng)
        parts.append(Part(place(ob, gx, gy, pad_top + 0.2, rng.uniform(0, TAU)),
                           "foliage", g_planting))
    return parts


def build_art_platform(p, rng, art, pad_top, g_pad, g_scaffold):
    """Art hill's crown: a viewing platform with plinths for future pieces."""
    parts = []
    cx, cz = art["centre"]
    outline = forms.blob_outline(6.0, [0.04, 0.02], rng, 56) + np.array([cx, cz])
    parts.append(Part(forms.slab("art-platform", outline, pad_top, 0.35, 0.14, 5, 2, 1.5),
                                "cream", g_pad))
    ring = outline + forms.outline_normals(outline) * 0.2
    parts.append(Part(forms.tube("art-trim", np.c_[ring, np.full(len(ring), pad_top - 0.1)],
                                0.09, 8, closed=True), "gold", g_scaffold))
    for k in range(5):
        angle = TAU * k / 5 + 0.3
        px, py = cx + math.cos(angle) * 3.4, cz + math.sin(angle) * 3.4
        plinth = forms.box(f"art-plinth.{k}", 0.9, 0.9, 1.1)
        parts.append(Part(place(plinth, px, py, pad_top + 0.55), "cream", g_pad))
    return parts


# --- forest edge (fol-l7d.5, retired runtime half in fol-l7d.15) -----------------
# Near trees stay runtime-instanced forever (D-032), so the bake carries only
# the static layers: single-view mid cards (R-010) and the far skirt (D-050).
# The ring definition (annulus + keep-clear over content/town/ + the
# foliage_params.json `forest` section) is the same input the runtime
# ForestEdge builds its fallback layers from. Baked and runtime mid/skirt
# overlap by design; the double-draw is retired by registry identity, not by
# radii — `bakedForestPresent` hides the runtime copies while `town/skeleton`
# is registered, so exactly one side draws the cards and the band.

def forest_ring(rng, fp, course, river, pads, count, r0, r1):
    """Area-uniform points in the annulus, clear of the river and plot pads."""
    f = fp["forest"]
    half = river["width"] / 2
    pts = []
    guard = 0
    while len(pts) < count and guard < count * 60:
        guard += 1
        angle = rng.uniform(0, TAU)
        r = math.sqrt(rng.uniform(r0 * r0, r1 * r1))
        x, z = r * math.cos(angle), r * math.sin(angle)
        if float(dist_to_course(np.array([x]), np.array([z]), course)[0]) < half + f["keep_river_m"]:
            continue
        if any(math.hypot(x - cx, z - cz) < pr + f["keep_plot_m"] for (cx, cz, pr, _top) in pads):
            continue
        pts.append((x, z))
    if len(pts) < count:
        raise ValueError(f"town: forest ring placed {len(pts)}/{count} (keep-clear too tight?)")
    return pts


def build_forest(p, rng, course, river, pads, group_cards, group_skirt, height_fn):
    """Mid cards facing the town centre plus the horizon skirt band."""
    fp = _FOLIAGE_PARAMS["forest"]
    parts = []
    m = fp["mid"]
    for k, (x, z) in enumerate(forest_ring(rng, _FOLIAGE_PARAMS, course, river, pads,
                                           int(m["count"]), float(m["r0"]), float(m["r1"]))):
        ob = foliage.forest_card(f"card{k}", float(m["card_w"]), float(m["card_h"]))
        # Local +Y (the card face) maps to (-sin yaw, cos yaw) under place();
        # atan2(x, -z) sends it at the town centre.
        yaw = math.atan2(x, -z)
        parts.append(Part(place(ob, x, z, float(height_fn(x, z)) + float(m["lift"]), yaw),
                          "foliage", group_cards))
    f = fp["far"]
    n = int(f["segments"])
    theta = np.linspace(0.0, TAU, n, endpoint=False)
    ring = np.stack([np.cos(theta) * float(f["skirt_r"]), np.sin(theta) * float(f["skirt_r"])], axis=1)
    ground = np.array([float(height_fn(x, z)) for x, z in ring])
    ob = foliage.skirt_band("skirt", float(f["skirt_r"]), ground - float(f["skirt_tuck"]),
                            float(f["skirt_top"]), n)
    parts.append(Part(place(ob, 0.0, 0.0, 0.0), "ground", group_skirt))
    return parts


# --- shore texture (D-039): depth + shore distance, top-down -----------------------

def shore_texture(course, river, size, resolution, foam_width):
    """R = water depth (1 mid-channel → 0 at the edge), G = foam band inland
    (1 at the waterline → 0 `foam_width` metres in), B = 0. Land is (0,0,0)."""
    axis = np.linspace(-size / 2, size / 2, resolution)
    gx, gz = np.meshgrid(axis, axis)
    d = dist_to_course(gx.ravel(), gz.ravel(), course)
    half = river["width"] / 2
    depth = np.clip(1 - d / half, 0, 1).reshape(resolution, resolution)
    foam = np.clip(1 - np.maximum(d - half, 0) / foam_width, 0, 1)
    foam = np.where(d < half, 0, foam).reshape(resolution, resolution)
    rgba = np.zeros((resolution, resolution, 4), dtype=np.float32)
    rgba[..., 0] = depth
    rgba[..., 1] = foam
    rgba[..., 3] = 1.0
    return rgba


def write_shore_texture(rgba):
    import bpy
    res = rgba.shape[0]
    TEXTURE_OUT.parent.mkdir(parents=True, exist_ok=True)
    img = bpy.data.images.new("river_shore", res, res, alpha=True)
    img.pixels = rgba.ravel().tolist()
    img.file_format = "PNG"
    img.filepath_raw = str(TEXTURE_OUT)
    img.save()
    bpy.data.images.remove(img)


# --- assemble ----------------------------------------------------------------------

def assemble(p, rng):
    g = p["groups"]
    hoods, river = load_placement()
    course = _chaikin(np.array(river["course"]))
    art = next((h for h in hoods if h["hood"] == "art"), None)
    art_full = None
    if art is not None:
        raw = _read_json(PLACEMENT_DIR / "art.json")
        art_full = {**art, "mound_height": float(raw.get("mound_height", 7.0)),
                    "mound_sigma": float(raw.get("mound_sigma", 16.0))}
    und = p["terrain"]["undulation"]
    # Pad crowns sample the unflattened field, so pads sit on the land.
    pads = []
    for hood in hoods:
        if hood["hood"] == "cortico":
            continue
        cx, cz = hood["centre"]
        top = pad_height(cx, cz, course, river, hoods, art_full, und) + p["plots"]["pad_lift"]
        pads.append((cx, cz, hood["radius"], top))

    def ground_height(x, y):
        t = p["terrain"]
        return float(town_height(np.array([x]), np.array([y]), course, river, hoods, art_full,
                                und, pads, t["cortico_floor"], t["cortico_radius"],
                                t["cortico_feather"])[0])

    parts = [build_terrain(p, course, river, hoods, art_full, pads, g["ground"])]
    parts.append(build_river(p, course, river, g["river"], ground_height))
    parts.extend(build_paths(p, course, river, hoods, g["ground"], ground_height))
    for hood in hoods:
        if hood["hood"] == "cortico":
            continue
        top = next(top for (cx, cz, r, top) in pads if (cx, cz) == tuple(hood["centre"]))
        if hood["hood"] == "art":
            parts.extend(build_art_platform(p, rng, hood, top, g["pad"], g["scaffold"]))
        else:
            parts.extend(build_plot(p, rng, hood, top, g["pad"], g["scaffold"], g["planting"]))

    # Forest (fol-l7d.15): the bake owns the static layers — mid cards facing
    # the town centre plus the horizon skirt — and the runtime `ForestEdge`
    # retires its own mid/skirt copies whenever this asset (`town/skeleton`)
    # is registered (`bakedForestPresent` over the TownRegistry presence, one
    # owner's membership never batch names). Near trees stay
    # runtime-instanced forever (D-032). Bake + runtime never double-draw:
    # exactly one side draws the cards and the band on every load.
    parts.extend(build_forest(p, rng, course, river, pads, g["cards"], g["skirt"],
                              ground_height))

    # The river's baked look, rewritten every build from the same course.
    write_shore_texture(shore_texture(course, river, p["terrain"]["size"],
                                     p["shore"]["resolution"], p["shore"]["foam_width"]))
    return parts
