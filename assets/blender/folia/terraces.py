"""Shared terrace-cluster composables (fol-9fh taste review): stacked blob
terraces with gold trim, a mint neon run in the groove under a lip, and
foliage clumps spilling off the edges. `cortico/fragment` and
`cortico/meadow` build the same kinds, so the next tweak lands once.
"""

import json
import math
from pathlib import Path

import numpy as np

from folia.mesh import Part

from . import foliage, forms

TAU = math.tau

# Sway bake curve (fol-6di): the single retune point for the breeze ramp,
# shared with `src/materials/swayModel.ts`. Threaded into every clump below so
# `foliage.clump()` bakes from params, never from its fallback literals.
_FOLIAGE_PARAMS = json.loads(
    (Path(__file__).resolve().parent / "foliage_params.json").read_text()
)


def place(ob, x, y, z=0.0, rot=0.0):
    ob.location = (x, y, z)
    ob.rotation_euler = (0.0, 0.0, rot)
    return ob


def _outline_point(outline, normal, at):
    """The point and outward normal at fraction `at` around an outline."""
    i = int(at * len(outline)) % len(outline)
    return outline[i], normal[i]


def slabs_and_trim(p, rng, group):
    """Blob-outline terrace slabs plus a gold trim band per level.

    Returns the parts with the baked outlines and levels, which the neon and
    planting composables below build on.
    """
    parts = []
    t = p["terraces"]
    outlines, levels = [], t["levels"]
    for i, level in enumerate(levels):
        bottom = level.get("bottom", levels[i - 1]["top"] if i else 0.0)
        outline = forms.blob_outline(level["radius"], t["harmonics"], rng, t["samples"]) + level["centre"]
        outlines.append(outline)
        slab = forms.slab(f"terrace{i}", outline, level["top"], level["top"] - bottom, t["edge_radius"],
                          t["rings"], t["edge_segments"], t["rim_bias"])
        parts.append(Part(slab, "cream", group))

        trim = p["trim"]
        z = max(level["top"] - trim["drop"], bottom + t["edge_radius"])
        ring = outline + forms.outline_normals(outline) * (t["edge_radius"] + trim["radius"] * 0.4)
        band = forms.tube(f"trim{i}", np.c_[ring, np.full(len(ring), z)], trim["radius"], trim["sides"], closed=True)
        parts.append(Part(band, "gold", group))
    return parts, outlines, levels


def groove_neon(p, outlines, levels, group, name="neon"):
    """Neon tube in the groove under level `p["neon"]["level"]`'s lip.

    The groove sits on the floor below the lip — the previous level's top, or
    the ground for level 0 — never a wrapped-around level.
    """
    n = p["neon"]
    i = n["level"]
    outline = outlines[i]
    normal = forms.outline_normals(outline)
    a, b = (int(f * len(outline)) for f in n["arc"])
    floor = levels[i].get("bottom", levels[i - 1]["top"] if i else 0.0)
    z = floor + n["lift"]
    line = outline[a:b] + normal[a:b] * n["offset"]
    return Part(forms.tube(name, np.c_[line, np.full(len(line), z)], n["radius"], n["sides"]), "neon", group)


def edge_planting(p, outlines, levels, rng, group, prefix="clump"):
    """Foliage clumps sitting on terrace edges, leaning out over them."""
    parts = []
    pl = p["planting"]
    for i, spot in enumerate(pl["clumps"]):
        outline = outlines[spot["level"]]
        point, out = _outline_point(outline, forms.outline_normals(outline), spot["at"])
        radii = spot["radii"]
        x, y = point + out * radii[0] * pl["overhang"]
        z = levels[spot["level"]]["top"] + radii[2] * 0.35
        ob = foliage.clump(
            f"{prefix}{i}",
            {
                **pl,
                "radii": radii,
                "sway_base_m": _FOLIAGE_PARAMS["sway_base_m"],
                "sway_top_m": _FOLIAGE_PARAMS["sway_top_m"],
            },
            rng,
        )
        parts.append(Part(place(ob, x, y, z, rng.uniform(0, TAU)), "foliage", group))
    return parts
