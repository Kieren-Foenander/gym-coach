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
