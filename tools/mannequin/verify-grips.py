"""Regression checks for rigid grips. Run with Blender and the built mannequin scene.

tools/mannequin/render.sh --verify-rig
"""
import copy
import json
from pathlib import Path
import runpy

import bpy
import numpy as np
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
original = surface.skin.matrix_world.copy()
for displacement, expected in ((.008, "penetrates"), (.15, "floats")):
    moved = original.copy()
    moved.translation += Vector((0, displacement, 0))
    surface.skin.matrix_world = moved
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

# Exercise the rendered geometry stack at a bent wrist. An accidental cage
# index on a finger would move its skin even with perfect armature weights.
api = fresh()
spec = json.loads((animator.parent / "exercises/front-raise.json").read_text())
peak = {**spec["keys"][0], **spec["keys"][1], "at": 0}
spec.update(frames=1, keys=[peak, {"at": .5}])
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())
skin = bpy.data.objects["skin"]
skin.hide_set(False)
api["detail"](True)
bpy.context.view_layer.update()
posed = skin.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
for side in api["SIDES"]:
    surface = api["GripSurface"](side)
    marker = skin.vertex_groups["GripSurface." + side].index
    selected = [v.index for v in skin.data.vertices if any(g.group == marker for g in v.groups)]
    transform = surface.transform
    error = max((posed.vertices[i].co - transform @ skin.data.vertices[i].co).length for i in selected)
    assert error < .00001, (side, error)
    print("RENDERED GRIP PASSED", side, "maximum error (m)", error)

# A straight cavity can fit a shaft even when the apparatus is facing the wrong
# way. Check the actual dumbbell root and palms in the hammer curl's low pose.
api = fresh()
spec = json.loads((animator.parent / "exercises/hammer-curl.json").read_text())
spec.update(frames=1, keys=[spec["keys"][0], {"at": .5}])
spec["checkpoints"] = [c for c in spec.get("checkpoints", []) if c.get("at", 0) == 0]
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())
for side, sign in api["SIDES"].items():
    shaft = bpy.data.objects["dumbbell." + side].matrix_world.to_3x3().col[0].normalized()
    palm = api["world_rotation"](side + "Hand") @ api["palm_axis"](side)
    assert abs(shaft.y) > .95 and palm.x * sign < -.9, (side, shaft[:], palm[:])
print("NEUTRAL DUMBBELL ORIENTATION PASSED")

# Contradict the measured starting pose in all three ways. A check reading
# authored targets instead of the actual joints or apparatus could miss these.
bad = {"at": 0, "elbow": [100, 120], "position": {"point": "Hand", "z": [1.8, 2]},
       "handle_axis": {"direction": [1, 0, 0], "degrees": 10}}
from types import SimpleNamespace
equipment = SimpleNamespace(roots={side: bpy.data.objects["dumbbell." + side] for side in api["SIDES"]})
problems = api["Problems"]()
api["check_movement"]([bad], 1, None, equipment, problems)
for name in ("elbow flexion", "Hand z", "handle_axis deviation"):
    assert any(name in issue for issue in problems.found), (name, problems.found)
print("MOVEMENT CHECKPOINT REGRESSIONS PASSED")

# Check bent equipment in its local frame. The trap bar must leave the
# lifter's stance empty while still catching a shin crossing the perimeter.
for kind in ("ez-bar", "trap-bar"):
    bar = api["BentBar"](kind)
    centre = Vector((0, .12, .72))
    bar.move(centre, 1)
    bpy.context.view_layer.update()
    for side in api["SIDES"]:
        point, axis = bar.grip(side)
        handle = bar.handles[side]
        assert (handle.matrix_world.translation - point).length < 1e-5
        assert abs(axis.dot(handle.matrix_world.to_3x3().col[2].normalized())) > .9999
        count, _, _ = bar.intrusions(np.array([point]), np.array([False]))
        assert count, (kind, side)
    if kind == "trap-bar":
        count, plates, _ = bar.intrusions(np.array([centre]), np.array([False]))
        assert not count and not plates
        count, _, _ = bar.intrusions(np.array([centre + Vector((.37, 0, 0))]), np.array([False]))
        assert count
bells = api["Kettlebells"]()
centre = Vector((.31, 0, .65))
bells.move("Left", centre, Vector((1, 0, 0)), 1)
for offset in ((0, 0, -bells.DROP), (.0585, 0, -.056), (0, 0, 0)):
    assert bells.intrusions(np.array([centre + Vector(offset)]))[0]
assert not bells.intrusions(np.array([centre + Vector((0, 0, -.045))]))[0]
print("SPECIALTY BAR AND KETTLEBELL REGRESSIONS PASSED")

# Samples at opposite ends of a tilted pad must use its local surface normal.
for support, angle in (("back", 0), ("back", 32), ("back", -15), ("chest", 50)):
    bench = api["Bench"]([0, 0, .49], angle=angle, support=support)
    top, rotation, _ = bench.pads[1]
    for along in (-.20, .20):
        for depth in (-.035, .012):
            sample = top + rotation @ np.array([0, along, depth])
            assert abs(bench.gap(np.array([sample])) - depth) < 1e-5
print("ADJUSTABLE BENCH REGRESSIONS PASSED")

# The bore is empty, the rim is solid, and rotating the cylinder axis changes
# which points are outside its two faces.
plate = api["ContactLoad"]({"type": "plate", "axis": [0, 1, 0], "thickness": .02})
samples = np.array([[0, 0, 0], [.06, 0, 0], [.06, .011, 0], [.12, 0, 0]])
assert np.allclose(plate.distance(samples), [.014, -.01, .001, .005])
bell = api["ContactLoad"]({"type": "vertical-dumbbell"})
assert np.all(bell.distance(np.array([[.06, 0, .094], [0, 0, 0]])) < 0)
assert bell.distance(np.array([[.06, 0, 0]]))[0] > .03
print("FACE CONTACT REGRESSIONS PASSED")
