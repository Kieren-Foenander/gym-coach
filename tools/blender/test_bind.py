"""Regression checks: blender -b --python-exit-code 1 --python tools/blender/test_bind.py."""

import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas


def check_side(left):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mirror = 1 if left else -1
    # The opposite leg is geometrically nearer in this tight inner-thigh fold.
    skin = np.array([
        [0.05, -0.1, 0.5], [0.05, 0.1, 0.5], [0.05, 0, 0.7],
        [-0.005, -0.1, 0.5], [-0.005, 0.1, 0.5], [-0.005, 0, 0.7],
    ]) * np.array([mirror, 1, 1])
    own, other = (".L", ".R") if left else (".R", ".L")
    bones = ["upperleg01" + own, "upperleg01" + other, "root"]
    weights = np.array([[0.8, 0, 0.2]] * 3 + [[0, 1, 0]] * 3)
    mesh = bpy.data.meshes.new("Inner thigh")
    mesh.from_pydata([[0.001 * mirror, 0, 0.6]], [], [])
    anatomy = bpy.data.objects.new("Anatomy", mesh)
    bpy.context.scene.collection.objects.link(anatomy)
    rig = bpy.data.objects.new("Rig", bpy.data.armatures.new("Rig"))
    bpy.context.scene.collection.objects.link(rig)
    parts = [atlas.Part("Inner thigh" + own, atlas.MUSCLE, "adductors", "leg", left)]
    atlas.bind(anatomy, parts, np.array([0]), skin, [(0, 1, 2), (3, 4, 5)], weights, bones, rig)
    result = {anatomy.vertex_groups[g.group].name: g.weight for g in mesh.vertices[0].groups}
    assert result.get("upperleg01" + other, 0) == 0, result
    assert abs(result.get("upperleg01" + own, 0) - 0.8) < 1e-5, result
    assert abs(result.get("root", 0) - 0.2) < 1e-5, result
    assert abs(sum(result.values()) - 1) < 1e-5, result


check_side(True)
check_side(False)
print("PASS: inner thighs bind to their own leg and retain shared pelvis motion")
