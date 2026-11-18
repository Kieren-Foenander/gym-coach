"""Check the curl, then reintroduce palm roll at the hinge to reproduce the original pinch."""
import json
from pathlib import Path
import runpy

import bpy
import numpy as np

here = Path(__file__).parent
api = runpy.run_path(str(here / "animate.py"))
spec = json.loads((here / "exercises/dumbbell-curl.json").read_text())
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())

# Deliberately drive the proximal forearm with the wrist's roll and use linear skinning.
# The checked coordinates come from Blender's evaluated mesh, as in the production bake.
bpy.context.scene.frame_set(1 + round(spec.get("frames", 96) * 0.5))
body = api["body"]
next(m for m in body.modifiers if m.type == "ARMATURE").use_deform_preserve_volume = False
for side in api["SIDES"]:
    proximal = api["bones"][f"{side}ForeArm"]
    proximal.matrix = api["bones"][f"{side}ForeArmRoll"].matrix.copy()
api["update"]()
points, _ = api["evaluated_points"](body)
for side in api["SIDES"]:
    problems = api["Problems"]()
    section = api["ElbowSection"](side)
    section.check(1, points, problems)
    assert problems.found, f"Failed to catch linear skinning and proximal roll on the {side} elbow"
    print(f"NEGATIVE REGRESSION PASSED {side}: collapsed to {section.minimum:.1%} of rest area")
print("ELBOW REGRESSIONS PASSED")

# Force the posed left forearm into the chest and measure the resulting crossing.
contact = api["SkinContact"]()
rest = np.array([v.co[:] for v in body.data.vertices])
fore = api["rig"].data.bones["LeftForeArm"]
wrist = api["rig"].data.bones["LeftHand"].head_local
middle = np.array((fore.head_local + wrist) / 2)
patch = np.linalg.norm(rest - middle, axis=1) < .09
intruding = rest.copy()
intruding[patch, 0] -= middle[0] - .13
problems = api["Problems"]()
contact.check(1, intruding, problems)
assert "distant skin contact" in problems.found, list(problems.lines())
print("NEGATIVE REGRESSION PASSED", list(problems.lines()))
