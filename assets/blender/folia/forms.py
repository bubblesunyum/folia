"""The hard forms from D-034: Voronoi canopies, swept terraces, lathed trunks,
petal shells and tubes. Each returns a new object in metres, Z up, built
around the origin; the asset script places it.
"""

import math

import bmesh
import numpy as np

from .mesh import geometry_nodes, new_object, solidify_subdivide

TAU = math.tau


# --- curves ------------------------------------------------------------------


def blob_outline(radius, harmonics, rng, samples):
    """A smooth closed outline: a circle perturbed by a few low harmonics.

    `harmonics` is a list of amplitudes for k = 2, 3, ...; phases are seeded.
    """
    theta = np.linspace(0, TAU, samples, endpoint=False)
    r = np.ones_like(theta)
    for k, amp in enumerate(harmonics, start=2):
        r += amp * np.cos(k * theta + rng.uniform(0, TAU))
    return np.stack([np.cos(theta) * r * radius, np.sin(theta) * r * radius], axis=1)


def outline_normals(outline):
    """Outward 2D normals of a closed counter-clockwise outline."""
    tangent = np.roll(outline, -1, axis=0) - np.roll(outline, 1, axis=0)
    normal = np.stack([tangent[:, 1], -tangent[:, 0]], axis=1)
    return normal / np.linalg.norm(normal, axis=1, keepdims=True)


def tube(name, points, radius, sides=8, closed=False):
    """Sweep a circle along a polyline. Frames hang off world up, so curves that
    run mostly horizontal (terrace edges, neon lines) never twist; `radius` may
    be a scalar or one value per point.
    """
    pts = np.asarray(points, dtype=float)
    n = len(pts)
    if closed:
        tangent = np.roll(pts, -1, axis=0) - np.roll(pts, 1, axis=0)
    else:
        tangent = np.gradient(pts, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1, keepdims=True)
    side = np.cross(tangent, [0.0, 0.0, 1.0])
    side /= np.maximum(np.linalg.norm(side, axis=1, keepdims=True), 1e-9)
    up = np.cross(side, tangent)
    radii = np.broadcast_to(np.asarray(radius, dtype=float), (n,))

    phi = np.linspace(0, TAU, sides, endpoint=False)
    ring = np.cos(phi)[None, :, None] * side[:, None, :] + np.sin(phi)[None, :, None] * up[:, None, :]
    verts = (pts[:, None, :] + radii[:, None, None] * ring).reshape(-1, 3).tolist()

    faces = []
    segments = n if closed else n - 1
    for i in range(segments):
        j = (i + 1) % n
        for s in range(sides):
            t = (s + 1) % sides
            faces.append((i * sides + s, j * sides + s, j * sides + t, i * sides + t))
    if not closed:
        for end, flip in ((0, True), (n - 1, False)):
            centre = len(verts)
            verts.append(pts[end].tolist())
            for s in range(sides):
                a, b = end * sides + s, end * sides + (s + 1) % sides
                faces.append((centre, b, a) if flip else (centre, a, b))
    return new_object(name, verts, faces)


def pool(name, outline, z, rings=3):
    """A flat water surface filling a closed outline, faces up: a centre
    vertex and `rings` scaled copies of the outline, fanned together.
    """
    n = len(outline)
    centre = outline.mean(axis=0)
    verts = [(*centre, z)]
    for k in range(1, rings + 1):
        ring = centre + (outline - centre) * (k / rings)
        verts += np.c_[ring, np.full(n, z)].tolist()
    faces = [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)]
    for k in range(rings - 1):
        a, b = 1 + k * n, 1 + (k + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, b + i, b + j, a + j))
    return new_object(name, verts, faces)


# --- terraces ----------------------------------------------------------------


def slab(name, outline, top, thickness, edge_radius, rings=6, edge_segments=4, rim_bias=1.0):
    """A terrace level: a curve-swept slab with rounded top and bottom edges.

    The top is built from concentric scaled copies of the outline, so it has
    enough vertices for the AO bake to draw contact gradients (D-031). The
    rings crowd toward the rim by `rim_bias`, where the contact shadow and the
    neon spill change fastest. It has no underside: every level sits on the
    ground or the level below.
    """
    outline = np.asarray(outline, dtype=float)
    normal = outline_normals(outline)
    centre = outline.mean(axis=0)
    bottom = top - thickness
    r = min(edge_radius, thickness / 2)

    # (scale toward the centre, outward offset along the normal, height)
    profile = [(1 - (1 - u) ** rim_bias, 0.0, top) for u in np.linspace(0, 1, rings + 1)[1:]]
    profile += [(1.0, r * math.sin(a), top - r * (1 - math.cos(a)))
                for a in np.linspace(0, math.pi / 2, edge_segments + 1)[1:]]
    profile += [(1.0, r * math.cos(a), bottom + r - r * math.sin(a))
                for a in np.linspace(0, math.pi / 2, edge_segments + 1)]

    m = len(outline)
    verts = [(*centre, top)]
    for s, d, z in profile:
        xy = centre + s * (outline - centre) + d * normal
        verts += [(x, y, z) for x, y in xy]

    faces = []
    for s in range(m):
        faces.append((0, 1 + s, 1 + (s + 1) % m))
    for k in range(len(profile) - 1):
        a, b = 1 + k * m, 1 + (k + 1) * m
        for s in range(m):
            t = (s + 1) % m
            faces.append((a + s, b + s, b + t, a + t))
    return new_object(name, verts, faces)


# --- trunks ------------------------------------------------------------------


def lathe_trunk(name, height, r_base, r_waist, r_top, flutes, flute_depth, twist, rings=28, sides=40):
    """A trumpet-shaped fluted column that flares into whatever it holds up."""
    verts, faces = [], []
    for k in range(rings + 1):
        t = k / rings
        radius = r_waist + (r_base - r_waist) * (1 - t) ** 4 + (r_top - r_waist) * t**4
        for s in range(sides):
            theta = TAU * s / sides
            rr = radius * (1 + flute_depth * math.cos(flutes * theta + twist * t))
            verts.append((rr * math.cos(theta), rr * math.sin(theta), t * height))
    for k in range(rings):
        for s in range(sides):
            a, b = k * sides + s, k * sides + (s + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    for k, flip in ((0, True), (rings, False)):
        centre = len(verts)
        verts.append((0.0, 0.0, k / rings * height))
        for s in range(sides):
            a, b = k * sides + s, k * sides + (s + 1) % sides
            faces.append((centre, b, a) if flip else (centre, a, b))
    return new_object(name, verts, faces)


# --- Voronoi canopy ----------------------------------------------------------


def _jittered_triangulation(spacing, jitter, rng):
    """A triangular lattice clipped to the unit disk, interior points jittered."""
    s = spacing
    n = int(math.ceil(1.5 / s))
    index, verts = {}, []
    for i in range(-n, n + 1):
        for j in range(-n, n + 1):
            x, y = s * (i + j / 2), s * (j * math.sqrt(3) / 2)
            if x * x + y * y <= 1.0:
                index[(i, j)] = len(verts)
                verts.append([x, y])
    verts = np.array(verts)
    neighbours = ((1, 0), (0, 1), (-1, 1), (-1, 0), (0, -1), (1, -1))
    for (i, j), v in index.items():
        if all((i + di, j + dj) in index for di, dj in neighbours):
            verts[v] += rng.uniform(-1, 1, 2) * jitter * s * 0.5
    faces = []
    for (i, j), v in index.items():
        a, b, c = index.get((i + 1, j)), index.get((i, j + 1)), index.get((i + 1, j + 1))
        if a is not None and b is not None:
            faces.append((v, a, b))
        if a is not None and b is not None and c is not None:
            faces.append((a, c, b))
    return verts, faces


def voronoi_canopy(name, p, rng):
    """A bone-like perforated canopy (pillar 2): jittered triangulation → Dual
    Mesh → inset every cell and delete its centre → shape → solidify → subdivide.

    Cells grow toward the rim (`growth` > 1), so the centre reads dense and
    structural and the edge reads open, like the refs' tree lattices.

    D-034 starts this with "remesh, triangulate"; a jittered lattice is the
    same thing built directly, seeded and with no remesher resolution to tune.
    """
    flat, tris = _jittered_triangulation(p["spacing"], p["jitter"], rng)
    radius = np.linalg.norm(flat, axis=1, keepdims=True)
    flat = flat * np.where(radius > 0, radius ** (p["growth"] - 1), 1) * p["radius"]
    ob = new_object(name, np.c_[flat, np.zeros(len(flat))], tris)

    def dual(tree, geometry):
        node = tree.nodes.new("GeometryNodeDualMesh")
        node.inputs["Keep Boundaries"].default_value = False
        tree.links.new(geometry, node.inputs["Mesh"])
        return node.outputs["Dual Mesh"]

    geometry_nodes(ob, dual)

    bm = bmesh.new()
    bm.from_mesh(ob.data)
    # Cells over the trunk stay closed, a solid crown the trunk flares into.
    crown = p["solid_centre"] * p["radius"]
    cells = [f for f in bm.faces if f.calc_center_median().to_2d().length > crown]
    for face in cells:
        size = math.sqrt(face.calc_area())
        width = min(max(p["frame"] * size, p["frame_min"]), p["frame_max"])
        bmesh.ops.inset_individual(bm, faces=[face], thickness=width, use_even_offset=True)
    bmesh.ops.delete(bm, geom=cells, context="FACES_ONLY")

    for v in bm.verts:
        x, y = v.co.x, v.co.y
        r = math.hypot(x, y) / p["radius"]
        theta = math.atan2(y, x)
        lobe = 0.5 + 0.5 * math.cos(p["lobes"] * theta + p["lobe_phase"])
        v.co.z = -p["sag"] * r * r - p["droop"] * r**3 * lobe
    bm.to_mesh(ob.data)
    bm.free()

    solidify_subdivide(ob, p["thickness"], p["subdivisions"])
    return ob


# --- petal shells ------------------------------------------------------------


def petal(name, length, width, cup, tilt_base, tilt_tip, thickness, subdivisions, nu=18, nv=9):
    """One cupped, pointed petal rising from the origin along +X (pillar 3).

    The spine starts `tilt_base` from vertical and curls out to `tilt_tip`;
    the edges curl inward by `cup` of the local width.
    """
    verts = []
    spine = np.zeros(3)
    step = length / nu
    for i in range(nu + 1):
        u = i / nu
        alpha = tilt_base + (tilt_tip - tilt_base) * u**1.5
        direction = np.array([math.sin(alpha), 0.0, math.cos(alpha)])
        inward = np.array([-math.cos(alpha), 0.0, math.sin(alpha)])
        w = width * math.sin(math.pi * (0.12 + 0.88 * u)) ** 0.7
        for j in range(nv + 1):
            v = -1 + 2 * j / nv
            point = spine + np.array([0.0, v * w, 0.0]) + inward * cup * w * v * v
            verts.append(point.tolist())
        spine = spine + direction * step
    faces = []
    for i in range(nu):
        for j in range(nv):
            a = i * (nv + 1) + j
            faces.append((a, a + 1, a + nv + 2, a + nv + 1))
    ob = new_object(name, verts, faces)
    solidify_subdivide(ob, thickness, subdivisions)
    return ob


# --- ground ------------------------------------------------------------------


def disc(name, radius, rings, sides):
    """A flat disc whose rings tighten toward the middle, where contact AO lives."""
    verts = [(0.0, 0.0, 0.0)]
    for k in range(1, rings + 1):
        r = radius * (k / rings) ** 1.6
        verts += [(r * math.cos(TAU * s / sides), r * math.sin(TAU * s / sides), 0.0) for s in range(sides)]
    faces = [(0, 1 + s, 1 + (s + 1) % sides) for s in range(sides)]
    for k in range(rings - 1):
        a, b = 1 + k * sides, 1 + (k + 1) * sides
        for s in range(sides):
            t = (s + 1) % sides
            faces.append((a + s, b + s, b + t, a + t))
    return new_object(name, verts, faces)
