"""Foliage clumps (pillar 4, D-045, D-054): opaque single-sided leaf cards,
drawn DoubleSide at runtime, gathered into sprays over a few overlapping
ellipsoid lobes. Normals
come mostly from the lobes' soft union rather than the leaf, so the clump shades
as one soft, lumpy mass; the rest is the leaf's own creased normal, so single
leaves still catch the light inside it. Sprays are the middle scale: a
handful of leaves fanned out from one point, facing roughly one way, so they
shade together between the lobe and the leaf.
"""

import numpy as np

from .mesh import new_object

# Leaf outline: (position along the midrib, half-width) from base to tip.
_OUTLINE = [(-0.5, 0.0), (-0.15, 0.9), (0.2, 0.75), (0.5, 0.0)]
# Base, left 1, left 2, tip, right 2, right 1: four triangles, one winding.
_FACES = [(0, 1, 5), (1, 2, 4), (1, 4, 5), (2, 3, 4)]


def _unit(v):
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def _lobes(radii, p, rng):
    """The main lobe, then smaller ones pushed out from it: `lobe_rise` scales and
    offsets their height, so none sits far below the main one."""
    centres, sizes = [np.zeros(3)], [radii]
    scale, offset = p["lobe_rise"]
    for _ in range(p["lobes"] - 1):
        d = _unit(rng.normal(size=3))
        d[2] = abs(d[2]) * scale + offset
        centres.append(d * radii * p["lobe_spread"])
        sizes.append(radii * rng.uniform(*p["lobe_size"]))
    return np.array(centres), np.array(sizes)


def _proxy_normals(points, centres, sizes, sharpness):
    """Gradient of the lobes' soft union: each lobe's ellipsoid normal, weighted
    by how close the point is to that lobe's surface (the D-045 Data Transfer,
    analytically)."""
    rel = (points[:, None, :] - centres[None]) / sizes[None]
    distance = np.linalg.norm(rel, axis=-1)
    weight = np.exp(-sharpness * (distance - distance.min(axis=1, keepdims=True)))
    normals = _unit(rel / sizes[None])
    return _unit((normals * weight[..., None]).sum(axis=1))


def _inside_other(points, owner, centres, sizes, margin):
    rel = (points[:, None, :] - centres[None]) / sizes[None]
    inside = np.linalg.norm(rel, axis=-1) < margin
    inside[np.arange(len(points)), owner] = False
    return inside.any(axis=1)


def _surface_area(sizes):
    """Knud Thomsen's approximation, per lobe."""
    a, b, c = (sizes**1.6).T
    return 4 * np.pi * ((a * b + a * c + b * c) / 3) ** (1 / 1.6)


def _even_directions(n, jitter, rng):
    """`n` Fibonacci-lattice directions, each nudged by up to `jitter` of a
    lattice step, in a random orientation. Evenly
    spaced rather than random: random sprays at this density leave Poisson
    gaps, which show through a clump's crown where it faces the camera."""
    i = np.arange(n) + rng.uniform(-jitter, jitter, n)
    z = 1 - 2 * np.clip(i + 0.5, 0, n) / n
    phi = np.arange(n) * np.pi * (3 - np.sqrt(5)) + rng.uniform(-jitter, jitter, n)
    r = np.sqrt(np.clip(1 - z * z, 0, None))
    lattice = np.stack([r * np.cos(phi), r * np.sin(phi), z], axis=1)
    rotation, _ = np.linalg.qr(rng.normal(size=(3, 3)))
    return _unit(lattice @ rotation)


def _sprays(centres, sizes, p, rng):
    """Spray centres per lobe by area, mostly near its surface, some deeper so
    the silhouette isn't a shell; those buried in a neighbouring lobe are
    dropped, so the count follows the union's visible surface."""
    per_lobe = np.round(_surface_area(sizes) * p["density"] / p["spray"]).astype(int)
    owner = np.repeat(np.arange(len(centres)), per_lobe)
    direction = np.concatenate([_even_directions(n, p["lattice_jitter"], rng) for n in per_lobe])
    depth = 1 - p["depth"] * rng.random(len(owner)) ** 2
    points = centres[owner] + direction * depth[:, None] * sizes[owner]
    keep = (direction[:, 2] > -p["floor"]) & ~_inside_other(points, owner, centres, sizes, p["buried"])
    return points[keep]


def clump(name, p, rng):
    radii = np.array(p["radii"], dtype=float)
    centres, sizes = _lobes(radii, p, rng)
    sprays = _sprays(centres, sizes, p, rng)

    # Each spray faces roughly out of the mass; its leaves spread over a disc
    # in that plane, point away from its centre and share its facing.
    spray_out = _proxy_normals(sprays, centres, sizes, p["sharpness"])
    spray_facing = _unit(spray_out + rng.normal(size=spray_out.shape) * p["scatter"])
    spray_facing *= np.sign(np.sum(spray_facing * spray_out, axis=1, keepdims=True))
    t1 = _unit(np.cross(spray_facing, rng.normal(size=spray_facing.shape)))
    t2 = np.cross(spray_facing, t1)

    of = np.repeat(np.arange(len(sprays)), p["spray"])
    angle = rng.uniform(0, 2 * np.pi, len(of))
    reach = np.sqrt(rng.random(len(of)))[:, None] * p["spray_radius"]
    radial = t1[of] * np.cos(angle)[:, None] + t2[of] * np.sin(angle)[:, None]
    points = sprays[of] + radial * reach + spray_facing[of] * rng.normal(size=(len(of), 1)) * p["spray_radius"] * p["spray_depth"]

    outward = _proxy_normals(points, centres, sizes, p["sharpness"])
    facing = _unit(spray_facing[of] + rng.normal(size=radial.shape) * p["leaf_scatter"])
    facing *= np.sign(np.sum(facing * outward, axis=1, keepdims=True))
    along = radial + rng.normal(size=radial.shape) * p["fan_scatter"]
    along = _unit(along - facing * np.sum(along * facing, axis=1, keepdims=True))
    across = np.cross(facing, along)

    size = p["leaf_size"] * (0.7 + 0.6 * rng.random(len(points)))[:, None]
    fold = p["fold"]
    corners, leaf_normals = [], []
    # Outline order base → left → tip → right; the edges rise off the midrib by
    # `fold` and the tip droops by `curl`, and each half's normal tilts with it.
    # The droop grows from nothing at the base, so the leaf arches, not bows.
    ring = [(_OUTLINE[0], 0), (_OUTLINE[1], -1), (_OUTLINE[2], -1), (_OUTLINE[3], 0),
            (_OUTLINE[2], 1), (_OUTLINE[1], 1)]
    for (t, half), side in ring:
        width = half * p["leaf_aspect"] * 0.5
        offset = along * t + across * side * width + facing * (abs(side) * width * fold - (t + 0.5) ** 2 * p["curl"])
        corners.append(points + offset * size)
        leaf_normals.append(_unit(facing - across * side * fold))
    corners = np.stack(corners, axis=1).reshape(-1, 3)
    leaf_normals = np.stack(leaf_normals, axis=1).reshape(-1, 3)

    faces = [tuple(6 * i + v for v in face) for i in range(len(points)) for face in _FACES]
    ob = new_object(name, corners, faces, merge=False)
    blend = p["leaf_normal"]
    proxy = _proxy_normals(corners, centres, sizes, p["sharpness"])
    ob.data.normals_split_custom_set_from_vertices(_unit(proxy * (1 - blend) + leaf_normals * blend).tolist())
    return ob
