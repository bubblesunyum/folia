"""Foliage clumps (pillar 4, D-045): opaque single-sided leaf cards, drawn
DoubleSide at runtime, scattered over an
ellipsoid, with every normal taken from the ellipsoid rather than the leaf, so
the clump shades as one soft mass and the leaves only break its silhouette.
"""

import numpy as np

from .mesh import new_object


def _proxy_normals(points, radii):
    """Ellipsoid gradient at each point: the Data Transfer of D-045, analytically."""
    n = points / (radii * radii)
    return n / np.linalg.norm(n, axis=1, keepdims=True)


def clump(name, p, rng):
    radii = np.array(p["radii"], dtype=float)
    count = p["leaves"]

    # Mostly near the surface, some deeper so the silhouette isn't a shell.
    direction = rng.normal(size=(count * 2, 3))
    direction /= np.linalg.norm(direction, axis=1, keepdims=True)
    direction = direction[direction[:, 2] > -p["floor"]][:count]
    depth = 1 - p["depth"] * rng.random(len(direction)) ** 2
    centres = direction * depth[:, None] * radii

    outward = _proxy_normals(centres, radii)
    facing = outward + rng.normal(size=outward.shape) * p["scatter"]
    facing /= np.linalg.norm(facing, axis=1, keepdims=True)
    along = np.cross(facing, rng.normal(size=facing.shape))
    along /= np.linalg.norm(along, axis=1, keepdims=True)
    across = np.cross(facing, along)

    size = p["leaf_size"] * (0.7 + 0.6 * rng.random(len(centres)))[:, None]
    half_l, half_w = size * 0.5, size * p["leaf_aspect"] * 0.5
    fold = facing * size * p["fold"]
    corners = np.stack([
        centres - along * half_l,
        centres - across * half_w + fold,
        centres + along * half_l,
        centres + across * half_w + fold,
    ], axis=1).reshape(-1, 3)

    # One winding per leaf: Blender drops a reversed duplicate over the same
    # vertices, so the runtime foliage material is DoubleSide and keeps the
    # proxy normal on the back face.
    faces = []
    for i in range(len(centres)):
        a = 4 * i
        faces += [(a, a + 1, a + 2), (a, a + 2, a + 3)]
    ob = new_object(name, corners, faces, merge=False)
    ob.data.normals_split_custom_set_from_vertices(_proxy_normals(corners, radii).tolist())
    return ob
