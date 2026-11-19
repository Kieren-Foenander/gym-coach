"""Check a working cable setup and deliberately invalid cable lines."""
import json
from pathlib import Path
import runpy

from mathutils import Vector

here = Path(__file__).parent
api = runpy.run_path(str(here / "animate.py"))
spec = json.loads((here / "exercises/triceps-pushdown.json").read_text())
spec.update(frames=1, keys=spec["keys"][:1],
            checkpoints=[check for check in spec["checkpoints"] if check.get("at", 0) == 0])
keys = api["load_keys"](spec)
problems, _, _ = api["bake"](spec, keys)
assert not problems.found, list(problems.lines())

# Keep the baked grip in front of the chest, then aim the cable through the torso.
station = api["CableStation"](spec["equipment"][0])
station.lines = [(Vector((0, .38, 1.15)), Vector((0, -.50, 1.15)))]
points, _ = api["evaluated_points"](api["body"])
problems = api["Problems"]()
station.check(points, api["SkinContact"]().faces, 1, problems, [])
assert "cable line crosses the body" in problems.found, list(problems.lines())

config = {"attachment": "straight-bar", "columns": {"Both": {"at": [0, -4], "height": "high"}}}
station = api["CableStation"](config)
grips = {side: api["GripSurface"](side) for side in api["SIDES"]}
problems = api["Problems"]()
station.pose(api["PoseSpan"](keys, 0), api["Torso"](), grips, 1, [], problems)
assert "cable outside its travel" in problems.found, list(problems.lines())
# The original shaft check was infinite. A rendered grip can miss the fingers
# axially even when its centreline passes through the fist.
station.handles["Left"].scale.z = .04
api["update"]()
problems = api["Problems"]()
station.check_grips(grips, 1, problems)
assert "Left fist extends past the rendered grip" in problems.found, list(problems.lines())
print("CABLE REGRESSIONS PASSED")
