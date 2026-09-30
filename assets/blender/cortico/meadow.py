"""Cortico's eastern meadow annex (fol-9fh): the second town asset.

A small two-level terrace cluster with gold trim, one mint neon run in the
groove under a lip, and foliage spilling off the edges. No ground disc, no
water, no canopy or shell — it sits on the fragment's ground to the east, so
co-registration proves shared batches (cream, gold, neon, foliage) carry two
assets with isolated group slots and no z-fighting. Built from the shared
terrace-cluster composables alongside `fragment.py`.
"""

from folia import terraces


def assemble(p, rng):
    g = p["groups"]
    parts, outlines, levels = terraces.slabs_and_trim(p, rng, g["terrace"])
    parts.append(terraces.groove_neon(p, outlines, levels, g["terrace"]))
    parts.extend(terraces.edge_planting(p, outlines, levels, rng, g["planting"]))
    return parts
