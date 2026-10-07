"""Spike 1+2's hero fragment of Cortico: stacked terraces with gold trim, a
Voronoi canopy on a fluted trunk, a petal shell, foliage clumps spilling off
the levels, one mint neon line in the groove under a terrace lip, and a
reflecting pool below it.

Light-pool spots (fol-kes.4) are authored here at bake on the live terrace
outlines and written to the sibling fragment.pools.json, with a pools-only
sibling (fol-snu.9) carrying the same spots for the LightPools rig to read —
no runtime raycast. Every build rewrites both pools files,
so they can never drift from the geometry.
"""

import json
import math
from pathlib import Path

import numpy as np

from folia import foliage, forms, terraces
from folia.mesh import Part

# Sway retune point shared with swayModel.ts (fol-6di): custom clumps below
# thread it through exactly like terraces.edge_planting does.
_FOLIAGE_PARAMS = json.loads(
    (Path(__file__).resolve().parent.parent / "folia" / "foliage_params.json").read_text()
)

# The forum placement is single-sourced in the sibling forum-layout.json
# (fol-bll), like forum.py: the door frames face the forum centre, so they
# read it here rather than hand-copying it.
_FORUM_LAYOUT = json.loads((Path(__file__).with_name("forum-layout.json")).read_text())

TAU = math.tau

POOLS_PATH = Path(__file__).with_name("fragment.pools.json")
POOLS_ONLY_PATH = Path(__file__).with_name("fragment.pools.only.json")

# Light pools (fol-kes.4): lantern spill quads authored on walkable terrace.
# Radius/lift/spacing come from the "pools" params in fragment.json (the same
# object src/materials/lightPool.ts reads), so both stay in sync by
# construction. Pool centres stay half a pool radius inside the terrace edge
# (fol-snu.6): lantern light spills over the lip in reality, so the baked
# margin is 0.5x the pool radius — enough terrace under the quad's heart to
# ground it, with the falloff's rim allowed to wash over the edge. A disc
# reaching under a higher terrace is occluded, never floating, so only the
# containing outline constrains placement.


def _place(ob, x, y, z=0.0, rot=0.0):
    return terraces.place(ob, x, y, z, rot)


def assemble(p, rng):
    g = p["groups"]
    parts = []
    ground = p["ground"]
    parts.append(Part(forms.disc("ground", ground["radius"], ground["rings"], ground["sides"]), "ground", g["ground"]))

    # Terraces with gold trim, neon in the groove under a lip, foliage
    # spilling off the edges: the shared terrace-cluster composables.
    t_parts, outlines, levels = terraces.slabs_and_trim(p, rng, g["terrace"])
    parts.extend(t_parts)
    parts.append(terraces.groove_neon(p, outlines, levels, g["terrace"]))

    # The canopy: a fluted trunk flaring into a perforated umbrella.
    c = p["canopy"]
    cx, cy = c["position"]
    base = levels[0]["top"]
    tr = c["trunk"]
    trunk = forms.lathe_trunk("trunk", c["height"] - base - c["thickness"] * 0.5, tr["r_base"], tr["r_waist"], tr["r_top"],
                              tr["flutes"], tr["flute_depth"], tr["twist"])
    parts.append(Part(_place(trunk, cx, cy, base), "cream", g["canopy"]))
    canopy = forms.voronoi_canopy("canopy", c, rng)
    parts.append(Part(_place(canopy, cx, cy, c["height"]), "cream", g["canopy"]))

    # The shell: two rings of cupped petals, opening like a lotus.
    s = p["shell"]
    sx, sy = s["position"]
    for r, ring in enumerate(s["rings"]):
        for k in range(ring["count"]):
            jitter = 1 + rng.uniform(-1, 1) * s["jitter"]
            angle = TAU * (k + ring["phase"]) / ring["count"] + rng.uniform(-1, 1) * s["jitter"]
            ob = forms.petal(f"petal{r}.{k}", ring["length"] * jitter, ring["width"] * jitter, ring["cup"],
                             ring["tilt_base"], ring["tilt_tip"], s["thickness"], s["subdivisions"],
                             *s["resolution"])
            parts.append(Part(_place(ob, sx, sy, base, angle), "cream", g["shell"]))

    # Foliage clumps sitting on terrace edges, leaning out over them.
    parts.extend(terraces.edge_planting(p, outlines, levels, rng, g["planting"]))

    # A pond set into the lowest terrace: water inside a cream coping, with a
    # short neon run along its far rim for the water to reflect (D-039). Its
    # own seed, so the pond moves without reshuffling everything above.
    w = p["water"]
    pond_rng = np.random.default_rng(w["seed"])
    base = levels[0]["top"]
    edge = forms.blob_outline(w["radius"], w["harmonics"], pond_rng, w["samples"]) + w["centre"]
    parts.append(Part(forms.pool("pond", edge, base + w["lift"]), "water", g["terrace"]))
    rim = w["rim"]
    coping = forms.tube("coping", np.c_[edge, np.full(len(edge), base + rim["lift"])], rim["radius"], rim["sides"],
                        closed=True)
    parts.append(Part(coping, "cream", g["terrace"]))
    rim_neon = w["neon"]
    a, b = (int(f * len(edge)) for f in rim_neon["arc"])
    inward = -forms.outline_normals(edge)[a:b]
    line = edge[a:b] + inward * rim_neon["inset"]
    run = forms.tube("pond_neon", np.c_[line, np.full(len(line), base + rim_neon["lift"])], rim_neon["radius"],
                     rim_neon["sides"])
    parts.append(Part(run, "neon", g["terrace"]))

    # The rest of Cortico (fol-l7d.3): bubble homes, wild lawn clumps,
    # food-growing beds and the game lawn — all on mid groups, so the town
    # read gains the interconnected complex without touching the high split.
    t_group = g["terrace"]
    parts.extend(dwellings(p, outlines, levels, t_group))
    parts.extend(wild_clumps(p, outlines, levels, t_group))
    parts.extend(allotments(p, outlines, levels, t_group))
    parts.extend(leisure_lawn(p, outlines, levels, t_group))
    parts.extend(stepping_discs(p, outlines, levels, t_group))

    # Authored light-pool spots (fol-kes.4): every build rewrites the pools
    # file from these live outlines, so the TS rig can never drift from the
    # mesh. The pools-only sibling (fol-snu.9) carries the same spots without
    # the outlines, so the canvas chunk never bundles the full provenance
    # file — both are rewritten together and the placement spec pins them
    # in sync.
    layout = pool_layout(p, outlines, levels)
    POOLS_PATH.write_text(json.dumps(layout, indent=2) + "\n")
    POOLS_ONLY_PATH.write_text(json.dumps({"pools": layout["pools"]}, indent=2) + "\n")

    return parts


def _ring_walk_line(center, r, segments=24):
    # Plan-view ring the lantern pools follow.
    return [(center[0] + math.cos((i / segments) * TAU) * r,
             center[1] + math.sin((i / segments) * TAU) * r) for i in range(segments + 1)]


def _sample_walk_line(line, spacing):
    # Resample a walk line at `spacing` metres (start kept, spacing carried
    # across joints).
    out = [tuple(line[0])]
    acc = 0.0
    for i in range(1, len(line)):
        a, b = line[i - 1], line[i]
        dx, dz = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dz)
        if length == 0:
            continue
        travelled = spacing - acc
        while travelled <= length:
            t = travelled / length
            out.append((a[0] + dx * t, a[1] + dz * t))
            travelled += spacing
        acc = (acc + length) % spacing
    return out


def _point_in_outline(x, y, outline):
    inside = False
    n = len(outline)
    for i in range(n):
        ax, ay = outline[i]
        bx, by = outline[(i + 1) % n]
        if (ay > y) != (by > y):
            if x < ax + (y - ay) / (by - ay) * (bx - ax):
                inside = not inside
    return inside


def _dist_to_outline(x, y, outline):
    best = float("inf")
    n = len(outline)
    for i in range(n):
        ax, ay = outline[i]
        bx, by = outline[(i + 1) % n]
        abx, aby = bx - ax, by - ay
        denom = abx * abx + aby * aby
        t = ((x - ax) * abx + (y - ay) * aby) / denom if denom else 0.0
        t = max(0.0, min(1.0, t))
        best = min(best, math.hypot(x - (ax + abx * t), y - (ay + aby * t)))
    return best


def _floor_at(x, z, outlines, levels, ground=None):
    """The highest terrace top under (x, z): `ground` when off every outline
    (the lawn between terraces), fail-closed when no ground is given (a pod
    or bed straddling a lip is a build error, never a floating mesh)."""
    for i in reversed(range(len(outlines))):
        if _point_in_outline(x, z, outlines[i]):
            return levels[i]["top"], i
    if ground is None:
        raise ValueError(f"cortico: [{x}, {z}] is off every terrace")
    return ground, -1


def _sway():
    return {
        "sway_base_m": _FOLIAGE_PARAMS["sway_base_m"],
        "sway_top_m": _FOLIAGE_PARAMS["sway_top_m"],
    }


def _trim_ring(name, outline, z, trim, group):
    ring = outline + forms.outline_normals(outline) * trim["offset"]
    return Part(forms.tube(name, np.c_[ring, np.full(len(ring), z)],
                           trim["radius"], trim["sides"], closed=True), "gold", group)


def dwellings(p, outlines, levels, group):
    """Bubble homes (fol-l7d.3): stacked cream slabs with gold trim, a mint
    neon crown ring, a gold door frame facing the forum, and a roof garden.
    One builder for every pod (D-032 repeats share the code path); pod
    positions and radii are params, validated onto the terraces fail-closed."""
    parts = []
    h = p["housing"]
    rng = np.random.default_rng(h["seed"])
    for i, pod in enumerate(h["pods"]):
        cx, cz = pod["at"]
        base, _ = _floor_at(cx, cz, outlines, levels)
        r0 = pod["base_r"]
        b0 = forms.blob_outline(r0, h["harmonics"], rng, h["base_samples"]) + np.array([cx, cz])
        parts.append(Part(forms.slab(f"pod{i}.base", b0, base + h["base_h"], h["base_h"],
                                     h["edge_radius"], h["base_rings"],
                                     h["edge_segments"], h["rim_bias"]), "cream", group))
        parts.append(_trim_ring(f"pod{i}.trim", b0, base + h["base_h"] - h["trim"]["drop"],
                               h["trim"], group))
        ox, oy = h["top_offset"]
        b1 = forms.blob_outline(pod["top_r"], h["harmonics"], rng,
                                        h["top_samples"]) + np.array([cx + ox, cz + oy])
        parts.append(Part(forms.slab(f"pod{i}.top", b1, base + h["base_h"] + h["top_h"], h["top_h"],
                                     h["edge_radius"], h["top_rings"],
                                     h["edge_segments"], h["rim_bias"]), "cream", group))
        parts.append(_trim_ring(f"pod{i}.crown-trim", b1, base + h["base_h"] + h["top_h"] -
                               h["trim"]["drop"], h["trim"], group))
        crown = forms.circle_points(pod["top_r"] * h["neon"]["ring"], h["neon"]["samples"],
                                    base + h["base_h"] + h["top_h"] + h["neon"]["lift"],
                                    (cx + ox, cz + oy))
        parts.append(Part(forms.tube(f"pod{i}.crown", crown, h["neon"]["radius"],
                                     h["neon"]["sides"], closed=True), "neon", group))
        # Gold door frame on the forum side of the base drum.
        fx, fy = _FORUM_LAYOUT["centre"]
        phi = math.atan2(fy - cz, fx - cx)
        yaw = math.atan2(-math.cos(phi), math.sin(phi))
        d = h["door"]
        door = forms.box(f"pod{i}.door", d["w"], d["d"], d["h"])
        parts.append(Part(_place(door, cx + math.cos(phi) * (r0 - 0.05),
                                 cz + math.sin(phi) * (r0 - 0.05), base + d["h"] / 2, yaw),
                          "gold", group))
        roof = foliage.clump(f"pod{i}.roof", {**h["roof"], **_sway()}, rng)
        parts.append(Part(_place(roof, cx + ox, cz + oy,
                                base + h["base_h"] + h["top_h"] + h["roof"]["radii"][2] * 0.35,
                                rng.uniform(0, TAU)), "foliage", group))
    return parts


def wild_clumps(p, outlines, levels, group):
    """Wild greenery (fol-l7d.3): larger loose clumps on the lawn, clear of
    the walk rings by params, spilling over the lips where they stand near
    one (pillar 4). Own seed, so a retune never reshuffles the terraces."""
    parts = []
    w = p["wild"]
    wrng = np.random.default_rng(w["seed"])
    for i, (cx, cz) in enumerate(w["spots"]):
        base, _ = _floor_at(cx, cz, outlines, levels)
        foliage_only = {k: v for k, v in w.items() if k not in ("seed", "spots")}
        ob = foliage.clump(f"wild{i}", {**foliage_only, **_sway()},
                           wrng)
        parts.append(Part(_place(ob, cx, cz, base + w["radii"][2] * 0.35,
                                 wrng.uniform(0, TAU)), "foliage", group))
    return parts


def allotments(p, outlines, levels, group):
    """Food-growing beds (fol-l7d.3): cream raised beds with a gold rim and
    two crop rows each, in a line by the meadow walk. One builder per bed."""
    parts = []
    b = p["beds"]
    sx, sy = b["size"]
    for i, (cx, cz) in enumerate(b["spots"]):
        base, _ = _floor_at(cx, cz, outlines, levels)
        box = forms.box(f"bed{i}", sx, sy, b["height"])
        parts.append(Part(_place(box, cx, cz, base + b["height"] / 2), "cream", group))
        rim = b["rim"]
        x0, x1 = cx - sx / 2 + rim["inset"], cx + sx / 2 - rim["inset"]
        y0, y1 = cz - sy / 2 + rim["inset"], cz + sy / 2 - rim["inset"]
        loop = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        parts.append(Part(forms.tube(f"bed{i}.rim",
                                     np.c_[loop, np.full(4, base + b["height"] + rim["lift"])],
                                     rim["radius"], rim["sides"], closed=True), "gold", group))
        crng = np.random.default_rng(b["seed"] + i)
        for k, dx in enumerate((-sx / 4, sx / 4)):
            crop = foliage.clump(f"bed{i}.crop{k}", {**b["crop"], **_sway()}, crng)
            parts.append(Part(_place(crop, cx + dx, cz, base + b["height"] + 0.05,
                                     crng.uniform(0, TAU)), "foliage", group))
    return parts


def leisure_lawn(p, outlines, levels, group):
    """The game lawn (fol-l7d.3): a cream inlay disc with gold trim and a
    mint arc for night games, plus three benches facing it — the leisure
    anchor on the lawn between the fragment and the meadow."""
    parts = []
    c = p["court"]
    cx, cz = c["at"]
    ground = 0.0
    disc = forms.disc("court", c["radius"], c["rings"], c["sides"])
    parts.append(Part(_place(disc, cx, cz, ground + c["lift"]), "cream", group))
    ring = forms.circle_points(c["radius"], c["sides"], ground + c["lift"] + c["trim"]["drop"],
                                   (cx, cz))
    parts.append(Part(forms.tube("court.trim", ring, c["trim"]["radius"], c["trim"]["sides"],
                                 closed=True), "gold", group))
    n = c["neon"]
    arc = forms.circle_points(c["radius"] * 0.7, n["samples"], ground + n["lift"], (cx, cz))
    a, e = (int(f * len(arc)) for f in n["arc"])
    parts.append(Part(forms.tube("court.neon", arc[a:e], n["radius"], n["sides"]), "neon", group))
    ben = c["benches"]
    for k in range(ben["count"]):
        angle = TAU * (k + ben["phase_deg"] / 360) / ben["count"]
        bx, by = cx + ben["at_radius"] * math.cos(angle), cz + ben["at_radius"] * math.sin(angle)
        phi = math.atan2(cz - by, cx - bx)
        yaw = math.atan2(-math.cos(phi), math.sin(phi))
        sw, sd, st = ben["seat"]
        seat = forms.bevel(forms.box(f"bench{k}.seat", sw, sd, st), ben["bevel"], 2)
        parts.append(Part(_place(seat, bx, by, ground + 0.3 + st / 2, yaw), "cream", group))
        bw, bd, bt = ben["base"]
        foot = forms.box(f"bench{k}.foot", bw, bd, bt)
        parts.append(Part(_place(foot, bx, by, ground + bt / 2, yaw), "gold", group))
    return parts


def stepping_discs(p, outlines, levels, group):
    """Stepping discs from the fragment to the meadow (pillar 7): flat cream
    rounds on the pool walk line, riding the terrace tops where the line
    crosses them and the lawn past the lip."""
    parts = []
    s = p["steps"]
    ax, ay = s["from"]
    bx, by = s["to"]
    for i in range(s["count"]):
        t = 0.1 + 0.8 * i / (s["count"] - 1)
        x, z = ax + (bx - ax) * t, ay + (by - ay) * t
        y, _ = _floor_at(x, z, outlines, levels, ground=0.0)
        parts.append(Part(_place(forms.disc(f"step{i}", s["radius"], s["rings"], s["sides"]),
                                 x, z, y + s["lift"]), "cream", group))
    return parts


def pool_layout(p, outlines, levels):
    """Light-pool spots on walkable terrace, plain data for fragment.pools.json.

    Samples the plan-view walk lines, keeps the highest terrace top under each
    sample, and drops whatever is not walkable: off-terrace (lawn), inside
    half a pool radius of a lip (lantern spill washes over the edge, so the
    margin is 0.5x the radius rather than the whole disc), inside the
    trunk/petal/podium/pond footprints (plus one pool
    radius of clearance), or under the forum medallion. Uses no rng, so a
    rebuild from unchanged params rewrites the identical file.
    """
    pool = p["pools"]
    pool_radius = pool["radius"]
    pool_lift = pool["lift"]
    pool_spacing = pool["spacing"]
    pool_edge = pool_radius * 0.5
    lines = [_ring_walk_line([0, 0], 3.5), _ring_walk_line([0, 0], 5.5), _ring_walk_line([0, 0], 7.5),
             [(6, 2), (15, 4)]]
    trunk_at, trunk_r = p["canopy"]["position"], p["canopy"]["trunk"]["r_base"]
    shell_at = p["shell"]["position"]
    shell_r = max(ring["length"] for ring in p["shell"]["rings"])
    w = p["water"]
    pond_at = w["centre"]
    pond_r = w["radius"] * (1 + sum(w["harmonics"])) + w["rim"]["radius"]
    forum_layout = json.loads(POOLS_PATH.with_name("forum-layout.json").read_text())
    forum_params = json.loads(POOLS_PATH.with_name("forum.json").read_text())
    forum_at, forum_r = forum_layout["centre"], forum_params["medallion"]["radius"]
    # The rest of Cortico (fol-l7d.3): lantern pools stay off the pod drums,
    # the bed boxes and the game-lawn inlay (under a bench a pool is merely
    # occluded, but on a wall or the inlay it would float or double-brighten).
    # Crop rows sit a quarter bed-length off the bed centre, with a clearance
    # of the crop clump's lead radius plus its overhang.
    dwell_zones = [{"at": list(pod["at"]), "r": pod["base_r"] + 0.3}
                   for pod in p["housing"]["pods"]]
    court_zone = {"at": list(p["court"]["at"]), "r": p["court"]["radius"] + 0.2}
    half_row = p["beds"]["size"][0] / 4
    crop_r = p["beds"]["crop"]["radii"][0] + p["beds"]["crop"]["overhang"]
    bed_zones = []
    for cx, cz in p["beds"]["spots"]:
        bed_zones.append({"at": [cx - half_row, cz], "r": crop_r})
        bed_zones.append({"at": [cx + half_row, cz], "r": crop_r})
    extra = [*dwell_zones, court_zone, *bed_zones]

    pools = []
    for x, z in [s for line in lines for s in _sample_walk_line(line, pool_spacing)]:
        level = next((i for i in reversed(range(len(outlines)))
                      if _point_in_outline(x, z, outlines[i])), None)
        if level is None:
            continue
        if _dist_to_outline(x, z, outlines[level]) < pool_edge:
            continue
        if math.hypot(x - trunk_at[0], z - trunk_at[1]) < trunk_r + pool_radius:
            continue
        if math.hypot(x - shell_at[0], z - shell_at[1]) < shell_r + pool_radius:
            continue
        if math.hypot(x - pond_at[0], z - pond_at[1]) < pond_r + pool_radius:
            continue
        if math.hypot(x - forum_at[0], z - forum_at[1]) < forum_r + pool_radius:
            continue
        if any(math.hypot(x - zone["at"][0], z - zone["at"][1]) < zone["r"] + pool_radius
               for zone in extra):
            continue
        if any(math.hypot(x - kept["x"], z - kept["z"]) < pool_spacing for kept in pools):
            continue
        pools.append({"x": round(x, 3), "y": round(levels[level]["top"] + pool_lift, 3),
                      "z": round(z, 3), "r": pool_radius, "level": level})
    return {
        "source": {
            "asset": "cortico/fragment",
            "seed": p["seed"],
            "harmonics": list(p["terraces"]["harmonics"]),
            "levels": [{"centre": list(lv["centre"]), "radius": lv["radius"], "top": lv["top"]}
                       for lv in levels],
            "pools": {"radius": pool_radius, "lift": pool_lift, "spacing": pool_spacing},
            "exclusions": {
                "trunk": {"at": list(trunk_at), "r": trunk_r},
                "shell": {"at": list(shell_at), "r": shell_r},
                "pond": {"at": list(pond_at), "r": round(pond_r, 3)},
                "forum": {"at": list(forum_at), "r": forum_r},
                "dwellings": dwell_zones,
                "court": court_zone,
                "bedrows": bed_zones,
                "clearance": pool_radius,
            },
            "edgeMargin": pool_edge,
        },
        "outlines": [[[round(float(x), 3), round(float(y), 3)] for x, y in outline]
                     for outline in outlines],
        "pools": pools,
    }
