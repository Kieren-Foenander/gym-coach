"""Builds the figure once and saves it, so renders open a ready scene instead of rebuilding.

    blender -b --python-exit-code 1 --python tools/mannequin/build.py -- <out.blend>

The figure is a MakeHuman man (CC0), made through Blender's MPFB extension. MakeHuman bodies come
with a skeleton and skin weights tuned to bend, so nothing here guesses where joints are or how
the skin follows them. The animator drives a smaller skeleton with Mixamo's bone names, placed on
MakeHuman's joints, and each of its bones takes over the skin of the MakeHuman bones it stands
for. Each closed fist is stitched into the forearm of the same MakeHuman man.

Each training muscle group is a soft region on the surface, stored as a float attribute named
`muscle:<group>`. A render sets `glow` from those regions and the material lights up there.
Measurements the animator needs (palm direction, ankle height, torso landmarks) are stored on
the rig as custom properties.
"""

import math
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

SHAPE = {"gender": 1.0, "age": 0.5, "muscle": 1.0, "weight": 0.6, "proportions": 1.0}
HIP_HEIGHT = 0.87  # the hip joints' height the exercise specs are written for
SILVER = (0.62, 0.64, 0.68)
# Linear RGB; the same pigment drives diffuse colour and a small amount of emission.
PIGMENTS = {
    "Brick": (0.48, 0.048, 0.050),
    "Coral": (0.65, 0.125, 0.098),
    "Rose": (0.55, 0.085, 0.16),
    "Peony": (0.61, 0.19, 0.32),
}
DEFAULT_PIGMENT = "Rose"
BACKDROP = (0.0011, 0.0012, 0.0014)
FLOOR = (0.0005, 0.00055, 0.00065)

# The library's muscle groups that can be shown on a body (src/domain/catalog.ts, less "Full body" and "Cardio").
MUSCLES = (
    "Chest", "Shoulders", "Biceps", "Triceps", "Forearms", "Lats", "Upper back", "Traps", "Lower back",
    "Abs", "Obliques", "Glutes", "Quads", "Hamstrings", "Adductors", "Abductors", "Calves", "Neck",
)
FINGERS = ("Index", "Middle", "Ring", "Pinky")


# ---------------------------------------------------------------- the body


def make_human(scale):
    """A MakeHuman man with MakeHuman's default skeleton fitted and weighted to him."""
    bpy.ops.preferences.addon_enable(module="bl_ext.blender_org.mpfb")
    from bl_ext.blender_org.mpfb.services.humanservice import HumanService
    from bl_ext.blender_org.mpfb.services.targetservice import TargetService

    shape = TargetService.get_default_macro_info_dict()
    shape.update(SHAPE)
    human = HumanService.create_human(macro_detail_dict=shape, scale=scale)
    TargetService.bake_targets(human)
    skeleton = HumanService.add_builtin_rig(human, "default")
    return human, skeleton


def mirror(point):
    return Vector((-point.x, point.y, point.z))


# Which bone of the animator's skeleton takes over each MakeHuman bone's skin. Bones not listed
# (fingers, toes, face) go with the nearest listed bone above them, except toes, which go to ToeBase.
TAKES_OVER = {
    "root": "Hips", "pelvis": "Hips", "spine05": "Hips", "spine04": "Spine", "spine03": "Spine1",
    "spine02": "Spine2", "spine01": "Spine2", "breast": "Spine2",
    "neck01": "Neck", "neck02": "Neck", "neck03": "Neck", "head": "Head",
    "clavicle": "Shoulder", "shoulder01": "Shoulder",
    # MakeHuman splits each arm bone in two so the twist spreads along it. The animator's
    # ArmSwing only swings the upper arm, Arm also twists it; ForeArmRoll carries the forearm's
    # twist towards the wrist.
    "upperarm01": "ArmSwing", "upperarm02": "Arm", "lowerarm01": "ForeArm", "lowerarm02": "ForeArmRoll",
    "wrist": "Hand", "upperleg01": "UpLeg", "upperleg02": "UpLeg", "lowerleg01": "Leg", "lowerleg02": "Leg",
    "foot": "Foot",
}
MIDDLE = {"Hips", "Spine", "Spine1", "Spine2", "Neck", "Head"}


def taken_over_by(bone):
    """The animator's bone that takes over this MakeHuman bone's skin."""
    while bone is not None:
        name = bone.name
        side = {".L": "Left", ".R": "Right"}.get(name[-2:], "")
        base = name[:-2] if side else name
        if base.startswith("toe"):
            return f"{side}ToeBase"
        if base in TAKES_OVER:
            target = TAKES_OVER[base]
            return target if target in MIDDLE else f"{side}{target}"
        bone = bone.parent
    return "Hips"


def make_body():
    """The MakeHuman man at the height the specs expect, his skin weighted to the animator's bones."""
    human, skeleton = make_human(0.1)
    hip = (skeleton.matrix_world @ skeleton.data.bones["upperleg01.L"].head_local).z
    for thing in (human, skeleton):
        bpy.data.objects.remove(thing)
    human, skeleton = make_human(0.1 * HIP_HEIGHT / hip)

    rest = skeleton.data.bones
    at = lambda name: skeleton.matrix_world @ rest[name].head_local.copy()  # noqa: E731
    middle = lambda name: Vector((0, at(name).y, at(name).z))  # noqa: E731
    hip_joint = at("upperleg01.L")
    top = max((human.matrix_world @ v.co).z for v in human.data.vertices)
    joints = {
        # The specs place the pelvis (Hips) 5.5 cm above the hip joints, where it was on the
        # figure they were written for. The torso leans about this point.
        "Hips": Vector((0, at("spine05").y, hip_joint.z + 0.055)),
        "Spine": middle("spine04"), "Spine1": middle("spine03"), "Spine2": middle("spine02"),
        "Neck": middle("neck01"), "Head": middle("head"),
    }
    joints["HeadTop_End"] = Vector((0, joints["Head"].y, top))
    toes = sum((at(f"toe{i}-1.L") for i in range(1, 6)), Vector()) / 5
    joints.update({
        "LeftUpLeg": hip_joint, "LeftLeg": at("lowerleg01.L"), "LeftFoot": at("foot.L"),
        "LeftToeBase": toes, "LeftToe_End": toes + Vector((0, -0.05, -0.008)),
        "LeftShoulder": at("clavicle.L"), "LeftArm": at("upperarm01.L"),
        "LeftForeArm": at("lowerarm01.L"), "LeftHand": at("wrist.L"),
    })
    for finger, number in zip(FINGERS, (2, 3, 4, 5)):
        joints[f"LeftHand{finger}1"] = at(f"finger{number}-1.L")
    for name in [name for name in joints if name.startswith("Left")]:
        joints["Right" + name[4:]] = mirror(joints[name])
    knuckles = [joints[f"LeftHand{name}1"] for name in FINGERS]
    palm = (knuckles[0] - knuckles[-1]).cross(joints["LeftHandMiddle1"] - joints["LeftHand"]).normalized()
    if palm.x > 0:  # the palm of a hanging hand faces the thigh
        palm = -palm

    # Hand MakeHuman's weights over to the animator's bones, then drop the MakeHuman skeleton.
    owner = {bone.name: taken_over_by(bone) for bone in rest if bone.use_deform}
    names = {group.index: group.name for group in human.vertex_groups}
    weights = {}
    for vertex in human.data.vertices:
        for group in vertex.groups:
            target = owner.get(names[group.group])
            if target and group.weight > 0:
                cell = weights.setdefault(target, {})
                cell[vertex.index] = cell.get(vertex.index, 0) + group.weight
    # Keep the skin and the eyes; MakeHuman's helper geometry (joint markers, clothes fitting,
    # teeth, tongue, hair) goes.
    keep = {human.vertex_groups[name].index for name in ("body", "helper-l-eye", "helper-r-eye")}
    doomed = [v.index for v in human.data.vertices if not keep & {g.group for g in v.groups}]
    for modifier in list(human.modifiers):
        human.modifiers.remove(modifier)
    human.parent = None
    human.matrix_world = Matrix()
    bpy.data.objects.remove(skeleton)
    human.vertex_groups.clear()
    for target, cell in weights.items():
        group = human.vertex_groups.new(name=target)
        for index, weight in cell.items():
            group.add([index], weight, "REPLACE")
    mesh = bmesh.new()
    mesh.from_mesh(human.data)
    mesh.verts.ensure_lookup_table()
    bmesh.ops.delete(mesh, geom=[mesh.verts[i] for i in doomed], context="VERTS")
    mesh.to_mesh(human.data)
    mesh.free()
    human.data.validate()
    human.data.update()
    human.name = human.data.name = "body"
    for polygon in human.data.polygons:
        polygon.use_smooth = True

    rig = build_rig(joints)
    human.parent = rig
    skin = human.modifiers.new("skin", "ARMATURE")
    skin.object = rig
    skin.use_deform_preserve_volume = True
    smooth = human.modifiers.new("smooth", "SUBSURF")
    smooth.levels, smooth.render_levels = 0, 2  # the checks use the plain surface, renders a smooth one
    print(f"body: {len(human.data.vertices)} points, {len(human.vertex_groups)} bones, {top:.3f} m tall")
    return human, rig, joints, {"palm": palm}


PARENTS = {
    "Hips": None, "Spine": "Hips", "Spine1": "Spine", "Spine2": "Spine1", "Neck": "Spine2",
    "Head": "Neck", "HeadTop_End": "Head",
}
for side in ("Left", "Right"):
    PARENTS.update({
        f"{side}Shoulder": "Spine2", f"{side}Arm": f"{side}Shoulder", f"{side}ForeArm": f"{side}Arm",
        f"{side}Hand": f"{side}ForeArm", f"{side}UpLeg": "Hips", f"{side}Leg": f"{side}UpLeg",
        f"{side}Foot": f"{side}Leg", f"{side}ToeBase": f"{side}Foot", f"{side}Toe_End": f"{side}ToeBase",
    })


def build_rig(joints):
    """A bone from each joint to its child's joint. End joints (tips) get a short stub.

    Each arm also gets two bones lying on top of its own: ArmSwing (the upper arm's swing without
    its twist, for the skin near the shoulder) and ForeArmRoll (the forearm's twist, for the skin
    near the wrist).
    """
    data = bpy.data.armatures.new("rig")
    rig = bpy.data.objects.new("rig", data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    children = {}
    for name, parent in PARENTS.items():
        children.setdefault(parent, []).append(name)
    chain_child = {
        "Hips": "Spine", "Spine2": "Neck", "LeftHand": "LeftHandMiddle1", "RightHand": "RightHandMiddle1",
    }
    for name in PARENTS:
        bone = data.edit_bones.new(name)
        bone.head = joints[name]
        child = chain_child.get(name) or next(iter(children.get(name, [])), None)
        if child:
            bone.tail = joints[child]
        else:
            parent = PARENTS[name]
            bone.tail = joints[name] + (joints[name] - joints[parent]).normalized() * 0.02
        bone.roll = 0
    for name, parent in PARENTS.items():
        if parent:
            data.edit_bones[name].parent = data.edit_bones[parent]
    for side in ("Left", "Right"):
        for name, copy, parent in ((f"{side}ArmSwing", f"{side}Arm", f"{side}Shoulder"),
                                   (f"{side}ForeArmRoll", f"{side}ForeArm", f"{side}ForeArm")):
            bone, original = data.edit_bones.new(name), data.edit_bones[copy]
            bone.head, bone.tail, bone.roll = original.head, original.tail, original.roll
            bone.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    for pose_bone in rig.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
    for name in PARENTS:  # bones that only end a chain carry no skin of their own
        if name.endswith("_End"):
            data.bones[name].use_deform = False
    return rig


GRIP_RADIUS = 0.014  # the 28 mm shaft the frozen fists are sculpted around


def hand_frame(wrist, middle, index, pinky):
    """A hand's own axes: across the knuckles (index side), along to the middle knuckle, and their cross."""
    along = (middle - wrist).normalized()
    across = index - pinky
    across = (across - along * across.dot(along)).normalized()
    return Matrix((across, along, across.cross(along))).transposed()


def make_fists(hand_shapes):
    """Two closed fists, built from a MakeHuman man whose hands are made to bend.

    Each hand is replaced by a fist that never changes shape, so a grip can never deform badly: the fingers wrap round a tunnel a bar fits through, and the thumb
    closes over the index and middle fingers. Returns, for each side, the fist's points and faces in
    that hand's own axes (see hand_frame, wrist at the origin, middle knuckle at length 1).
    """
    human, skeleton = make_human(0.1)
    rest, pose = skeleton.data.bones, skeleton.pose.bones
    for bone in pose:
        bone.rotation_mode = "QUATERNION"
    skinning = [m for m in human.modifiers if m.type == "ARMATURE"]
    for modifier in skinning:
        modifier.use_deform_preserve_volume = True
        modifier.show_viewport = False  # only the bones matter while the fingers close

    def swing(name, direction):
        current = pose[name].matrix.copy()
        turned = (current.to_3x3().normalized().col[1].rotation_difference(direction).to_matrix() @ current.to_3x3().normalized()).to_4x4()
        turned.translation = current.translation
        pose[name].matrix = turned
        bpy.context.view_layer.update()

    fists = {}
    for side, tag, sign in (("Left", "L", 1), ("Right", "R", -1)):
        head = lambda name: rest[f"{name}.{tag}"].head_local.copy()  # noqa: E731
        frame = hand_frame(head("wrist"), head("finger3-1"), head("finger2-1"), head("finger5-1"))
        palm = -frame.col[2] * sign  # found by eye: this way the fingers close over the palm
        shape = hand_shapes[side]
        if shape != "fist":
            if shape not in {"support", "diamond", "pinch", "cup"}:
                raise ValueError(f"Unknown hand shape {shape}")
            # Keep the MakeHuman phalanx lengths. The long fingers share a
            # contact plane on a plate, or turn up around a dumbbell head.
            bends = {"support": (0, 0, 0), "diamond": (0, 0, 0), "pinch": (12, 4, -3), "cup": (15, 45, 70)}[shape]
            for finger in (2, 3, 4, 5):
                for joint, degrees in enumerate(bends, 1):
                    angle = math.radians(degrees)
                    spread = (3.5 - finger)*(.055 if shape in ("support", "diamond") else .028)
                    direction = Vector((spread, math.cos(angle), -sign*math.sin(angle)))
                    swing(f"finger{finger}-{joint}.{tag}", frame @ direction)
            if shape in ("support", "diamond", "pinch", "cup"):
                targets = ((.053,.063,-.038),(.047,.089,-.055),(.031,.113,-.052)) if shape == "pinch" else (
                    (.058,.056,-.022),(.067,.080,-.039),(.060,.102,-.055))
                if shape == "support":
                    targets = ((.068,.052,-.008),(.079,.074,-.010),(.087,.092,-.012))
                for joint, (x,y,z) in enumerate(targets, 1):
                    name = f"finger1-{joint}.{tag}"
                    direction = frame @ Vector((.75, .66, 0)) if shape == "diamond" else (
                        head("wrist") + frame @ Vector((x, y, sign * z)) - pose[name].head)
                    swing(name, direction)
            origin = head("wrist") + frame @ Vector((0,.09,-sign*.018))
            fists[side] = {"shape":shape, "frame":frame, "wrist":head("wrist"),
                           "length":(head("finger3-1")-head("wrist")).length, "tunnel":origin}
            continue
        # Adduct the fingers and close them around a shared cylindrical grip.
        # Pose each phalanx around one straight cylinder, rather than giving unequal
        # fingers identical joint angles (which puts the shaft through the pinky).
        centre = Vector((0, 0.100, -0.025))
        for finger in (2, 3, 4, 5):
            name = f"finger{finger}-1.{tag}"
            current = pose[name].matrix.copy()
            x = (frame.transposed() @ (current.translation - head("wrist"))).x
            current.translation += frame.col[0] * ((.021, .002, -.017, -.033)[finger - 2] - x)
            if finger == 5:
                current.translation += frame.col[1] * .005
            pose[name].matrix = current
            bpy.context.view_layer.update()
            radius = 0.024 if finger in (2, 3, 4) else 0.0195
            for joint in (1, 2, 3):
                name = f"finger{finger}-{joint}.{tag}"
                p = frame.transposed() @ (pose[name].head - head("wrist"))
                p.z *= sign
                delta = Vector((p.y - centre.y, p.z - centre.z))
                distance = delta.length
                theta = math.atan2(delta.x, delta.y)
                length = rest[name].length
                cosine = max(-1.0, min(1.0, (distance**2 + radius**2 - length**2) / (2 * distance * radius)))
                theta += math.acos(cosine)
                target = Vector((p.x, centre.y + radius * math.sin(theta), centre.z + radius * math.cos(theta)))
                target.z *= sign
                swing(name, head("wrist") + frame @ target - pose[name].head)
        bpy.context.view_layer.update()
        # Oppose the thumb at its base, then fold its two phalanges across the fingers.
        # A single target for all three bones straightens the thumb into a spike.
        for joint, xyz in enumerate(((0.048, 0.075, -0.026), (0.020, 0.100, -0.057), (-0.006, 0.101, -0.058)), 1):
            target = head("wrist") + frame @ Vector((xyz[0], xyz[1], xyz[2] * sign))
            name = f"finger1-{joint}.{tag}"
            swing(name, target - pose[name].head)
        # Store the cylinder itself; the animator must not estimate its centre from bones.
        middle = head("wrist") + frame @ Vector((0, centre.y, centre.z * sign))
        fists[side] = {"frame": frame, "wrist": head("wrist"), "length": (head("finger3-1") - head("wrist")).length, "tunnel": middle}

    # Bake the pose into the skin and keep only each hand, from the wrist on. MakeHuman hides its
    # helper geometry with a mask, which would renumber the points; show it so the numbers match.
    for modifier in human.modifiers:
        modifier.show_viewport = modifier.type == "ARMATURE"
    depsgraph = bpy.context.evaluated_depsgraph_get()
    posed = human.evaluated_get(depsgraph).to_mesh()
    skin = human.vertex_groups["body"].index
    names = {group.index: group.name for group in human.vertex_groups}
    for side, tag in (("Left", "L"), ("Right", "R")):
        hand_bones = (f"wrist.{tag}", "metacarpal", "finger")
        keep = []
        for vertex in human.data.vertices:
            groups = {g.group: g.weight for g in vertex.groups}
            if skin not in groups:
                continue
            bones = [(w, names[g]) for g, w in groups.items() if names[g].endswith((".L", ".R"))]
            strongest = max(bones)[1] if bones else ""
            if strongest.endswith(f".{tag}") and strongest.startswith(hand_bones):
                keep.append(vertex.index)
        kept = set(keep)
        order = {old: new for new, old in enumerate(keep)}
        fist = fists[side]
        to_hand = fist["frame"].transposed()
        points = [(to_hand @ (posed.vertices[i].co - fist["wrist"])) / fist["length"] for i in keep]
        faces = [[order[v] for v in polygon.vertices] for polygon in human.data.polygons if set(polygon.vertices) <= kept]
        fist["points"], fist["faces"] = points, faces
        if fist.get("shape") == "diamond":
            for digit, number in (("thumb", 1), ("index", 2)):
                distal = pose[f"finger{number}-3.{tag}"]
                edges = [posed.vertices[i].co for i in keep
                         if (posed.vertices[i].co - distal.tail).length < .018]
                tip = max(edges, key=lambda point: (point - distal.head).dot(distal.vector.normalized()),
                          default=distal.tail)
                fist[digit] = (to_hand @ (tip - fist["wrist"])) / fist["length"]

        fist["tunnel"] = (to_hand @ (fist["tunnel"] - fist["wrist"])) / fist["length"]
    human.evaluated_get(depsgraph).to_mesh_clear()
    for thing in [human, skeleton]:
        bpy.data.objects.remove(thing)
    return fists


def remove_hands(body, rig):
    """Deletes the sculpt's own hands past the wrist; the fists take their place."""
    mesh = bmesh.new()
    mesh.from_mesh(body.data)
    deform = mesh.verts.layers.deform.active
    names = {group.index: group.name for group in body.vertex_groups}
    doomed = []
    for side in ("Left", "Right"):
        bone = rig.data.bones[f"{side}Hand"]
        wrist, along = bone.head_local, (bone.tail_local - bone.head_local).normalized()
        for vertex in mesh.verts:
            weights = vertex[deform]
            if not weights:
                continue
            owner = names[max(weights.items(), key=lambda item: item[1])[0]]
            if owner in (f"{side}Hand", f"{side}ForeArm") and (vertex.co - wrist).dot(along) > -0.012:
                doomed.append(vertex)
    bmesh.ops.delete(mesh, geom=doomed, context="VERTS")
    # Cut a regular cross-section in the distal forearm. A boundary picked only
    # by dominant bone can zigzag across the wrist pivot and buckle in flexion.
    for side in ("Left", "Right"):
        bone = rig.data.bones[side + "Hand"]
        along = (bone.tail_local - bone.head_local).normalized()
        local = {v for v in mesh.verts if (v.co - bone.head_local).length < .095}
        geom = list(local) + [e for e in mesh.edges if all(v in local for v in e.verts)]
        geom += [f for f in mesh.faces if all(v in local for v in f.verts)]
        bmesh.ops.bisect_plane(mesh, geom=geom, dist=1e-7, plane_no=along,
                               plane_co=bone.head_local - along * .032, clear_outer=True)
    mesh.to_mesh(body.data)
    mesh.free()


def attach_fists(rig, body, fists, joints, material):
    """Sculpt the rigid closed grip before joining it to the forearm."""
    measurements = {}
    for side, fist in fists.items():
        wrist = joints[f"{side}Hand"]
        frame = hand_frame(wrist, joints[f"{side}HandMiddle1"], joints[f"{side}HandIndex1"], joints[f"{side}HandPinky1"])
        length = (joints[f"{side}HandMiddle1"] - wrist).length
        def fit_point(p):
            return p * length
        data = bpy.data.meshes.new(f"fist.{side}")
        data.from_pydata([wrist + frame @ fit_point(p) for p in fist["points"]], [], fist["faces"])
        data.materials.append(material)
        for polygon in data.polygons:
            polygon.use_smooth = True
        thing = bpy.data.objects.new(f"fist.{side}", data)
        bpy.context.scene.collection.objects.link(thing)
        smooth = thing.modifiers.new("smooth", "SUBSURF")
        smooth.levels = smooth.render_levels = 2
        # Freeze the finished surface, then seat its contact patches on the virtual shaft.
        # Subdivision must happen BEFORE this projection or it cuts back into the bar.
        bpy.context.view_layer.objects.active = thing
        bpy.ops.object.modifier_apply(modifier=smooth.name)
        centre = fit_point(fist["tunnel"])
        if fist.get("shape", "fist") != "fist":
            if fist["shape"] in ("support", "diamond"):
                # A loaded palm flattens at the thenar pad and fingertips.
                sign = 1 if side == "Left" else -1
                for v in thing.data.vertices:
                    q = frame.transposed() @ (v.co - wrist)
                    q.z -= sign * .010 * max(0,min(1,(q.y-.10)/.06))
                    q.z = sign * max(-.020, sign*q.z)
                    v.co = wrist + frame @ q
            if fist.get("shape") == "diamond":
                for digit in ("thumb", "index"):
                    thing["diamond_" + digit] = wrist + frame @ fit_point(fist[digit])
            thing["grip_axis"] = frame.col[0]
            thing["grip_origin"] = wrist + frame @ centre
            thing["grip_sections"] = [0.0]
            measurements[side] = frame @ centre
            continue
        clearance = GRIP_RADIUS + 0.00025
        moved = 0
        for vertex in thing.data.vertices:
            local = frame.transposed() @ (vertex.co - wrist)
            radial = Vector((0, local.y - centre.y, local.z - centre.z))
            if radial.length < clearance:
                moved += 1
                if radial.length < 1e-7:
                    raise RuntimeError("Fist surface crosses its grip axis")
                local += radial.normalized() * (clearance - radial.length)
                vertex.co = wrist + frame @ local
        thing.data.update()
        print(f"{side} fist: seated {moved} surface vertices on the 28 mm grip")
        # Fuse the tiny folded skin overlaps left by deep finger flexion. The high
        # resolution remesh keeps nails and finger separations, while removing doubled
        # contact faces. Cut the exact cylindrical cavity after smoothing.
        closed = bmesh.new()
        closed.from_mesh(thing.data)
        bmesh.ops.bisect_plane(closed, geom=closed.verts[:] + closed.edges[:] + closed.faces[:],
                              plane_co=wrist + frame.col[1] * .010, plane_no=frame.col[1],
                              clear_inner=True, clear_outer=False)
        bmesh.ops.holes_fill(closed, edges=[e for e in closed.edges if e.is_boundary], sides=0)
        bmesh.ops.recalc_face_normals(closed, faces=closed.faces[:])
        closed.to_mesh(thing.data)
        closed.free()
        thing.data.validate()
        thing.data.update()
        remesh = thing.modifiers.new("clean closed skin", "REMESH")
        remesh.mode = 'VOXEL'
        remesh.voxel_size = 0.0008
        remesh.use_smooth_shade = True
        bpy.ops.object.modifier_apply(modifier=remesh.name)
        relax = thing.modifiers.new("relax skin", "SMOOTH")
        relax.factor = 0.8
        relax.iterations = 5
        bpy.ops.object.modifier_apply(modifier=relax.name)
        bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=GRIP_RADIUS + .00015, depth=.25)
        cutter = bpy.context.object
        cutter.matrix_world = Matrix.Translation(wrist + frame @ centre) @ frame.col[0].to_track_quat("Z", "Y").to_matrix().to_4x4()
        bpy.context.view_layer.objects.active = thing
        cut = thing.modifiers.new("grip cavity", "BOOLEAN")
        cut.operation = 'DIFFERENCE'
        cut.solver = 'MANIFOLD'  # the exact solver runs out of memory on the remeshed fist
        cut.object = cutter
        bpy.ops.object.modifier_apply(modifier=cut.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
        for polygon in thing.data.polygons:
            polygon.use_smooth = True
        topology = bmesh.new()
        topology.from_mesh(thing.data)
        if any(not edge.is_manifold for edge in topology.edges) or topology.calc_volume(signed=True) <= 0:
            raise RuntimeError(f"{side} fist has an open or inverted surface")
        topology.free()
        thing["grip_axis"] = frame.col[0]
        thing["grip_origin"] = wrist + frame @ centre
        thing["grip_sections"] = [x * length / fist["length"] for x in (.021, .002, -.017, -.033)]
        measurements[side] = frame @ centre
    return measurements


def continuous_skin(body, joints, rest_surface):
    """Keep a low-resolution collision cage and stitch the finished rendering surfaces."""
    skin = body.copy()
    skin.data = body.data.copy()
    skin.name = "skin"
    bpy.context.scene.collection.objects.link(skin)
    bpy.context.view_layer.objects.active = skin
    smooth = skin.modifiers["smooth"]
    smooth.levels = smooth.render_levels
    bpy.ops.object.modifier_move_to_index(modifier=smooth.name, index=0)
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    # Store the subdivision correspondence before adding the new hand vertices.
    attr = skin.data.attributes.new("cage_point", "INT", "POINT")
    attr.data.foreach_set("value", np.arange(1, len(attr.data)+1, dtype=np.int32))
    body.hide_render = True
    mesh = bmesh.new()
    mesh.from_mesh(skin.data)
    bmesh.ops.delete(mesh, geom=[e for e in mesh.edges if e.is_wire], context="EDGES")
    weights = mesh.verts.layers.deform.active
    for side in ("Left", "Right"):
        wrist = joints[side + "Hand"]
        frame = hand_frame(wrist, joints[side + "HandMiddle1"], joints[side + "HandIndex1"], joints[side + "HandPinky1"])
        hand = skin.vertex_groups[side + "Hand"].index
        source = bpy.data.objects["fist." + side]
        for key in ("grip_axis", "grip_origin", "grip_sections"):
            skin[key + "." + side] = source[key]
        for key in ("diamond_thumb", "diamond_index"):
            if key in source:
                skin[key + "." + side] = source[key]
        # Cut through the solid wrist just beyond the voxel-remesh cap.
        fist = bmesh.new()
        fist.from_mesh(source.data)
        bmesh.ops.bisect_plane(fist, geom=fist.verts[:] + fist.edges[:] + fist.faces[:],
                              plane_co=wrist + frame.col[1] * .016, plane_no=frame.col[1],
                              dist=1e-7, clear_inner=True)
        def boundary(part):
            edges = [e for e in part.edges if e.is_boundary and (e.verts[0].co-wrist).length < .085]
            neighbours = {}
            for e in edges:
                a, b = e.verts
                neighbours.setdefault(a, []).append(b)
                neighbours.setdefault(b, []).append(a)
            if not neighbours or any(len(v) != 2 for v in neighbours.values()):
                raise RuntimeError(f"{side} wrist has an invalid boundary")
            ring = [next(iter(neighbours))]
            while True:
                a, b = neighbours[ring[-1]]
                nxt = b if len(ring)>1 and a == ring[-2] else a
                if nxt == ring[0]:
                    break
                ring.append(nxt)
            if len(ring) != len(neighbours):
                raise RuntimeError(f"{side} wrist has multiple boundaries")
            return ring
        arm_ring = boundary(mesh)
        palm_ring = boundary(fist)
        marker = skin.vertex_groups.new(name="GripSurface." + side).index
        copied = {}
        for v in fist.verts:
            target = mesh.verts.new(v.co)
            target[weights][hand] = target[weights][marker] = 1
            copied[v] = target
        for face in fist.faces:
            mesh.faces.new([copied[v] for v in face.verts]).smooth = True
        palm = [copied[v] for v in palm_ring]
        # Match loop winding and starting point, then zipper by perimeter distance.
        def order(loop):
            coords = [frame.transposed() @ (v.co-wrist) for v in loop]
            if sum(a.x*b.z-a.z*b.x for a,b in zip(coords,coords[1:]+coords[:1])) < 0:
                loop.reverse()
            start = max(range(len(loop)), key=lambda i: (loop[i].co-wrist).dot(frame.col[0]))
            return loop[start:]+loop[:start]
        arm, palm = order(arm_ring), order(palm)
        def lengths(loop):
            distance = np.cumsum([0]+[(a.co-b.co).length for a,b in zip(loop,loop[1:]+loop[:1])])
            return distance / distance[-1]
        # Recover the MakeHuman wrist cross-section at each station. Account for
        # small differences at the two boundaries while preserving the wrist bones
        # and heel of the palm between them.
        def skin_point(point):
            along = frame.col[1]
            origin = wrist + along * (point - wrist).dot(along)
            hit, _, _, _ = rest_surface.ray_cast(origin, (point - origin).normalized(), .09)
            if hit is None:
                raise RuntimeError(f"{side} wrist sample missed the original skin")
            return hit

        # The remeshed palm rim contains very short edges from the plane cut.
        # Propagating those along the entire wrist creates long, nearly
        # degenerate quads and a longitudinal streak under specular light.
        # At the voxel-cut rim the frozen palm and MakeHuman wrist can differ
        # by a fraction of a millimetre. Match both to the same dorsal surface,
        # fading the rest-shape correction out before the fingers and cavity.
        for vertex in copied.values():
            depth = (vertex.co - wrist).dot(frame.col[1])
            if depth < .036:
                t = max(0, min(1, (depth - .016) / .020))
                vertex.co = skin_point(vertex.co).lerp(vertex.co, t*t*(3-2*t))

        def sample(loop, distances, station):
            j = np.searchsorted(distances, station, side="right") - 1
            fraction = (station - distances[j]) / (distances[j+1] - distances[j])
            return loop[j], loop[(j+1) % len(loop)], fraction

        def bridge(lower, upper, lo, hi):
            i = j = 0
            while i < len(lower) or j < len(upper):
                points = [lower[i % len(lower)], upper[j % len(upper)]]
                if j == len(upper) or (i < len(lower) and lo[i+1] <= hi[j+1]):
                    i += 1
                    points.append(lower[i % len(lower)])
                else:
                    j += 1
                    points.append(upper[j % len(upper)])
                mesh.faces.new(points).smooth = True

        u, v = lengths(arm), lengths(palm)
        stations = np.linspace(0, 1, len(arm) + 1)
        rings = [[] for _ in range(9)]
        for station in stations[:-1]:
            a, b, fraction = sample(arm, u, station)
            c, d, distal = sample(palm, v, station)
            base = a.co.lerp(b.co, fraction)
            end = c.co.lerp(d.co, distal)
            fore_offset = base - skin_point(base)
            palm_offset = end - skin_point(end)
            groups = set(a[weights].keys()) | set(b[weights].keys()) | {hand}
            for step, ring in enumerate(rings, 1):
                t = step / (len(rings) + 1)
                blend = t * t * (3 - 2 * t)
                position = skin_point(base.lerp(end, t)) + fore_offset.lerp(palm_offset, blend)
                point = mesh.verts.new(position)
                for group in groups:
                    proximal = a[weights].get(group, 0)*(1-fraction) + b[weights].get(group, 0)*fraction
                    point[weights][group] = proximal * (1-blend) + (blend if group == hand else 0)
                ring.append(point)
        bridge(arm, rings[0], u, stations)
        for lower, upper in zip(rings, rings[1:]):
            for i in range(len(lower)):
                j = (i+1) % len(lower)
                mesh.faces.new([lower[i],lower[j],upper[j],upper[i]]).smooth = True
        bridge(rings[-1], palm, stations, v)

        # Use one continuous field across the cage, stitch and proximal palm.
        pigment = mesh.verts.layers.float["muscle:Forearms"]
        for vertex in mesh.verts:
            offset = vertex.co - wrist
            if offset.length < .15:
                t = max(0, min(1, (.033 - offset.dot(frame.col[1])) / .15))
                vertex[pigment] = t*t*(3-2*t)
        if any(not edge.is_manifold for ring in [arm, *rings, palm]
               for vertex in ring for edge in vertex.link_edges):
            raise RuntimeError(f"{side} wrist stitch is open")
        fist.free()
        bpy.data.objects.remove(source, do_unlink=True)
    bmesh.ops.recalc_face_normals(mesh, faces=mesh.faces[:])
    mesh.to_mesh(skin.data)
    mesh.free()
    # Use the cage after posing and subdivision, including its pose correctives.
    # New wrist and hand points have no cage index and retain their own skinning.
    tree = bpy.data.node_groups.new("finished body surface", "GeometryNodeTree")
    for direction in ("INPUT", "OUTPUT"):
        tree.interface.new_socket(name="Geometry", in_out=direction, socket_type="NodeSocketGeometry")
    nodes, link = tree.nodes, tree.links.new
    inp = nodes.new("NodeGroupInput")
    out = nodes.new("NodeGroupOutput")
    cage = nodes.new("GeometryNodeObjectInfo")
    cage.inputs["Object"].default_value = body
    index = nodes.new("GeometryNodeInputNamedAttribute")
    index.data_type = "INT"
    index.inputs["Name"].default_value = "cage_point"
    offset = nodes.new("ShaderNodeMath")
    offset.operation = "SUBTRACT"
    link(index.outputs["Attribute"], offset.inputs[0])
    offset.inputs[1].default_value = 1
    sample = nodes.new("GeometryNodeSampleIndex")
    sample.data_type = "FLOAT_VECTOR"
    link(cage.outputs["Geometry"], sample.inputs["Geometry"])
    link(nodes.new("GeometryNodeInputPosition").outputs[0], sample.inputs["Value"])
    link(offset.outputs[0], sample.inputs["Index"])
    position = nodes.new("GeometryNodeSetPosition")
    link(inp.outputs[0], position.inputs["Geometry"])
    link(index.outputs["Attribute"], position.inputs["Selection"])
    link(sample.outputs["Value"], position.inputs["Position"])
    link(position.outputs[0], out.inputs[0])
    skin.modifiers.new("posed cage", "NODES").node_group = tree
    skin.hide_set(True)  # avoid evaluating the high-density mesh during cage checks


# ---------------------------------------------------------------- muscles


def dominant_bones(mesh):
    names = {group.index: group.name for group in mesh.vertex_groups}
    result = []
    for vertex in mesh.data.vertices:
        best = max(vertex.groups, key=lambda g: g.weight, default=None)
        result.append(names[best.group] if best else "")
    return result


def along(point, head, tail):
    """How far a point is along a bone (0 at the head, 1 at the tail) and its offset from the axis."""
    axis = tail - head
    t = (point - head).dot(axis) / axis.length_squared
    return t, point - (head + axis * max(0.0, min(1.0, t)))


def muscle_regions(rig, mesh):
    """Each muscle group as a 0/1 value per vertex, from where it sits and which way the surface faces.

    The figure faces -Y in its rest A-pose, with its left side at +X. The heights below were
    measured on a figure whose knees, hip joints, neck and crown were at 0.48, 0.87, 1.43 and 1.68 m;
    each point's height is first mapped onto that figure between the same landmarks.
    """
    bones = rig.data.bones
    owner = dominant_bones(mesh)
    regions = {group: [0.0] * len(mesh.data.vertices) for group in MUSCLES}
    torso = {"Hips", "Spine", "Spine1", "Spine2", "Neck", "LeftShoulder", "RightShoulder"}
    here = [0, bones["LeftLeg"].head_local.z, bones["LeftUpLeg"].head_local.z, bones["Neck"].head_local.z, bones["HeadTop_End"].head_local.z]
    measured = [0, 0.48, 0.87, 1.43, 1.68]
    shoulder_z = 1.385
    for index, vertex in enumerate(mesh.data.vertices):
        n = vertex.normal
        p = Vector((vertex.co.x, vertex.co.y, float(np.interp(vertex.co.z, here, measured))))
        bone = owner[index]
        side = "Left" if p.x > 0 else "Right"
        sign = 1 if side == "Left" else -1
        ax = abs(p.x)
        front, back = n.y < -0.35, n.y > 0.35

        def mark(group):
            regions[group][index] = 1.0

        if bone in torso or bone.endswith("UpLeg") and p.z > 0.8:
            if front and 1.22 < p.z < shoulder_z - 0.01 and 0.012 < ax < 0.2:
                mark("Chest")
            if front and 0.93 < p.z < 1.21 and ax < 0.075:
                mark("Abs")
            if 0.95 < p.z < 1.2 and 0.075 <= ax < 0.17 and not back:
                mark("Obliques")
            if (back or n.z > 0.45) and shoulder_z - 0.06 < p.z < 1.5 and ax < 0.15:
                mark("Traps")
            if back and 1.18 < p.z <= shoulder_z - 0.06 and ax < 0.1:
                mark("Upper back")
            if n.y > -0.2 and 1.04 < p.z < 1.32 and 0.08 < ax < 0.2:
                mark("Lats")
            if back and 0.93 < p.z < 1.1 and ax < 0.07:
                mark("Lower back")
            if back and 0.76 < p.z <= 0.95 and ax < 0.18:
                mark("Glutes")
        if bone in ("Neck", "Head") and 1.42 < p.z < 1.5 and not front:
            mark("Neck")

        arm = bones[f"{side}Arm"]
        if bone in (f"{side}Shoulder", f"{side}Arm", f"{side}ArmSwing") and ax > 0.13:
            t, offset = along(vertex.co, arm.head_local, arm.tail_local)
            if t < 0.3 or (t < 0.4 and n.z > 0.3):
                mark("Shoulders")
            elif t < 0.95:
                if n.y < 0:
                    # Follow the belly down the anterior humerus. Taper into the
                    # distal tendon and leave the cap of the deltoid silver.
                    belly = max(0.0, 1 - ((t - 0.59) / 0.35) ** 2)
                    facing = max(0.0, -offset.normalized().y)
                    # Heat weights on the outer pec can favour the arm over any
                    # individual spine bone. Keep the pigment within the arm section.
                    radial_fade = max(0.0, min(1.0, (0.075 - offset.length) / 0.015))
                    regions["Biceps"][index] = min(1.0, belly * facing * 1.8) * radial_fade
                else:
                    mark("Triceps")
        if bone in (f"{side}ForeArm", f"{side}ForeArmRoll") or bone == f"{side}Hand" and along(vertex.co, bones[f"{side}Hand"].head_local, bones[f"{side}Hand"].tail_local)[0] < 0.15:
            mark("Forearms")

        thigh = bones[f"{side}UpLeg"]
        if bone == f"{side}UpLeg" and p.z < 0.8:
            t, _ = along(vertex.co, thigh.head_local, thigh.tail_local)
            inward = -n.x * sign
            if 0.08 < t < 0.92:
                if inward > 0.55 and t < 0.75:
                    mark("Adductors")
                elif -inward > 0.65 and t < 0.4:
                    mark("Abductors")
                elif n.y < 0.1:
                    mark("Quads")
                elif t > 0.12:
                    mark("Hamstrings")
        shin = bones[f"{side}Leg"]
        if bone == f"{side}Leg":
            t, _ = along(vertex.co, shin.head_local, shin.tail_local)
            if 0.08 < t < 0.72 and n.y > 0.15:
                mark("Calves")
    return regions


def soften(mesh, values, rounds=3, gain=2.2):
    """Feathers a region's edge over a few rings of neighbours so the glow fades out."""
    values = np.array(values)
    edges = np.array([e.vertices[:] for e in mesh.data.edges])
    for _ in range(rounds):
        total, count = values.copy(), np.ones_like(values)
        np.add.at(total, edges[:, 0], values[edges[:, 1]])
        np.add.at(total, edges[:, 1], values[edges[:, 0]])
        np.add.at(count, edges[:, 0], 1)
        np.add.at(count, edges[:, 1], 1)
        values = total / count
    # Feathering thins a small region out; lift it back so the middle of every muscle glows fully.
    values = np.clip(values * gain, 0.0, 1.0)
    return values * values * (3 - 2 * values)  # smoothstep: a solid middle with a soft edge


def store(mesh, name, values):
    attribute = mesh.data.attributes.new(name, "FLOAT", "POINT")
    attribute.data.foreach_set("value", np.asarray(values, dtype=float))


# ---------------------------------------------------------------- measurements for the animator


def measure(rig, body, hand, tunnels):
    """Stores what the animator needs to know about this figure on the rig."""
    points = np.array([v.co[:] for v in body.data.vertices])
    bones = rig.data.bones
    chest = bones["Spine2"].head_local
    neck = bones["Neck"].head_local.z
    middle = np.abs(points[:, 0]) < 0.04
    # A squat bar sits on the upper back just below the base of the neck; a bench bar touches the
    # chest 16 cm below it.
    upper_back = points[middle & (points[:, 2] > neck - 0.03) & (points[:, 2] < neck + 0.01)]
    sternum = points[middle & (points[:, 2] > neck - 0.18) & (points[:, 2] < neck - 0.14)]
    bar = 0.014
    rig["landmarks"] = {
        # (side, forward, up) metres from the base of the upper spine (Spine2), in the rest pose.
        "upper back": (0.0, -(upper_back[:, 1].max() + bar + 0.006 - chest.y), neck - 0.01 - chest.z),
        "chest": (0.0, chest.y - sternum[:, 1].min() + bar + 0.004, neck - 0.16 - chest.z),
        "shoulders": (0.0, chest.y - bones["LeftArm"].head_local.y, bones["LeftArm"].head_local.z - chest.z),
    }
    feet = points[(points[:, 2] < 0.15) & (points[:, 0] > 0)]
    rig["ankle_height"] = bones["LeftFoot"].head_local.z - feet[:, 2].min()
    rig["palm_rest.Left"] = hand["palm"]
    rig["palm_rest.Right"] = Vector((-hand["palm"].x, hand["palm"].y, hand["palm"].z))
    # Where a held bar sits: the middle of the fist's tunnel, from the wrist along the hand and
    # out from the palm.
    for side, sign in (("Left", 1), ("Right", -1)):
        hand_bone = bones[f"{side}Hand"]
        along_hand = (hand_bone.tail_local - hand_bone.head_local).normalized()
        palm = Vector((hand["palm"].x * sign, hand["palm"].y, hand["palm"].z))
        rig[f"grip.{side}"] = (tunnels[side].dot(along_hand), tunnels[side].dot(palm))
    store(body, "hand", [0.0] * len(body.data.vertices))


# ---------------------------------------------------------------- look and stage


def glowing_material(name, base, metallic, roughness):
    """Satin silver with a diffuse pigment and a low emission floor in worked regions."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes["Principled BSDF"]
    shader.inputs["Roughness"].default_value = roughness
    glow = nodes.new("ShaderNodeAttribute")
    glow.attribute_name = "glow"
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = (*base, 1)
    pigment = nodes.new("ShaderNodeRGB")
    pigment.name = "Muscle pigment"
    pigment.outputs[0].default_value = (*PIGMENTS[DEFAULT_PIGMENT], 1)
    material["pigments"] = PIGMENTS
    material["default_pigment"] = DEFAULT_PIGMENT
    links.new(pigment.outputs[0], mix.inputs["B"])
    links.new(glow.outputs["Fac"], mix.inputs["Factor"])
    links.new(mix.outputs["Result"], shader.inputs["Base Color"])
    strength = nodes.new("ShaderNodeMath")
    strength.operation = "MULTIPLY"
    strength.inputs[1].default_value = 0.055
    links.new(glow.outputs["Fac"], strength.inputs[0])
    links.new(pigment.outputs[0], shader.inputs["Emission Color"])
    links.new(strength.outputs["Value"], shader.inputs["Emission Strength"])
    # Lit muscle reads as paint, not chrome.
    metal = nodes.new("ShaderNodeMapRange")
    metal.inputs["To Min"].default_value = metallic
    metal.inputs["To Max"].default_value = 0.0
    links.new(glow.outputs["Fac"], metal.inputs["Value"])
    links.new(metal.outputs["Result"], shader.inputs["Metallic"])
    # ...and matte, so a highlight can't wash the colour out.
    rough = nodes.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value = roughness
    rough.inputs["To Max"].default_value = 0.65
    links.new(glow.outputs["Fac"], rough.inputs["Value"])
    links.new(rough.outputs["Result"], shader.inputs["Roughness"])
    return material


def plain_material(name, colour, metallic, roughness):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = (*colour, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    return material


def studio():
    """The camera sees a dark backdrop, but the silver reflects a soft grey studio, top-lit.

    A mirror-like finish reflecting a black world comes out patchy black; this gives it something
    even to reflect, which is what makes metal read as smooth.
    """
    world = bpy.data.worlds.new("backdrop")
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    output = nodes["World Output"]
    seen = nodes["Background"]
    seen.inputs["Color"].default_value = (*BACKDROP, 1)
    lit = nodes.new("ShaderNodeBackground")
    gradient = nodes.new("ShaderNodeValToRGB")  # darker below the horizon, brighter overhead
    gradient.color_ramp.elements[0].position = 0.35
    gradient.color_ramp.elements[0].color = (0.13, 0.135, 0.15, 1)
    gradient.color_ramp.elements[1].position = 0.75
    gradient.color_ramp.elements[1].color = (0.28, 0.29, 0.31, 1)
    coordinates = nodes.new("ShaderNodeTexCoord")
    split = nodes.new("ShaderNodeSeparateXYZ")
    height = nodes.new("ShaderNodeMapRange")
    height.inputs["From Min"].default_value = -1
    links.new(coordinates.outputs["Generated"], split.inputs[0])
    links.new(split.outputs["Z"], height.inputs["Value"])
    links.new(height.outputs["Result"], gradient.inputs["Fac"])
    links.new(gradient.outputs["Color"], lit.inputs["Color"])
    path = nodes.new("ShaderNodeLightPath")
    choose = nodes.new("ShaderNodeMixShader")
    links.new(path.outputs["Is Camera Ray"], choose.inputs["Fac"])
    links.new(lit.outputs["Background"], choose.inputs[1])
    links.new(seen.outputs["Background"], choose.inputs[2])
    links.new(choose.outputs["Shader"], output.inputs["Surface"])
    return world


def stage():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 720, 900
    scene.render.fps = 30
    scene.eevee.shadow_ray_count = 4
    scene.render.film_transparent = False
    # Rolls bright highlights off gently without shifting the glow's hue.
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = -0.35
    scene.world = studio()

    bpy.ops.mesh.primitive_circle_add(vertices=96, radius=8, fill_type="NGON")
    floor = bpy.context.object
    floor.name = "floor"
    floor_material = plain_material("floor", FLOOR, 0.0, 1.0)
    floor_material.node_tree.nodes["Principled BSDF"].inputs["Specular IOR Level"].default_value = 0.0
    floor.data.materials.append(floor_material)

    rig = bpy.data.objects.new("lights", None)
    scene.collection.objects.link(rig)
    for name, energy, location, size in (
        ("key", 245, (-2.2, -2.6, 3.2), 5.0),
        ("fill", 185, (2.6, -1.6, 1.8), 5.0),
        ("rim", 145, (0.8, 2.8, 2.8), 4.0),
    ):
        light = bpy.data.lights.new(name, "AREA")
        light.energy, light.size = energy, size
        light.use_shadow_jitter = True
        lamp = bpy.data.objects.new(name, light)
        lamp.location = location
        lamp.parent = rig
        constraint = lamp.constraints.new("TRACK_TO")
        constraint.target = bpy.data.objects["body"]
        scene.collection.objects.link(lamp)

    camera = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    camera.data.lens = 50
    scene.collection.objects.link(camera)
    scene.camera = camera


def main():
    out = sys.argv[sys.argv.index("--") + 1]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body, rig, joints, hand = make_body()
    args = sys.argv[sys.argv.index("--")+1:]
    shapes = dict(zip(("Left","Right"), args[1:] or ("fist","fist")))
    for side, shape in shapes.items():
        rig["hand_shape." + side] = shape
    fists = make_fists(shapes)
    # Capture the intact wrist skin before cutting out the open hands.
    from mathutils.bvhtree import BVHTree
    body.modifiers["smooth"].levels = 2
    rest_surface = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    body.modifiers["smooth"].levels = 0
    remove_hands(body, rig)
    silver = glowing_material("silver", SILVER, 0.49, 0.49)
    tunnels = attach_fists(rig, body, fists, joints, silver)
    measure(rig, body, hand, tunnels)
    regions = muscle_regions(rig, body)
    for group in MUSCLES:
        if group == "Biceps":
            values = soften(body, regions[group], rounds=1, gain=1.15)
        else:
            values = soften(body, regions[group])
        store(body, f"muscle:{group}", values)
        print(f"{group}: {int(sum(regions[group]))} vertices")
    store(body, "glow", [0.0] * len(body.data.vertices))
    body.data.materials.clear()
    body.data.materials.append(silver)
    continuous_skin(body, joints, rest_surface)
    stage()
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)


main()
