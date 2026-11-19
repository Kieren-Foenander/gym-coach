"""Verify a seated press and reject a lever angle beyond its physical stops."""
import json
from pathlib import Path
import runpy

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
api["check_moving_parts"]([(intruder, False)], points, api["SkinContact"]().faces, hands, {}, 1, problems)
assert "test lever crosses the body" in problems.found, list(problems.lines())

spec["keys"][0]["lever_angle"] = spec["equipment"][0]["travel"][0] - 5
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "machine lever outside its stops" in problems.found, list(problems.lines())
print("MACHINE REGRESSIONS PASSED")
