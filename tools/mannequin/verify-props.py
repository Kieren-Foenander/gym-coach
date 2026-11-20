"""Check contact and clearance for small exercise props."""
import json
from pathlib import Path
import runpy
from types import SimpleNamespace

import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

here = Path(__file__).parent
api = runpy.run_path(str(here / "animate.py"))


def initial_pose(slug):
    spec = json.loads((here / "exercises" / (slug + ".json")).read_text())
    spec.pop("hands", None)
    spec.update(frames=1, keys=spec["keys"][:1],
                checkpoints=[check for check in spec["checkpoints"] if check.get("at", 0) == 0])
    return spec


def bake(spec):
    problems, _, _ = api["bake"](spec, api["load_keys"](spec))
    assert not problems.found, list(problems.lines())


def skin():
    points, hands = api["evaluated_points"](api["body"])
    faces = api["SkinContact"]().faces
    return points, faces, hands


spec = initial_pose("wrist-roller")
bake(spec)
roller = api["WristRoller"]()
roller.move(Vector((0, -.37, .30)), 1)
roller.wind(0, 1)
api["update"]()
problems = api["Problems"]()
points, faces, hands = skin()
roller.check(points, faces, hands, {}, 1, problems, [])
assert "roller weight touches the floor" in problems.found, list(problems.lines())

spec = initial_pose("sled-push")
bake(spec)
sled = api["PushSled"](spec["equipment"][0])
sled.handles["Left"].scale.z = .04
api["update"]()
points, faces, hands = skin()
grips = {side: api["GripSurface"](side) for side in api["SIDES"]}
problems = api["Problems"]()
sled.check(points, faces, hands, grips, 1, problems, [])
assert "Left fist extends past the rendered grip" in problems.found, list(problems.lines())

crossbar = sled.parts[0]
corners = [crossbar.matrix_world @ vertex.co for vertex in crossbar.data.vertices]
centre = sum(corners, Vector()) / len(corners)
crossbar.location += api["head"]("Spine2") - centre
api["update"]()
problems = api["Problems"]()
sled.check(points, faces, hands, grips, 1, problems, [])
assert "sled crossbar crosses the body" in problems.found, list(problems.lines())

spec = initial_pose("gripper")
bake(spec)
gripper = api["HandGripper"](spec["equipment"][0])
gripper.bind(api["GripSurface"]("Left"))
gripper.pose(api["PoseSpan"](api["load_keys"](spec), 0), api["Torso"](), 1, [])
centre, axis = gripper.positions[0]
gripper.positions[0] = (centre - gripper.forward * .045, axis)
api["update"]()
points, faces, hands = skin()
problems = api["Problems"]()
gripper.check(points, faces, hands, 1, problems)
assert "gripper handle loses skin fit" in problems.found, list(problems.lines())

ball = api["StabilityBall"]()
ball.ball.location = (0, -.6, ball.RADIUS)
contact = SimpleNamespace(heel_vertices={"Left": np.array([0]), "Right": np.array([1])})
top = ball.ball.location.z + ball.RADIUS
heels = np.array([(0., -.6, top), (0., -.6, top)])
problems = api["Problems"]()
ball.check(heels, contact, 1, problems, [])
assert not problems.found, list(problems.lines())
heels[0, 2] += .035
ball.check(heels, contact, 1, problems, [])
assert "Left heel loses stability ball contact" in problems.found, list(problems.lines())
print("EXERCISE PROP REGRESSIONS PASSED")

spec = initial_pose("safety-bar-squat")
bake(spec)
spec["keys"][0]["bar"]["offset"][2] += .045
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "Left safety bar pad lifts off the shoulder" in problems.found, list(problems.lines())

spec = initial_pose("glute-ham-raise")
bake(spec)
spec["equipment"][0]["roller"][2] += .055
problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert "Left ankle loses Nordic roller contact" in problems.found, list(problems.lines())

spec = initial_pose("outdoor-cycling")
bake(spec)
cycle = api["CycleStation"](spec["equipment"][0])
key = spec["keys"][0]
cycle.pose(spec, api["PoseSpan"](api["load_keys"](spec), 0), 0, key, api["Torso"](), 1, [])
cycle.pedal_faces["Left"].z += .045
api["update"]()
points, faces, hands = skin()
grips = {side: api["GripSurface"](side) for side in api["SIDES"]}
problems = api["Problems"]()
cycle.check(points, faces, hands, grips, 1, problems, [])
assert "Left foot loses cycle pedal contact" in problems.found, list(problems.lines())

spec = initial_pose("jump-rope")
bake(spec)
rope = api["JumpRope"](spec["equipment"][0])
rope.rope.points = [Vector((0, -.5, 1.15)), Vector((0, .5, 1.15))]
points, faces, _ = skin()
problems = api["Problems"]()
rope.rope.check_clearance(BVHTree.FromPolygons(points, faces, all_triangles=True),
                          1, problems, "jump rope", rope.radius)
assert "jump rope crosses the body" in problems.found, list(problems.lines())
print("ROAD BIKE, GHD, SAFETY BAR AND JUMP ROPE REGRESSIONS PASSED")

spec = initial_pose("battle-ropes")
bake(spec)

ball = api["MedicineBall"]({"wall_y": -.875, "wall_target": 2.06})
ball.ball.location = (0, -.50, 1.1)
problems = api["Problems"]()
ball.check(np.array([(0., 0., 0.)]), 1, problems, [])
assert not problems.found, list(problems.lines())
ball.ball.location = (0, -.80, .08)
ball.check(np.array([(0., -.80, .08)]), 1, problems, [])
assert {"medicine ball crosses the body", "medicine ball crosses the floor",
        "medicine ball crosses the wall"} <= set(problems.found), list(problems.lines())
print("BATTLE ROPE AND MEDICINE BALL REGRESSIONS PASSED")
