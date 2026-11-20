"""Verify a seated press and reject a lever angle beyond its physical stops."""
import json
from pathlib import Path
import runpy

import bpy

from mathutils import Vector

here = Path(__file__).parent
api = runpy.run_path(str(here / "animate.py"))
spec = json.loads((here / "exercises/machine-chest-press.json").read_text())
spec.update(frames=1, keys=spec["keys"][:1],
            checkpoints=[check for check in spec["checkpoints"] if check.get("at", 0) == 0])
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())

# Force a rendered lever across the chest and require an actual mesh collision.
intruder = api["CableStation"].part("test lever", .023, api["material"]("test steel", (.3, .3, .3), .5, .4))
api["set_segment"](intruder, Vector((-.6, .04, .86)), Vector((.6, .04, .86)), 1)
api["update"]()
points, hands = api["evaluated_points"](api["body"])
problems = api["Problems"]()
api["check_hardware_clearance"]([(intruder, False)], points, api["SkinContact"]().faces, hands, {}, 1, problems)
assert "test lever crosses the body" in problems.found, list(problems.lines())
fixed_post = api["box"]("test fixed post", (.10, .10, 1.10), (0, .04, .66), intruder.data.materials[0])
api["update"]()
problems = api["Problems"]()
api["check_hardware_clearance"]([(fixed_post, False)], points, api["SkinContact"]().faces, hands, {}, 1, problems)
assert "test fixed post crosses the body" in problems.found, list(problems.lines())

spec["keys"][0]["lever_angle"] = spec["equipment"][0]["travel"][0] - 5
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "machine lever outside its stops" in problems.found, list(problems.lines())
print("MACHINE REGRESSIONS PASSED")

def initial_pose(slug):
    # Give each apparatus the original Blender scene, without baked curves
    # and corrective modifiers from the preceding fixture.
    global api
    bpy.ops.wm.open_mainfile(filepath=bpy.data.filepath)
    api = runpy.run_path(str(here / "animate.py"))
    spec = json.loads((here / f"exercises/{slug}.json").read_text())
    spec.update(frames=1, keys=spec["keys"][:1],
                checkpoints=[check for check in spec["checkpoints"] if check.get("at", 0) == 0])
    return spec


for slug in ("leg-extension", "leg-press", "smith-machine-squat"):
    spec = initial_pose(slug)
    problems, _, _ = api["bake"](spec, api["load_keys"](spec))
    assert not problems.found, (slug, list(problems.lines()))

spec = initial_pose("leg-extension")
spec["equipment"][0]["roller_offset"][1] -= .08
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "Left roller contact" in problems.found, list(problems.lines())

spec = initial_pose("seated-leg-curl")
spec["equipment"][0]["pads"]["thigh hold-down pad"]["face"][2] += .06
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "thigh hold-down pad loses skin contact" in problems.found, list(problems.lines())

spec = initial_pose("smith-machine-squat")
spec["keys"][0]["bar"] = [0, .20, 1.2]
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "Smith bar leaves its guides" in problems.found, list(problems.lines())
print("LEG STATION AND SMITH REGRESSIONS PASSED")

spec = initial_pose("standing-calf-raise")
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())

spec = initial_pose("standing-calf-raise")
spec["equipment"][0]["pad_at"][2] += .06
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "Left calf load pad loses support" in problems.found, list(problems.lines())
print("CALF STATION REGRESSIONS PASSED")

for slug in ("hip-abduction", "hip-adduction"):
    spec = initial_pose(slug)
    problems, _, _ = api["bake"](spec, api["load_keys"](spec))
    assert not problems.found, (slug, list(problems.lines()))

spec = initial_pose("hip-abduction")
spec["equipment"][0]["pad_offset"] += .03
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "Left thigh loses hip machine pad" in problems.found, list(problems.lines())
print("HIP STATION REGRESSIONS PASSED")

for slug in ("hack-squat", "pendulum-squat"):
    spec = initial_pose(slug)
    problems, _, _ = api["bake"](spec, api["load_keys"](spec))
    assert not problems.found, (slug, list(problems.lines()))

spec = initial_pose("hack-squat")
spec["equipment"][0]["shoulder_z"] += .05
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "Left shoulder pad contact" in problems.found, list(problems.lines())
print("GUIDED SQUAT REGRESSIONS PASSED")

spec = initial_pose("machine-lat-pulldown")
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())

spec = initial_pose("machine-lat-pulldown")
spec["equipment"][0]["restraints"]["pulldown thigh pad"]["face"][2] += .075
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "pulldown thigh pad loses skin contact" in problems.found, list(problems.lines())
print("SELECTORIZED PULLDOWN REGRESSIONS PASSED")

for slug in ("assisted-dip", "machine-dip", "machine-back-extension", "machine-lateral-raise"):
    spec = initial_pose(slug)
    problems, _, _ = api["bake"](spec, api["load_keys"](spec))
    assert not problems.found, (slug, list(problems.lines()))

spec = initial_pose("assisted-dip")
spec["keys"][0]["assist_height"] -= .07
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "Left knee platform contact" in problems.found, list(problems.lines())
print("ASSISTANCE AND PADDED LEVER REGRESSIONS PASSED")

for slug in ("stationary-bike", "treadmill-run"):
    spec = initial_pose(slug)
    problems, _, _ = api["bake"](spec, api["load_keys"](spec))
    assert not problems.found, (slug, list(problems.lines()))

spec = initial_pose("treadmill-run")
spec["keys"][0]["gait"][1] = -.06
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "Left foot goes through treadmill belt" in problems.found, list(problems.lines())
print("TREADMILL AND CYCLE REGRESSIONS PASSED")

spec = initial_pose("machine-glute-kickback")
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())

spec = initial_pose("machine-glute-kickback")
spec["equipment"][0]["forearm_support"]["face"][2] -= .045
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "Left kickback forearm support loses skin contact" in problems.found, list(problems.lines())
print("KICKBACK SUPPORT REGRESSIONS PASSED")

top = api["load_keys"](json.loads((here / "exercises/machine-hip-thrust.json").read_text()))[2]
spec = initial_pose("machine-hip-thrust")
spec.update(keys=[{**top, "at": 0}], checkpoints=[])
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())

spec = initial_pose("machine-hip-thrust")
spec.update(keys=[{**top, "at": 0}], checkpoints=[])
spec["equipment"][0]["pivot"][1] += .065
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "hip thrust pad leaves the front hip crease" in problems.found, list(problems.lines())
print("HIP THRUST PELVIS REGRESSIONS PASSED")

spec = initial_pose("stair-climber")
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())

spec = initial_pose("stair-climber")
spec["keys"][0]["pelvis"][2] += .22
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert any("foot loses cardio tread contact" in label for label in problems.found), list(problems.lines())
print("STEP MILL SUPPORT REGRESSIONS PASSED")

spec = initial_pose("dead-hang")
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())

spec = initial_pose("dead-hang")
spec["equipment"][0]["at"][2] -= .29
for side in ("left", "right"):
    spec["keys"][0]["foot_" + side][1] -= .29
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
for side in ("Left", "Right"):
    assert side + " foot below hanging clearance" in problems.found, list(problems.lines())
print("HANGING FOOT CLEARANCE REGRESSIONS PASSED")

spec = initial_pose("dip")
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())

spec = initial_pose("dip")
spec["equipment"][0]["grip"][0] = .12
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert any("dip rail crosses the body" in label for label in problems.found), list(problems.lines())
print("DIP RAIL CLEARANCE REGRESSIONS PASSED")

spec = initial_pose("crunch")
spec.pop("hands")
spec["keys"][0].pop("thigh_reach")
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())

spec = initial_pose("crunch")
spec.pop("hands")
spec["keys"][0].pop("thigh_reach")
spec["keys"][0]["pelvis"][2] += .05
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
for label in ("pelvis", "lower back"):
    assert label + " loses supine floor support" in problems.found, list(problems.lines())
print("SUPINE FLOOR SUPPORT REGRESSIONS PASSED")

spec = initial_pose("crunch")
spec.pop("hands")
spec["keys"][0].pop("thigh_reach")
spec["keys"][0]["neck_retraction"] = 0
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "head loses supine floor support" in problems.found, list(problems.lines())

spec = initial_pose("crunch")
spec.pop("hands")
spec["keys"][0].pop("thigh_reach")
spec["keys"][0]["head"] = -18
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "Head extends during supine support" in problems.found, list(problems.lines())

spec = initial_pose("side-plank")
spec.pop("hands")
spec["keys"][0]["pelvis"][2] += .04
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "lower foot loses side support contact" in problems.found, list(problems.lines())
print("SIDE SUPPORT REGRESSION PASSED")

spec = initial_pose("side-plank")
spec.pop("hands")
spec["side_support"]["wrist"][2] += .05
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert any(name.startswith("ulna section ") for name in problems.found), list(problems.lines())
print("FOREARM FLOOR CONTACT REGRESSION PASSED")

spec = initial_pose("decline-crunch")
spec.pop("hands")
spec["keys"][0].pop("thigh_reach")
spec["equipment"][0]["roller"][2] += .06
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "Left ankle loses restraint contact" in problems.found, list(problems.lines())
print("DECLINE BENCH RESTRAINT REGRESSION PASSED")

spec = initial_pose("bird-dog")
spec.pop("hands")
spec.pop("floor_hands")
spec["checkpoints"] = [entry for entry in spec["checkpoints"] if "hand_mode" not in entry]
spec["keys"][0]["pelvis"][2] += .04
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "Left knee loses floor support" in problems.found, list(problems.lines())
print("KNEELING FLOOR SUPPORT REGRESSION PASSED")

spec = initial_pose("pistol-squat")
spec.pop("hands")
spec["keys"][0]["free_leg_right"] = [-89, 4]
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "Right unsupported foot is too close to the floor" in problems.found, list(problems.lines())
print("UNSUPPORTED FOOT REGRESSION PASSED")

spec = initial_pose("bird-dog")
spec.pop("hands")
spec.pop("floor_hands")
spec["checkpoints"] = [entry for entry in spec["checkpoints"] if "hand_mode" not in entry]
spec["stance"]["y"] -= .11
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "Left hip is not over the knee" in problems.found, list(problems.lines())
print("KNEELING STACK REGRESSION PASSED")
