"""Mesh plumbing: build objects from arrays, apply modifiers, write attributes."""

from dataclasses import dataclass

import bmesh
import bpy
import numpy as np


@dataclass
class Part:
    """One placed piece of an asset, before it is merged into its batch.

    `group` becomes the per-vertex `_ID` (D-032): which building or pedestal a
    vertex belongs to, so hover and glow address it as a unit.
    """

    obj: bpy.types.Object
    material: str
    group: int


def new_object(name, verts, faces, merge=True):
    """An object from vertex and face arrays, with outward-facing normals.

    `merge` welds coincident vertices; foliage turns it off so leaves that
    happen to touch stay separate cards.
    """
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in np.asarray(verts, dtype=float)], [], [tuple(f) for f in faces])
    bm = bmesh.new()
    bm.from_mesh(me)
    if merge:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def apply_modifiers(ob):
    """Bake the modifier stack into the mesh, without operator context."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def solidify_subdivide(ob, thickness, levels, offset=0.0):
    """Give a surface thickness, then round it off (the bone-like lattice look)."""
    sol = ob.modifiers.new("solidify", "SOLIDIFY")
    sol.thickness = thickness
    sol.offset = offset
    sol.use_even_offset = True
    sol.use_rim = True
    if levels > 0:
        sub = ob.modifiers.new("subsurf", "SUBSURF")
        sub.levels = levels
        sub.render_levels = levels
    apply_modifiers(ob)
    ob.data.shade_smooth()


def geometry_nodes(ob, build):
    """Run a one-off Geometry Nodes tree over `ob` and apply it.

    `build(tree, geometry_in)` adds nodes and returns the output socket.
    """
    tree = bpy.data.node_groups.new(f"{ob.name}.gn", "GeometryNodeTree")
    tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    gin = tree.nodes.new("NodeGroupInput")
    gout = tree.nodes.new("NodeGroupOutput")
    tree.links.new(build(tree, gin.outputs[0]), gout.inputs[0])
    mod = ob.modifiers.new("gn", "NODES")
    mod.node_group = tree
    apply_modifiers(ob)
    bpy.data.node_groups.remove(tree)


def set_point_attribute(me, name, values):
    """Write a float (N,) or float-vector (N,3) attribute on the point domain."""
    values = np.asarray(values, dtype=np.float32)
    if name in me.attributes:
        me.attributes.remove(me.attributes[name])
    if values.ndim == 1:
        attr = me.attributes.new(name, "FLOAT", "POINT")
        attr.data.foreach_set("value", values)
    else:
        attr = me.attributes.new(name, "FLOAT_VECTOR", "POINT")
        attr.data.foreach_set("vector", values.ravel())


def vertex_positions(me):
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def triangle_count(ob):
    me = ob.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)
