"""Check a rendered rig: blender -b deadlift.blend --python-exit-code 1 --python tools/blender/check_deadlift.py."""

import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas
import trainer

scene = bpy.context.scene
rig = next(obj for obj in scene.objects if obj.type == "ARMATURE")
bar = bpy.data.objects["Barbell"]
feet = {side: [] for side in (".L", ".R")}
palms = {side: Vector(rig[f"grip_palm{side}"]) for side in feet}
positions, elbow_angles, contacts = [], [], []

for frame in range(scene.frame_start, scene.frame_end + 1):
    scene.frame_set(frame)
    positions.append(tuple(bar.location))

    for side in feet:
        def point(bone):
            return rig.matrix_world @ rig.pose.bones[bone + side].head

        feet[side].append(point("foot"))
        shoulder, elbow, wrist = [point(bone) for bone in ("upperarm01", "lowerarm01", "wrist")]
        elbow_angles.append(math.degrees((shoulder - elbow).angle(wrist - elbow)))
        contact = trainer.bar_grip(rig, side, palms[side])
        contacts.append(math.hypot(contact.y - bar.location.y, contact.z - bar.location.z))
        assert abs(contact.x) > abs(point("lowerleg01").x) + 0.01, "Grip must stay outside the knees"

positions = np.array(positions)
slip = max((point - points[0]).length for points in feet.values() for point in points)
assert slip < 0.003, f"Feet slide by {slip} m"
assert np.ptp(positions[:, :2], axis=0).max() < 1e-5, "Bar drifts horizontally"
assert min(elbow_angles) > 175, "Elbows bend during the pull"
assert max(contacts) < 0.005, f"Hand slips off bar by {max(contacts)} m"
assert abs(positions[0, 2] - bar["plate_radius"] - bar["floor_height"]) < 1e-4, "Plates miss the floor"
assert np.linalg.norm(positions[0] - positions[-1]) < 1e-4, "Loop does not return to its start"

# The squat regression: no individual atlas part may be pulled by both legs.
anatomy = bpy.data.objects["Anatomy"]
parts = atlas.read_parts(anatomy)
sides = np.zeros((parts.max() + 1, 2))
for vertex in anatomy.data.vertices:
    for group in vertex.groups:
        name = anatomy.vertex_groups[group.group].name
        if name.startswith(("upperleg", "lowerleg")):
            sides[parts[vertex.index], 0 if name.endswith(".L") else 1] += group.weight
assert not ((sides[:, 0] > 0) & (sides[:, 1] > 0)).any(), "Anatomy bridges the two legs"

print("DEADLIFT_CHECK", json.dumps({
    "frames": len(positions),
    "ankle_drift_m": slip,
    "max_grip_error_m": max(contacts),
    "minimum_elbow_angle_degrees": min(elbow_angles),
    "bar_height_range_m": [float(positions[:, 2].min()), float(positions[:, 2].max())],
    "cross_leg_parts": 0,
}))
