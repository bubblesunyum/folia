"""Assembly and export (D-032, D-034): tag parts with `_ID`, join them for the
bake, then split by material into one `<hood>.<object>.<material>.<lod>` mesh
per batch and write a glTF with the exporter settings fixed here.
"""

import json

import bmesh
import bpy
import numpy as np

from .mesh import set_point_attribute


def join(parts, name):
    """One object from all parts, each vertex carrying its part's `_ID`.

    Sway is foliage-only: parts without a baked `_SWAY` get an inert 0, so
    the joined mesh carries the attribute on every vertex and the split below
    can drop it outside the foliage batch.
    """
    for part in parts:
        set_point_attribute(part.obj.data, "_ID", np.full(len(part.obj.data.vertices), part.group))
        if "_SWAY" not in part.obj.data.attributes:
            set_point_attribute(
                part.obj.data, "_SWAY", np.zeros(len(part.obj.data.vertices), dtype=np.float32)
            )
    objects = [part.obj for part in parts]
    target = objects[0]
    with bpy.context.temp_override(
        object=target, active_object=target, selected_objects=objects, selected_editable_objects=objects
    ):
        bpy.ops.object.join()
    target.name = name
    return target


def split_by_material(ob, name_for, drop):
    """A new object per material slot, holding only that slot's faces.

    `drop` maps a material to attributes its batch schema leaves out.
    """
    out = []
    for index, mat in enumerate(ob.data.materials):
        me = ob.data.copy()
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != index], context="FACES")
        bm.to_mesh(me)
        bm.free()
        me.materials.clear()
        for attr in drop.get(mat.name, ()):
            if attr in me.attributes:
                me.attributes.remove(me.attributes[attr])
        name = name_for(mat.name)
        me.name = name
        piece = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(piece)
        piece["batch"] = mat.name
        out.append(piece)
    return out


def export(objects, path, extras):
    """Write a GLB of `objects`. Settings are fixed in code (D-034): modifiers
    applied, `_`-prefixed attributes kept, no colors, UVs, materials or
    tangents (batches get their shared material by name), +Y up.
    """
    scene = bpy.context.scene
    for key, value in extras.items():
        scene[key] = json.dumps(value) if isinstance(value, (dict, list)) else value
    for ob in scene.objects:
        ob.select_set(ob in objects)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_attributes=True,
        export_extras=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=False,
        export_tangents=False,
        export_materials="NONE",
        export_vertex_color="NONE",
        export_all_vertex_colors=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_meshopt_compression_enable=False,
        export_draco_mesh_compression_enable=False,
    )
