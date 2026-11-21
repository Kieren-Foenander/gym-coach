"""The squat must preserve both shoulders through the loop and reject full humeral twist at the cap."""
import json
from pathlib import Path
import runpy

import bpy

here = Path(__file__).parent
api = runpy.run_path(str(here / "animate.py"))
spec = json.loads((here / "exercises/squat.json").read_text())
# Keep the narrow-grip pose that exposed the bug as a fixture, even if the
# shipped squat changes grip or shoulder position again.
spec["keys"][0].update(bar={"at": "upper back"}, grip_width=.32, elbows=[.6, -.5, -.6], clavicle=[0, 0])
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())

for frame in (1, 1 + round(spec.get("frames", 96) * .45)):
    bpy.context.scene.frame_set(frame)
    for side in api["SIDES"]:
        # Restore the curl-era deformation without changing a single grip or elbow position.
        arm, fore = f"{side}Arm", f"{side}ForeArm"
        upper = (api["head"](fore) - api["head"](arm)).normalized()
        lower = (api["head"](f"{side}Hand") - api["head"](fore)).normalized()
        rest_hinge = api["REST"][arm].col[1].cross(api["REST"][fore].col[1]).normalized()
        # This sibling has the same rest frame as Arm and carries the cap
        # weights. Rotating it cannot move the IK chain.
        api["aim"](f"{side}ArmSwing", upper, api["REST"][arm].transposed() @ rest_hinge,
                   upper.cross(lower).normalized())
    api["update"]()
    points, _ = api["evaluated_points"](api["body"])
    for side in api["SIDES"]:
        patch = api["ShoulderShape"](side)
        problems = api["Problems"]()
        patch.check(frame, points, problems)
        # On the MakeHuman body a bench press stretches the deltoid patch nearly as far as this
        # bulge does, so the pectoral patch is the one that has to catch it.
        assert any("pectoral" in failure for failure in problems.found), (side, frame, patch.worst)
        print("NEGATIVE REGRESSION PASSED", side, frame, patch.worst)
print("SHOULDER REGRESSIONS PASSED")
