"""Measure the rendered deadlift's keyed bar, legs and joints through one complete repetition."""
import json
import math
from pathlib import Path
import runpy

import bpy
import numpy as np

here = Path(__file__).parent
api = runpy.run_path(str(here / "animate.py"))
spec = json.loads((here / "exercises/deadlift.json").read_text())
# Nonuniform spacing, direction changes and the wrap all use the same tangent
# on both sides. A held coordinate must stay exactly still beside a moving one.
curve = [{"at": t, "v": [v, h]} for t, v, h in
         ((.08, 1, 0), (.18, 3, 0), (.62, 5, 2), (.83, -1, 2))]


def sample(t):
    return api["PoseSpan"](curve, t).sample("v")


step = 1e-6
for key in curve:
    t = key["at"]
    before = (sample(t) - sample(t - step)) / step
    after = (sample(t + step) - sample(t)) / step
    assert np.allclose(before, after, atol=.002), (t, before, after)
assert sample(.14)[1] == 0 and sample(.74)[1] == 2
assert np.allclose(sample(-step), sample(1 - step))
assert (sample(.18 + step)[0] - sample(.18 - step)[0]) / (2 * step) > 1

problems, _, _ = api["bake"](spec, api["load_keys"](spec))
assert not problems.found, list(problems.lines())

body = api["body"]
rest = np.array([v.co[:] for v in body.data.vertices])
edges = np.array([e.vertices[:] for e in body.data.edges])
leg = (rest[:, 0] > 0) & (rest[:, 0] < .24) & (rest[:, 2] < .93)
a, b = edges[leg[edges].all(axis=1)].T
bar, hip, shoulder = [], [], []
gaps, elbows = [], []
scene = bpy.context.scene
for frame in range(scene.frame_start, scene.frame_end + 1):
    scene.frame_set(frame)
    centre = bpy.data.objects["barbell"].matrix_world.translation
    bar.append(tuple(centre))
    hip.append(api["head"]("LeftUpLeg").z)
    joint = api["head"]("LeftArm")
    shoulder.append(joint.z)
    elbow, wrist = api["head"]("LeftForeArm"), api["head"]("LeftHand")
    elbows.append(math.degrees((elbow - joint).angle(wrist - elbow)))
    pts, _ = api["evaluated_points"](body)
    # Cut the leg cage at shaft height, so coarse vertex spacing can't hide clearance.
    crosses = (pts[a, 2] - centre.z) * (pts[b, 2] - centre.z) <= 0
    u, v = pts[a[crosses]], pts[b[crosses]]
    y = u[:, 1] + (v[:, 1] - u[:, 1]) * (centre.z - u[:, 2]) / (v[:, 2] - u[:, 2])
    gaps.append(min(y) - centre.y - api["Barbell"].SHAFT)

bar = np.array(bar)
z = bar[:, 2]
dz = np.diff(z)
assert abs(z[0] - api["Barbell"].PLATE) < .001 and abs(z[-1] - z[0]) < .001
assert np.ptp(bar[:, 1]) < .03 and np.ptp(bar[:, 0]) < .001
assert min(gaps) > -.002 and max(gaps) < .045, (min(gaps), max(gaps))
assert max(elbows) < 15, max(elbows)
lockout = np.flatnonzero(np.isclose(z, max(z), atol=1e-5, rtol=0))
assert len(lockout) >= 3
assert min(dz[:lockout[0]]) >= -1e-6 and max(dz[lockout[-1]:]) <= 1e-6
# A segment eased to rest at knee height will fail on either pass.
knee = (z[:-1] > .43) & (z[:-1] < .55)
assert np.any(knee[:lockout[0]]) and np.any(knee[lockout[-1]:])
assert min(abs(dz[knee])) * scene.render.fps > .30, dz[knee]
early = np.arange(len(z)) <= np.flatnonzero(z >= z[0] + .10)[0]
rise_difference = (np.array(hip) - hip[0]) - (np.array(shoulder) - shoulder[0])
assert max(abs(rise_difference[early])) < .015
print(f"DEADLIFT REGRESSIONS PASSED: knee speed ≥{min(abs(dz[knee])) * scene.render.fps:.2f} m/s, "
      f"bar drift {np.ptp(bar[:, 1]) * 100:.1f} cm, maximum leg gap {max(gaps) * 100:.1f} cm, "
      f"initial hip/shoulder rise difference ≤{max(abs(rise_difference[early])) * 100:.1f} cm")
