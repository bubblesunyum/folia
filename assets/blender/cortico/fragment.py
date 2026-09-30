"""Spike 1+2's hero fragment of Cortico: stacked terraces with gold trim, a
Voronoi canopy on a fluted trunk, a petal shell, foliage clumps spilling off
the levels, one mint neon line in the groove under a terrace lip, and a
reflecting pool below it.
"""

import math

import numpy as np

from folia import forms, terraces
from folia.mesh import Part

TAU = math.tau


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

    return parts
