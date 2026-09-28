"""Build one asset headlessly: assemble → bake in placed context → split into
batches → export a raw GLB for the pack step (D-031, D-032, D-034).

    Blender -b --factory-startup --python-exit-code 1 --python assets/blender/build.py -- \
        cortico/fragment --out .cache/blender/cortico/fragment.raw.glb [--preview out.png] [--no-bake]

The asset is `assets/blender/<hood>/<object>.py` (an `assemble(params, rng)`
returning Parts) with its params in `<object>.json`. Prints one
`FOLIA_BUILD {json}` line with timings and triangle counts.
"""

import argparse
import importlib.util
import json
import math
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))

from folia import bake, export  # noqa: E402
from folia.mesh import set_point_attribute, triangle_count  # noqa: E402

# Batches whose schema leaves out the baked light (neon is its own program).
UNBAKED = {"neon": ("_AO", "_NIGHT")}


def check_version():
    pinned = (HERE / "VERSION").read_text().strip()
    running = bpy.app.version_string.split()[0]
    if running != pinned:
        sys.exit(f"build.py: Blender {running} is running but assets/blender/VERSION pins {pinned}")


def linear(hex_colour):
    """An sRGB `#rrggbb` in linear RGB."""
    srgb = [int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def load_asset(asset):
    path = HERE / f"{asset}.py"
    spec = importlib.util.spec_from_file_location(asset.replace("/", "."), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    params = json.loads((HERE / f"{asset}.json").read_text())
    return module, params


def preview(path, target):
    """A quick Workbench render from the town's yaw, for checking forms only;
    look-dev happens in the browser (D-034)."""
    scene = bpy.context.scene
    cam = bpy.data.objects.new("preview", bpy.data.cameras.new("preview"))
    scene.collection.objects.link(cam)
    cam.data.lens = 85
    yaw, pitch, dist = math.radians(45), math.radians(35), 70
    cam.location = (dist * math.cos(pitch) * math.cos(yaw), dist * math.cos(pitch) * math.sin(yaw),
                    dist * math.sin(pitch))
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.show_cavity = True
    scene.display.shading.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = 1280, 800
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="build.py")
    ap.add_argument("asset")
    ap.add_argument("--out", required=True)
    ap.add_argument("--preview")
    ap.add_argument("--no-bake", action="store_true")
    # src/palette.ts as JSON, passed in by assets/pipeline/build.ts, so the one
    # palette (D-024) is read by TypeScript rather than parsed from it.
    ap.add_argument("--palette", required=True, type=json.loads)
    args = ap.parse_args(argv)

    check_version()
    started = time.perf_counter()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    module, params = load_asset(args.asset)
    hood, name = args.asset.split("/")
    lod = params["lod"]

    parts = module.assemble(params, np.random.default_rng(params["seed"]))
    assembled = time.perf_counter()

    bake.assign_materials(parts, {"neon": linear(args.palette["mint"])})
    joined = export.join(parts, f"{hood}.{name}.all.{lod}")
    if args.no_bake:
        count = len(joined.data.vertices)
        set_point_attribute(joined.data, "_AO", np.ones(count))
        set_point_attribute(joined.data, "_NIGHT", np.zeros((count, 3)))
    else:
        bake.bake(joined, params["bake"], ["neon"])
    baked = time.perf_counter()

    batches = export.split_by_material(joined, lambda mat: f"{hood}.{name}.{mat}.{lod}", UNBAKED)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    export.export(batches, out, {"hood": hood, "asset": name, "lod": lod, "groups": params["groups"]})
    exported = time.perf_counter()

    if args.preview:
        preview(args.preview, (0, 0, 2))

    summary = {
        "asset": args.asset,
        "triangles": {ob["batch"]: triangle_count(ob) for ob in batches},
        "seconds": {
            "assemble": round(assembled - started, 2),
            "bake": round(baked - assembled, 2),
            "export": round(exported - baked, 2),
        },
    }
    print("FOLIA_BUILD " + json.dumps(summary))


main()
