"""Baked lighting in placed context (D-031): `_AO` and `_NIGHT` go into vertex
attributes of the assembled asset, so terraces, canopies and planters darken
and light each other before the asset is split into batches.
"""

import bpy
import numpy as np

from .mesh import set_point_attribute

BAKE_LAYER = "bake"


def _material(name, emission=None):
    """A Cycles stand-in: plain white diffuse, or an emitter for neon."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    if emission is None:
        shader = nodes.new("ShaderNodeBsdfDiffuse")
        shader.inputs["Color"].default_value = (0.8, 0.8, 0.8, 1)
    else:
        shader = nodes.new("ShaderNodeEmission")
        shader.inputs["Color"].default_value = (*emission, 1)
    mat.node_tree.links.new(shader.outputs[0], out.inputs["Surface"])
    return mat


def assign_materials(parts, emitters):
    """Give every part a Cycles material named after its shared material.

    `emitters` maps a material name to the linear colour it emits in the night
    bake; `bake()` sets the strength.
    """
    for part in parts:
        part.obj.data.materials.clear()
        part.obj.data.materials.append(_material(part.material, emitters.get(part.material)))


def _bake(ob, kind, samples, passes=None):
    me = ob.data
    if BAKE_LAYER in me.color_attributes:
        me.color_attributes.remove(me.color_attributes[BAKE_LAYER])
    layer = me.color_attributes.new(BAKE_LAYER, "FLOAT_COLOR", "POINT")
    me.color_attributes.active_color = layer
    bpy.context.scene.cycles.samples = samples
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        if passes:
            bpy.ops.object.bake(type=kind, target="VERTEX_COLORS", pass_filter=passes)
        else:
            bpy.ops.object.bake(type=kind, target="VERTEX_COLORS")
    rgba = np.empty(len(me.vertices) * 4, dtype=np.float32)
    layer.data.foreach_get("color", rgba)
    me.color_attributes.remove(layer)
    return rgba.reshape(-1, 4)[:, :3]


def _smooth(me, values, iterations):
    """Averages each vertex with its edge neighbours, `iterations` times.

    A vertex bake is one noisy sample per vertex; on long thin triangles (the
    terrace rings) that noise reads as streaks once it's interpolated.
    """
    edges = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", edges)
    a, b = edges[0::2], edges[1::2]
    degree = np.bincount(np.concatenate([a, b]), minlength=len(values)).astype(np.float32)
    shape = (-1,) + (1,) * (values.ndim - 1)
    lonely = (degree == 0).reshape(shape)
    for _ in range(iterations):
        total = np.zeros_like(values)
        np.add.at(total, a, values[b])
        np.add.at(total, b, values[a])
        mean = total / np.maximum(degree, 1).reshape(shape)
        values = np.where(lonely, values, 0.5 * values + 0.5 * mean)
    return values


def _use_metal():
    """Metal when there is one: a vertex bake is mostly fixed session cost on
    the GPU (~4 s at 128 samples) against ~0.2 s per sample on the CPU. The
    first Metal run compiles kernels once (~2 min), then they are cached.
    """
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "METAL"
    except TypeError:
        return False
    prefs.get_devices()
    metal = [d for d in prefs.devices if d.type == "METAL"]
    for device in prefs.devices:
        device.use = device in metal
    return bool(metal)


def bake(ob, p, neon_materials):
    """Bake `_AO` (sun-independent occlusion) and `_NIGHT` (neon spill only)
    into the assembled object `ob`.
    """
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU" if _use_metal() else "CPU"
    scene.cycles.use_denoising = False
    world = scene.world or bpy.data.worlds.new("world")
    scene.world = world
    world.light_settings.distance = p["ao_distance"]

    ao = _bake(ob, "AO", p["ao_samples"])[:, 0]
    ao = _smooth(ob.data, ao, p["smooth"])
    set_point_attribute(ob.data, "_AO", np.clip(ao, 0.0, 1.0))

    # Night: a black world and nothing but the neon, so the bake holds spill.
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background:
        background.inputs["Strength"].default_value = 0.0
    for name in neon_materials:
        mat = bpy.data.materials.get(name)
        if mat:
            mat.node_tree.nodes["Emission"].inputs["Strength"].default_value = p["neon_strength"]
    night = _bake(ob, "DIFFUSE", p["night_samples"], {"DIRECT", "INDIRECT"})
    set_point_attribute(ob.data, "_NIGHT", _smooth(ob.data, night, p["smooth"]))
