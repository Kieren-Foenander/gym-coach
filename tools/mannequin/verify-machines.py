"""Verify a seated press and reject a lever angle beyond its physical stops."""
import json
from pathlib import Path
import runpy

here = Path(__file__).parent
api = runpy.run_path(str(here / "animate.py"))
spec = json.loads((here / "exercises/machine-chest-press.json").read_text())
spec.update(frames=1, keys=spec["keys"][:1],
            checkpoints=[check for check in spec["checkpoints"] if check.get("at", 0) == 0])
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())

spec["keys"][0]["lever_angle"] = spec["equipment"][0]["travel"][0] - 5
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "machine lever outside its stops" in problems.found, list(problems.lines())
print("MACHINE REGRESSIONS PASSED")
