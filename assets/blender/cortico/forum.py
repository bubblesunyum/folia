"""Cortico's forum (fol-l1r.4): three pedestals in the middle of the forum.

A thin medallion sunk onto the fragment's top terrace, a gold trim band, one
mint neon ring, and three pedestal clusters — a stylized laptop (platform), a
stylized smartphone (recorder) and an audio-glyph waveform (medley) — each on
its own `_ID` group so hover can lift and glow them independently (fol-l1r.5).
Simple clean primitive-based forms per D-011/D-028, mint neon edge-lines per
D-009/D-024. No foliage or water: the fragment already wraps the forum in
terraces, canopy and planting, so this asset stays lean.
"""

import math

import numpy as np

from folia import forms
from folia.mesh import Part

TAU = math.tau


def place(ob, x, y, z, yaw=0.0, tilt_x=0.0):
    # Invariant: Blender "XYZ" Euler composes Rz(yaw)·Rx(tilt), exactly the
    # transform tilt_offset() computes — keep the two in sync.
    ob.location = (x, y, z)
    ob.rotation_mode = "XYZ"
    ob.rotation_euler = (tilt_x, 0.0, yaw)
    return ob


def tilt_offset(yaw, tilt, local):
    # Same transform place() sets on the object (XYZ mode == Rz(yaw)·Rx(tilt)),
    # without translation: positions derived here land where the part leans.
    x, y, z = local
    ty = y * math.cos(tilt) - z * math.sin(tilt)
    tz = y * math.sin(tilt) + z * math.cos(tilt)
    c, s = math.cos(yaw), math.sin(yaw)
    return np.array([c * x - s * ty, s * x + c * ty, tz])


def face_centre(px, py, cx, cy):
    """The Z yaw facing local +Y at the forum centre."""
    return math.atan2(-(cx - px), cy - py)


def laptop(px, py, top, yaw, spec, group):
    """A stylized laptop: bevelled base, tilted screen, gold keys, neon top edge."""
    parts = []
    base_w, base_d, base_t = spec["base"]
    base = forms.bevel(forms.box("laptop.base", base_w, base_d, base_t), spec["bevel"], 2)
    parts.append(Part(place(base, px, py, top + base_t / 2, yaw), "cream", group))

    key_w, key_d, key_t = spec["keys"]
    keys = forms.box("laptop.keys", key_w, key_d, key_t)
    keys_at = np.array([px, py, top + base_t]) + tilt_offset(yaw, 0.0, (0.0, 0.03, key_t / 2 - 0.005))
    parts.append(Part(place(keys, *keys_at, yaw), "gold", group))

    screen_w, screen_t, screen_h = spec["screen"]
    tilt = spec["tilt"]
    hinge = np.array([px, py, top + base_t]) + tilt_offset(yaw, 0.0, (0.0, -base_d / 2 + 0.02, 0.0))
    centre = hinge + tilt_offset(yaw, tilt, (0.0, 0.0, screen_h / 2))
    screen = forms.bevel(forms.box("laptop.screen", screen_w, screen_t, screen_h), spec["bevel"], 2)
    parts.append(Part(place(screen, *centre, yaw, tilt), "cream", group))

    # Offset off the face so the tube never z-fights the screen.
    edge_spec = spec["neon"]
    normal = tilt_offset(yaw, tilt, (0.0, 1.0, 0.0))
    edge = [
        hinge + tilt_offset(yaw, tilt, (ex, 0.0, screen_h)) + normal * edge_spec["lift"]
        for ex in (-(screen_w / 2 - 0.03), screen_w / 2 - 0.03)
    ]
    parts.append(
        Part(forms.tube("laptop.neon", edge, edge_spec["radius"], edge_spec["sides"]), "neon", group)
    )
    return parts


def phone(px, py, top, yaw, spec, group):
    """A stylized smartphone: bevelled standing slab, gold screen, neon rim ring."""
    parts = []
    slab_w, slab_t, slab_h = spec["slab"]
    tilt = spec["tilt"]
    centre = np.array([px, py, top + slab_h / 2 - 0.02])
    slab = forms.bevel(forms.box("phone.slab", slab_w, slab_t, slab_h), spec["bevel"], 2)
    parts.append(Part(place(slab, *centre, yaw, tilt), "cream", group))

    scr_w, scr_t, scr_h = spec["screen"]
    screen = forms.box("phone.screen", scr_w, scr_t, scr_h)
    screen_at = centre + tilt_offset(yaw, tilt, (0.0, slab_t / 2 + scr_t / 2 - 0.005, 0.04))
    parts.append(Part(place(screen, *screen_at, yaw, tilt), "gold", group))

    # The distance read: a mint ring around the pedestal's top rim.
    ring_spec = spec["neon"]
    ring = forms.circle_points(ring_spec["ring"], ring_spec["samples"], top + ring_spec["lift"], (px, py))
    parts.append(
        Part(forms.tube("phone.neon", ring, ring_spec["radius"], ring_spec["sides"], closed=True), "neon", group)
    )
    return parts


def glyph(px, py, top, yaw, spec, group):
    """An audio glyph: waveform bars on a disc, a neon waveform line over them."""
    parts = []
    base_bottom, base_top, base_h = spec["base"]
    base = forms.cylinder("glyph.base", base_bottom, base_top, base_h, sides=28)
    parts.append(Part(place(base, px, py, top), "cream", group))

    base_top_z = top + base_h
    for i, height in enumerate(spec["bars"]):
        bar = forms.bevel(forms.box(f"glyph.bar{i}", 0.09, 0.09, height), spec["bevel"], 2)
        bar_at = np.array([px, py, base_top_z + height / 2]) + tilt_offset(
            yaw, 0.0, ((i - 3) * spec["spacing"], 0.0, 0.0)
        )
        parts.append(Part(place(bar, *bar_at, yaw), "cream", group))

    # A waveform line over the bar tops, feet embedded in the base disc: every
    # segment runs diagonal, so tube()'s world-up frames never degenerate.
    wave = spec["neon"]
    line = [(-wave["foot"], 0.0, 0.02)]
    line += [((i - 3) * spec["spacing"], 0.0, height + wave["lift"]) for i, height in enumerate(spec["bars"])]
    line.append((wave["foot"], 0.0, 0.02))
    path = [np.array([px, py, base_top_z]) + tilt_offset(yaw, 0.0, local) for local in line]
    parts.append(Part(forms.tube("glyph.neon", path, wave["tube"], wave["sides"]), "neon", group))
    return parts


BUILDERS = {
    "platform": laptop,
    "recorder": phone,
    "medley": glyph,
}


def assemble(params, rng):
    groups = params["groups"]
    cx, cy = params["centre"]
    floor = params["floor_top"]
    parts = []

    # Sunk into the terrace top so the contact faces never z-fight.
    medallion = params["medallion"]
    outline = forms.blob_outline(medallion["radius"], medallion["harmonics"], rng, medallion["samples"]) + np.array(
        [cx, cy]
    )
    parts.append(Part(
        forms.slab("forum.floor", outline, floor, medallion["thickness"], medallion["edge_radius"],
                   medallion["rings"], medallion["edge_segments"], medallion["rim_bias"]),
        "cream", groups["forum"],
    ))

    trim = params["trim"]
    trim_ring = outline + forms.outline_normals(outline) * (medallion["edge_radius"] + trim["offset"])
    parts.append(Part(
        forms.tube("forum.trim", np.c_[trim_ring, np.full(len(trim_ring), floor - trim["drop"])],
                   trim["radius"], trim["sides"], closed=True),
        "gold", groups["forum"],
    ))

    ring_spec = params["neon"]
    circle = forms.circle_points(ring_spec["ring_radius"], ring_spec["samples"], floor + ring_spec["lift"], (cx, cy))
    parts.append(Part(
        forms.tube("forum.ring", circle, ring_spec["radius"], ring_spec["sides"], closed=True),
        "neon", groups["forum"],
    ))

    pedestal = params["pedestal"]
    for spot in pedestal["spots"]:
        px = cx + pedestal["radius"] * math.cos(math.radians(spot["at"]))
        py = cy + pedestal["radius"] * math.sin(math.radians(spot["at"]))
        yaw = face_centre(px, py, cx, cy)
        column = forms.cylinder(f"pedestal.{spot['slug']}", pedestal["r_base"], pedestal["r_top"],
                                pedestal["height"], sides=pedestal["sides"])
        parts.append(Part(place(column, px, py, floor - 0.01), "cream", groups[spot["group"]]))
        build = BUILDERS[spot["slug"]]
        parts.extend(
            build(px, py, floor - 0.01 + pedestal["height"], yaw, params[spot["slug"]], groups[spot["group"]])
        )

    return parts
