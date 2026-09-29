"""Spike 1+2's hero fragment of Cortico: stacked terraces with gold trim, a
Voronoi canopy on a fluted trunk, a petal shell, foliage clumps spilling off
the levels, one mint neon line in the groove under a terrace lip, and a
reflecting pool below it.
"""

import math

import numpy as np

from folia import foliage, forms
from folia.mesh import Part

TAU = math.tau


def _place(ob, x, y, z=0.0, rot=0.0):
    ob.location = (x, y, z)
    ob.rotation_euler = (0.0, 0.0, rot)
    return ob


def _outline_point(outline, normal, at):
    """The point and outward normal at fraction `at` around an outline."""
    i = int(at * len(outline)) % len(outline)
    return outline[i], normal[i]


def assemble(p, rng):
    g = p["groups"]
    parts = []

    ground = p["ground"]
    parts.append(Part(forms.disc("ground", ground["radius"], ground["rings"], ground["sides"]), "ground", g["ground"]))

    # Terraces: each level a blob outline with its own seeded wobble.
    t = p["terraces"]
    outlines, levels = [], t["levels"]
    for i, level in enumerate(levels):
        bottom = level.get("bottom", levels[i - 1]["top"] if i else 0.0)
        outline = forms.blob_outline(level["radius"], t["harmonics"], rng, t["samples"]) + level["centre"]
        outlines.append(outline)
        slab = forms.slab(f"terrace{i}", outline, level["top"], level["top"] - bottom, t["edge_radius"],
                          t["rings"], t["edge_segments"], t["rim_bias"])
        parts.append(Part(slab, "cream", g["terrace"]))

        # Gold trim band around the side of each level.
        trim = p["trim"]
        z = max(level["top"] - trim["drop"], bottom + t["edge_radius"])
        ring = outline + forms.outline_normals(outline) * (t["edge_radius"] + trim["radius"] * 0.4)
        band = forms.tube(f"trim{i}", np.c_[ring, np.full(len(ring), z)], trim["radius"], trim["sides"], closed=True)
        parts.append(Part(band, "gold", g["terrace"]))

    # Neon in the groove under one terrace's lip, along part of its outline.
    n = p["neon"]
    outline = outlines[n["level"]]
    normal = forms.outline_normals(outline)
    a, b = (int(f * len(outline)) for f in n["arc"])
    z = levels[n["level"] - 1]["top"] + n["lift"]
    line = outline[a:b] + normal[a:b] * n["offset"]
    neon = forms.tube("neon", np.c_[line, np.full(len(line), z)], n["radius"], n["sides"])
    parts.append(Part(neon, "neon", g["terrace"]))

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
    pl = p["planting"]
    for i, spot in enumerate(pl["clumps"]):
        outline = outlines[spot["level"]]
        point, out = _outline_point(outline, forms.outline_normals(outline), spot["at"])
        radii = spot["radii"]
        x, y = point + out * radii[0] * pl["overhang"]
        z = levels[spot["level"]]["top"] + radii[2] * 0.35
        ob = foliage.clump(f"clump{i}", {**pl, "radii": radii}, rng)
        parts.append(Part(_place(ob, x, y, z, rng.uniform(0, TAU)), "foliage", g["planting"]))

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

    return parts
