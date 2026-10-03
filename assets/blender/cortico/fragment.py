"""Spike 1+2's hero fragment of Cortico: stacked terraces with gold trim, a
Voronoi canopy on a fluted trunk, a petal shell, foliage clumps spilling off
the levels, one mint neon line in the groove under a terrace lip, and a
reflecting pool below it.

Light-pool spots (fol-kes.4) are authored here at bake on the live terrace
outlines and written to the sibling fragment-layout.json, which the
LightPools rig reads — no runtime raycast. Every build rewrites the layout,
so it can never drift from the geometry.
"""

import json
import math
from pathlib import Path

import numpy as np

from folia import forms, terraces
from folia.mesh import Part

TAU = math.tau

LAYOUT_PATH = Path(__file__).with_name("fragment-layout.json")

# Light pools (fol-kes.4): lantern spill quads authored on walkable terrace.
# Radius/lift/spacing come from the "pools" params in fragment.json (the same
# object src/materials/lightPool.ts reads), so both stay in sync by
# construction. Pool centres stay a full pool radius inside the terrace edge,
# so the whole visible disc sits on the walk surface instead of spilling over
# the lip onto lawn or air. A disc reaching under a higher terrace is
# occluded, never floating, so only the containing outline constrains
# placement.


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

    # Authored light-pool spots (fol-kes.4): every build rewrites the layout
    # from these live outlines, so the TS rig can never drift from the mesh.
    LAYOUT_PATH.write_text(json.dumps(pool_layout(p, outlines, levels), indent=2) + "\n")

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


def pool_layout(p, outlines, levels):
    """Light-pool spots on walkable terrace, plain data for fragment-layout.json.

    Samples the plan-view walk lines, keeps the highest terrace top under each
    sample, and drops whatever is not walkable: off-terrace (lawn), too close
    to a lip, inside the trunk/petal/podium/pond footprints (plus one pool
    radius of clearance), or under the forum medallion. Uses no rng, so a
    rebuild from unchanged params rewrites the identical file.
    """
    pool = p["pools"]
    pool_radius = pool["radius"]
    pool_lift = pool["lift"]
    pool_spacing = pool["spacing"]
    pool_edge = pool_radius
    lines = [_ring_walk_line([0, 0], 3.5), _ring_walk_line([0, 0], 5.5), _ring_walk_line([0, 0], 7.5),
             [(6, 2), (15, 4)]]
    trunk_at, trunk_r = p["canopy"]["position"], p["canopy"]["trunk"]["r_base"]
    shell_at = p["shell"]["position"]
    shell_r = max(ring["length"] for ring in p["shell"]["rings"])
    w = p["water"]
    pond_at = w["centre"]
    pond_r = w["radius"] * (1 + sum(w["harmonics"])) + w["rim"]["radius"]
    forum_layout = json.loads(LAYOUT_PATH.with_name("forum-layout.json").read_text())
    forum_params = json.loads(LAYOUT_PATH.with_name("forum.json").read_text())
    forum_at, forum_r = forum_layout["centre"], forum_params["medallion"]["radius"]

    pools = []
    for x, z in [s for line in lines for s in _sample_walk_line(line, pool_spacing)]:
        level = next((i for i in (2, 1, 0) if _point_in_outline(x, z, outlines[i])), None)
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
                "clearance": pool_radius,
            },
            "edgeMargin": pool_edge,
        },
        "outlines": [[[round(float(x), 3), round(float(y), 3)] for x, y in outline]
                     for outline in outlines],
        "pools": pools,
    }
