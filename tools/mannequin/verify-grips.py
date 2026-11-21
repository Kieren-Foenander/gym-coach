"""Regression checks for rigid grips. Run with Blender and the built mannequin scene.

tools/mannequin/render.sh --verify-rig
"""
import copy
import json
from pathlib import Path
import runpy

import bpy
from mathutils import Vector

scene_path = bpy.data.filepath
animator = Path(__file__).with_name("animate.py")


def fresh():
    bpy.ops.wm.open_mainfile(filepath=scene_path)
    return runpy.run_path(str(animator), run_name="grip_test")


fixture = {
    "frames": 64,
    "equipment": [{"type": "barbell"}],
    "stance": {"width": .34, "toe_out": 20},
    "keys": [
        {"at": 0, "pelvis": [0, 0, .925], "lean": 0,
         "bar": [0, -.32, 1.1], "grip_width": .24, "elbows": [.6, 0, -1]},
        {"at": .5, "grip_width": .40},
        {"at": .9, "grip_width": .24},
    ],
}
for grip in ("pronated", "supinated", "neutral"):
    api = fresh()
    spec = copy.deepcopy(fixture)
    spec["keys"][0]["grip"] = grip
    problems, _, _ = api["bake"](spec, api["load_keys"](spec))
    assert not problems.found, f"{grip}: " + "; ".join(problems.lines())
    print("REGRESSION PASSED", grip, "with moving grip widths 24–40 cm")

# Demonstrate that the checks reject actual bad mesh placement, independently of
# the IK target used by the older 'hand misses the bar' check.
api = fresh()
spec = copy.deepcopy(fixture)
spec["frames"] = 1
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())
surface = api["GripSurface"]("Left")
point = Vector((.24, -.32, 1.1))
axis = Vector((1, 0, 0))
original = surface.object.matrix_world.copy()
for displacement, expected in ((.008, "penetrates"), (.15, "floats")):
    moved = original.copy()
    moved.translation += Vector((0, displacement, 0))
    surface.object.matrix_world = moved
    bpy.context.view_layer.update()
    problems = api["Problems"]()
    surface.check(1, point, axis, .014, problems)
    assert any(expected in name for name in problems.found), f"Failed to catch displaced fist: {displacement} m, {problems.found}"
    print("NEGATIVE REGRESSION PASSED", displacement, list(problems.found))
print("GRIP REGRESSIONS PASSED")

# A reversed hand can pass every cavity test. Check actual hand orientation
# against whole-body landmarks in the three different overhand setups.
for slug, direction in (("squat", (0, -1, 0)), ("bench-press", (0, -1, 0)),
                        ("deadlift", (0, 1, 0))):
    api = fresh()
    spec = json.loads((animator.parent / "exercises" / f"{slug}.json").read_text())
    problems, _, _ = api["bake"](spec, api["load_keys"](spec))
    assert not problems.found, list(problems.lines())
    for frame in range(1, bpy.context.scene.frame_end + 1):
        bpy.context.scene.frame_set(frame)
        for side in api["SIDES"]:
            palm = api["world_rotation"](side + "Hand") @ api["palm_axis"](side)
            assert palm.dot(Vector(direction)) > 0, (slug, frame, side, palm)
    print("PALM ORIENTATION PASSED", slug)
