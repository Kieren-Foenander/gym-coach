"""Poses the mannequin from an exercise spec, checks every frame, and renders it.

    blender -b mannequin.blend --python-exit-code 1 --python tools/mannequin/animate.py -- \\
        <spec.json> <out-folder> --muscles '{"primary": [...], "secondary": [...]}' [--sheet] [--view front|back]

--sheet renders four small stills (the contact sheet); without it every frame is rendered.
The checks run either way, and any failure stops the render with exit code 1.
See README.md for the spec format.
"""

import json
import math
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

STEEL = (0.32, 0.33, 0.36)
IRON = (0.018, 0.019, 0.022)
PAD = (0.03, 0.032, 0.038)

rig = bpy.data.objects["rig"]
body = bpy.data.objects["body"]
scene = bpy.context.scene
bones = rig.pose.bones
REST = {bone.name: bone.matrix_local.to_3x3() for bone in rig.data.bones}
SIDES = {"Left": 1, "Right": -1}

# Measured on this figure by build.py.
FLOOR_ANKLE = rig["ankle_height"]  # ankle height that puts a flat foot's sole on the floor
# Where a held bar sits in each fist: (from the wrist along the hand, out from the palm).
GRIP = {side: tuple(rig[f"grip.{side}"]) for side in ("Left", "Right")}
# Points on the torso, as (side, forward, up) metres from the base of the upper spine (Spine2).
LANDMARKS = {name: tuple(value) for name, value in rig["landmarks"].items()}


# The chest bar target includes shaft radius and 4 mm of clearance.
s, f, u = LANDMARKS["chest"]
LANDMARKS["sternum"] = (s, f - .018, u)


# ---------------------------------------------------------------- spec


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1 :]
    spec_path, out = args[0], args[1]
    muscles = json.loads(args[args.index("--muscles") + 1]) if "--muscles" in args else {}
    view = args[args.index("--view") + 1] if "--view" in args else "front"
    angle = float(args[args.index("--angle") + 1]) if "--angle" in args else None
    focus = args[args.index("--focus") + 1] if "--focus" in args else None
    return spec_path, out, muscles, view, angle, focus, "--sheet" in args


def load_keys(spec):
    """Each key inherits whatever it leaves out from the key before it."""
    keys, current = [], {"lean": 0, "spine": 0, "head": 0, "yaw": 0}
    for key in spec["keys"]:
        current = {**current, **key}
        keys.append(current)
    return keys


class PoseSpan:
    """Periodic, shape-preserving cubic Hermite interpolation on nonuniform key times."""

    def __init__(self, keys, t):
        count = len(keys)
        t = t % 1
        i = next((i for i in reversed(range(count)) if keys[i]["at"] <= t), count - 1)
        if t < keys[i]["at"]:
            t += 1
        self.keys = [keys[(i + j) % count] for j in (-1, 0, 1, 2)]
        self.durations = []
        for j in (-1, 0, 1):
            k = (i + j) % count
            end = keys[(k + 1) % count]["at"] + (k + 1 == count)
            self.durations.append(end - keys[k]["at"])
        self.u = (t - keys[i]["at"]) / self.durations[1]

    @staticmethod
    def tangent(a, b, c, left, right):
        # A weighted harmonic mean carries speed through a travel key. Holds
        # and direction reversals have a zero tangent on the affected axis.
        if left == 0 or right == 0:
            return 0
        incoming, outgoing = (b - a) / left, (c - b) / right
        w1, w2 = 2 * right + left, right + 2 * left
        same = incoming * outgoing > 0
        denominator = w1 * outgoing + w2 * incoming
        return np.divide((w1 + w2) * incoming * outgoing, denominator,
                         out=np.zeros_like(denominator), where=same)

    def sample(self, field, default=None, resolve=None):
        values = [key.get(field, default) for key in self.keys]
        p, a, b, q = [np.asarray(resolve(v) if resolve else v, dtype=float) for v in values]
        left, span, right = self.durations
        start = self.tangent(p, a, b, left, span)
        end = self.tangent(a, b, q, span, right)
        u = self.u
        blend = u * u * (3 - 2 * u)
        return a + (b - a) * blend + span * u * (1 - u) * ((1 - u) * start - u * end)


# ---------------------------------------------------------------- skeleton


def update():
    bpy.context.view_layer.update()


def reset_pose():
    for bone in bones:
        bone.location = (0, 0, 0)
        bone.rotation_quaternion = (1, 0, 0, 0)
    update()


def place(name, rotation, head=None):
    """Sets a bone's world rotation (and head, for the root) and refreshes the pose."""
    bone = bones[name]
    matrix = rotation.to_4x4()
    matrix.translation = head if head is not None else bone.matrix.translation
    bone.matrix = matrix
    update()


def world_rotation(name):
    return bones[name].matrix.to_3x3().normalized()


def head(name):
    return bones[name].matrix.translation.copy()


def turn(name, axis, degrees):
    place(name, Matrix.Rotation(math.radians(degrees), 3, axis) @ world_rotation(name))


def swing(name, direction):
    """Turns a bone so it points along a direction, with as little twist as possible."""
    current = world_rotation(name)
    place(name, current.col[1].rotation_difference(direction).to_matrix() @ current)


def aim(name, direction, local_axis, world_axis):
    """Points a bone along a direction with one of its own axes turned as close as possible to world_axis."""
    y = direction.normalized()
    a = (world_axis - y * world_axis.dot(y)).normalized()
    world = Matrix((y, a, y.cross(a))).transposed()
    local = Matrix((Vector((0, 1, 0)), local_axis, Vector((0, 1, 0)).cross(local_axis))).transposed()
    place(name, world @ local.transposed())


def bend(start, end, first, second, pole):
    """Where the middle joint of a two-bone limb goes, bending towards pole. Returns (joint, gap)."""
    span = end - start
    distance = span.length
    gap = max(0.0, distance - (first + second - 1e-4))
    distance = min(distance, first + second - 1e-4)
    along = span.normalized()
    side = pole - along * pole.dot(along)
    side = side.normalized() if side.length > 1e-6 else along.orthogonal().normalized()
    cosine = (first * first + distance * distance - second * second) / (2 * first * distance)
    cosine = max(-1.0, min(1.0, cosine))
    return start + along * first * cosine + side * first * math.sqrt(1 - cosine * cosine), gap


def segment(upper, lower, tip):
    rest = rig.data.bones
    return (rest[lower].head_local - rest[upper].head_local).length, (rest[tip].head_local - rest[lower].head_local).length


# ---------------------------------------------------------------- body


class Torso:
    """The upper body's frame after the hips and spine are placed: where landmarks and poles are measured from."""

    def __init__(self):
        turned = world_rotation("Spine2") @ REST["Spine2"].transposed()
        self.origin = head("Spine2")
        self.left = turned @ Vector((1, 0, 0))
        self.forward = turned @ Vector((0, -1, 0))
        self.up = turned @ Vector((0, 0, 1))

    def point(self, offset, side=1):
        s, f, u = offset
        return self.origin + self.left * s * side + self.forward * f + self.up * u

    def direction(self, offset, side=1):
        return (self.point(offset, side) - self.origin).normalized()


def pose_trunk(key):
    reset_pose()
    lean = Matrix.Rotation(math.radians(key.get("lean", 0)), 3, "X")
    yaw = Matrix.Rotation(math.radians(key.get("yaw", 0)), 3, "Z")
    roll = Matrix.Rotation(math.radians(key.get("roll", 0)), 3, "Z")
    pelvis = yaw @ lean @ roll
    place("Hips", pelvis @ REST["Hips"], Vector(key.get("pelvis", (0, 0, 0))))
    left = pelvis @ Vector((1, 0, 0))
    forward = pelvis @ Vector((0, -1, 0))
    for name in ("Spine", "Spine1", "Spine2"):
        turn(name, left, key.get("spine", 0) / 3)
        if "side_bend" in key:
            turn(name, forward, key["side_bend"] / 3)
    if "axial_twist" in key:
        for name in ("Spine1", "Spine2"):
            turn(name, Torso().up, key["axial_twist"] / 2)
    if "torso_twist" in key:
        turn("Spine", Vector((0, 0, 1)), key["torso_twist"])
    for name in ("Neck", "Head"):
        turn(name, left, key.get("head", 0) / 2)
    if "neck_retraction" in key:
        neck = head("Neck") - pelvis @ Vector((0, -key["neck_retraction"], 0))
        place("Neck", world_rotation("Neck"), neck)
    return pelvis


def vertical_arm_reach(lateral, forward, slack=.0003):
    upper, fore = segment("LeftArm", "LeftForeArm", "LeftHand")
    hand, palm = GRIP["Left"]
    # Project the two arm segments into the sagittal plane. The grip lies
    # along the hand and a little way out from its palm. Keep the IK hinge
    # just off full extension, where its bending plane would be singular.
    reach = math.sqrt((upper + fore - slack) ** 2 - lateral ** 2) + hand
    return math.sqrt(reach ** 2 + palm ** 2 - forward ** 2)


def suspend_from_bar(centre, width, shoulder_y, pelvis_rotation, overhead=False, lift=0):
    """Set trunk height from the bar and the length of a hanging, nearly straight arm."""
    shoulder = (head("LeftArm") + head("RightArm")) / 2
    lateral = width - (head("LeftArm").x - shoulder.x)
    height = vertical_arm_reach(lateral, shoulder_y - centre[1])
    target = Vector((centre[0], shoulder_y, centre[2] + (lift - height if overhead else height)))
    place("Hips", pelvis_rotation @ REST["Hips"], head("Hips") + target - shoulder)


def ankles(spec, key):
    stance = {**spec.get("stance", {}), **key.get("stance", {})}
    width, y, toe_out = stance.get("width", 0.3), stance.get("y", 0.0), stance.get("toe_out", 10)
    height = next((e["height"] for e in spec.get("equipment", []) if e["type"] == "platform"), 0)
    height += next((e["footplate"][1] for e in spec.get("equipment", []) if "footplate" in e), 0)
    return {side: (Vector((sign * width / 2, y, FLOOR_ANKLE + height)), sign * toe_out)
            for side, sign in SIDES.items()}


def pose_side_support(spec, pelvis, torso, gaps):
    """Stack the feet and support the body on the lower forearm."""
    down = pelvis @ Vector((0, 0, -1))
    for side in SIDES:
        direction = down if side == "Left" else (down + torso.left * .153).normalized()
        free_leg = side == "Left" and spec.get("bench_foot")
        if free_leg:
            direction = (down + torso.left * .115 + torso.forward * .52).normalized()
        swing(side + "UpLeg", direction)
        foot = pelvis
        if free_leg:
            direction = (down + torso.left * .115 - torso.forward * .16).normalized()
            foot = Matrix.Rotation(-.20, 3, "Z") @ pelvis
        swing(side + "Leg", direction)
        for bone in ("Foot", "ToeBase"):
            place(side + bone, foot @ REST[side + bone])
    along, palm = Vector((1, 0, 0)), Vector((0, 0, -1))
    wrist = Vector(spec["wrist"])
    target = wrist + along * GRIP["Left"][0] + palm * GRIP["Left"][1]
    gap = pose_arm("Left", target, Vector((-.9, 0, -1)), "pronated", torso, contact_frame=(along, palm))
    gaps.append(("support wrist", gap))
    along = -torso.up
    palm = -Vector((0, 0, 1))
    palm = (palm - along * palm.dot(along)).normalized()
    wrist = head("RightUpLeg") + torso.forward * .035 - torso.left * .087 + torso.up * .08
    target = wrist + along * GRIP["Right"][0] + palm * GRIP["Right"][1]
    gap = pose_arm("Right", target, torso.direction([1, -.3, -.4], -1), "neutral", torso,
                   contact_frame=(along, palm))
    gaps.append(("upper hand", gap))


def pose_extended_legs(pelvis, abduction):
    down = pelvis @ Vector((0, 0, -1))
    forward = pelvis @ Vector((0, -1, 0))
    for side in SIDES:
        lift = Matrix.Rotation(-math.radians(abduction if side == "Right" else 0), 3, forward)
        for bone in ("UpLeg", "Leg"):
            swing(side + bone, lift @ down)
        for bone in ("Foot", "ToeBase"):
            place(side + bone, lift @ pelvis @ REST[side + bone])


def pose_legs(spec, key, pelvis, except_side=None, support=None):
    gaps = []
    # Knees point where the toes do: forward along the floor, whatever the hips are doing.
    # (The pelvis's own forward tips towards the floor in a deep hinge, and the knee would flip.)
    forward = Matrix.Rotation(math.radians(key.get("yaw", 0)), 3, "Z") @ Vector((0, -1, 0))
    for side, (ankle, yaw) in ankles(spec, key).items():
        if side == except_side:
            continue
        leg_pitch = key.get("supine_leg_" + side.lower(), key.get("free_leg_" + side.lower()))
        if leg_pitch is not None:
            thigh_pitch, knee_bend = leg_pitch
            prone = bool(spec.get("prone_support") or "swimming" in spec)
            shin_pitch = thigh_pitch + knee_bend if prone else thigh_pitch - knee_bend
            for bone, pitch in (("UpLeg", thigh_pitch), ("Leg", shin_pitch)):
                angle = math.radians(pitch)
                swing(side + bone, Vector((0, math.cos(angle) if prone else -math.cos(angle), math.sin(angle))))
            foot_pitch = 168 + shin_pitch if prone else -shin_pitch - 12
            foot = Matrix.Rotation(math.radians(foot_pitch), 3, "X")
            place(side + "Foot", foot @ REST[side + "Foot"])
            place(side + "ToeBase", foot @ REST[side + "ToeBase"])
            continue
        turned = Matrix.Rotation(math.radians(yaw), 3, "Z")
        pitch = Matrix.Identity(3)
        stride = key.get("foot_" + side.lower())
        if stride is not None:
            y, clearance, heel, *lateral = stride
            pitch = Matrix.Rotation(math.radians(heel), 3, "X")
            pivot = rig.data.bones[side + "Foot"].head_local - rig.data.bones[side + "ToeBase"].head_local
            if spec.get("heel_pivot"):
                pivot = Vector((0, -.046, FLOOR_ANKLE - .005))
            ankle += Vector((lateral[0] if lateral else 0, y, clearance)) + turned @ (pitch @ pivot - pivot)
        thigh, shin = segment(f"{side}UpLeg", f"{side}Leg", f"{side}Foot")
        hip = head(f"{side}UpLeg")
        knee_pole = key.get("knee_pole_" + side.lower(), spec.get("stance", {}).get("knee_direction", {}).get(side))
        pole = turned @ Vector(knee_pole) if knee_pole is not None else turned @ forward
        if support:
            ankle = support.point(ankle)
            pole = support.rotation @ pole
            turned = support.rotation @ turned
        knee, gap = bend(hip, ankle, thigh, shin, pole)
        swing(f"{side}UpLeg", knee - hip)
        swing(f"{side}Leg", ankle - head(f"{side}Leg"))
        place(f"{side}Foot", turned @ pitch @ REST[f"{side}Foot"])
        if stride is not None:
            toe_pitch = key.get("sled_toe_pitch", {}).get(side, heel if spec.get("heel_pivot") else None)
            toe_rotation = Matrix.Rotation(math.radians(toe_pitch), 3, "X") if toe_pitch is not None else Matrix.Identity(3)
            place(side + "ToeBase", turned @ toe_rotation @ REST[side + "ToeBase"])
        gaps.append((f"{side} ankle", gap))
    return gaps


def palm_axis(side):
    """The palm's facing direction in the hand bone's own axes."""
    return (REST[f"{side}Hand"].transposed() @ Vector(rig[f"palm_rest.{side}"])).normalized()


def palm_facing(grip, forearm, pole, torso, sign, bar):
    """Orient an overhand grip around the handle using its leftward axis."""
    across = (pole - forearm * pole.dot(forearm)).normalized()
    if grip == "thumb-forward":
        # Neutral dumbbells have a directed shaft: the thumb end turns with
        # elbow flexion. Its handedness stays constant through arm abduction.
        return -sign * bar.cross(forearm)
    if grip == "pronated":
        return bar.cross(forearm) * (1 if bar.dot(torso.left) >= 0 else -1)
    if grip == "supinated":
        return -bar.cross(forearm) * (1 if bar.dot(torso.left) >= 0 else -1)
    inward = -torso.left * sign
    sideways = forearm.cross(across)
    return sideways if sideways.dot(inward) > 0 else -sideways


FOREARM = {}  # each side's forearm direction in the frame before, where this frame's solving starts


def hand_on_bar(forearm, palm_wanted, bar):
    """How a hand sits on a bar: knuckles along the bar, so the bar runs straight through the fist.

    The hand points the forearm's way, bent at the wrist just enough to stand square to the bar,
    and its palm faces whichever way round the bar is nearer the palm the grip asks for.
    """
    along = (forearm - bar * forearm.dot(bar)).normalized()
    palm = bar.cross(along)
    return along, palm if palm.dot(palm_wanted) > 0 else -palm


def relax_unsupported_hand(side, wrist, ground_along, ground_palm, torso):
    """Ease into a neutral wrist as a support hand leaves the floor."""
    forearm = world_rotation(side + "ForeArm").col[1]
    approach = max(0, min(1, (.16 - wrist.z) / .135))
    bend = forearm.rotation_difference(ground_along)
    amount = min(approach, math.radians(39) / max(.001, bend.angle))
    along = Quaternion().slerp(bend, amount) @ forearm
    inward = -torso.left * SIDES[side]
    palm = inward.lerp(ground_palm, approach)
    palm = (palm - along * palm.dot(along)).normalized()
    aim(side + "Hand", along, palm_axis(side), palm)
    return 1 - approach


def relaxed_fingers(side, narrow=False):
    """Curl the distal skin slightly without moving the stitched wrist."""
    skin = bpy.data.objects["skin"]
    if skin.data.shape_keys is None:
        skin.shape_key_add(name="Basis")
    shape = skin.shape_key_add(name="Relaxed fingers." + side)
    marker = skin.vertex_groups["GripSurface." + side].index
    wrist = bones[side + "Hand"].bone.head_local
    along = REST[side + "Hand"].col[1]
    palm = REST[side + "Hand"] @ palm_axis(side)
    across = along.cross(palm).normalized()
    for vertex in skin.data.vertices:
        if not any(group.group == marker for group in vertex.groups):
            continue
        depth = max(0.0, (vertex.co - wrist).dot(along) - .069)
        bend = depth * min(1, depth / .07)
        shape.data[vertex.index].co += (palm * .50 - along * .18) * bend
        if narrow:
            spread = (vertex.co - wrist).dot(across)
            shape.data[vertex.index].co -= across * spread * min(.36, depth * 4.5)
    return shape


def pose_arm(side, grip_point, pole, grip, torso, bar=Vector((1, 0, 0)), contact_frame=None):
    sign = SIDES[side]
    upper, fore = segment(f"{side}Arm", f"{side}ForeArm", f"{side}Hand")
    shoulder = head(f"{side}Arm")
    forearm = FOREARM.get(side, (grip_point - shoulder).normalized())
    along, palm = contact_frame or hand_on_bar(forearm, palm_facing(grip, forearm, pole, torso, sign, bar), bar)
    # The wrist sits back from the grip along the hand, and the forearm's angle depends on where
    # the wrist is, so go round until they agree. There can be two answers (elbow in front or behind),
    # so start from the frame before: the arm then stays on one answer instead of flicking between them.
    for _ in range(200):
        wrist = grip_point - along * GRIP[side][0] - palm * GRIP[side][1]
        elbow, gap = bend(shoulder, wrist, upper, fore, pole)
        turned = (wrist - elbow).normalized()
        settled = (turned - forearm).length < 1e-5
        forearm = forearm.lerp(turned, 0.5).normalized()
        along, palm = contact_frame or hand_on_bar(forearm, palm_facing(grip, forearm, pole, torso, sign, bar), bar)
        if settled:
            break
    wrist = grip_point - along * GRIP[side][0] - palm * GRIP[side][1]
    elbow, gap = bend(shoulder, wrist, upper, fore, pole)
    FOREARM[side] = forearm.copy()
    # Orient the humerus to the flexion plane. Swing the proximal forearm about
    # that hinge; only the distal roll bone needs to match the grip's axial twist.
    arm_name, fore_name = f"{side}Arm", f"{side}ForeArm"
    upper_axis = (elbow - shoulder).normalized()
    fore_axis = (wrist - elbow).normalized()
    hinge = upper_axis.cross(fore_axis).normalized()
    rest_hinge = REST[arm_name].col[1].cross(REST[fore_name].col[1]).normalized()
    swing(f"{side}ArmSwing", upper_axis)
    aim(arm_name, upper_axis, REST[arm_name].transposed() @ rest_hinge, hinge)
    swing(fore_name, fore_axis)
    # A backwards reach can require over 100 degrees of roll to align the
    # modeled rest hinge. Carry only a comfortable part of that around the
    # humerus, with the same correction around the proximal forearm.
    swing_rotation = world_rotation(f"{side}ArmSwing")
    _, twist = (swing_rotation.transposed() @ world_rotation(arm_name)).to_quaternion().to_swing_twist("Y")
    excess = twist - max(-math.radians(35), min(math.radians(35), twist))
    if abs(excess) > 1e-6:
        lower = Matrix.Rotation(-excess, 3, fore_axis) @ world_rotation(fore_name)
        turn(arm_name, upper_axis, -math.degrees(excess))
        place(fore_name, lower)
    rest_palm = REST[f"{side}ForeArm"].transposed() @ Vector(rig[f"palm_rest.{side}"])
    rest_palm.y = 0
    aim(f"{side}ForeArmRoll", fore_axis, rest_palm.normalized(), palm)
    aim(f"{side}Hand", along, palm_axis(side), palm)
    return gap


# ---------------------------------------------------------------- equipment


def material(name, colour, metallic, roughness):
    made = bpy.data.materials.new(name)
    made.use_nodes = True
    shader = made.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = (*colour, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    return made


def cylinder(name, radius, depth, x, finish, parent):
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=radius, depth=depth, rotation=(0, math.pi / 2, 0), location=(x, 0, 0))
    part = bpy.context.object
    part.name = name
    part.data.materials.append(finish)
    bpy.ops.object.shade_smooth()
    part.parent = parent
    return part


def box(name, size, location, finish, parent=None, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    part = bpy.context.object
    part.name = name
    part.scale = size
    part.data.materials.append(finish)
    bpy.ops.object.transform_apply(scale=True)
    part.parent = parent
    return part


class Barbell:
    SHAFT = 0.014
    INNER = 0.65  # half the length of the bare shaft between the collars
    PLATE = 0.225

    def __init__(self, plate_radius=None):
        self.PLATE = plate_radius if plate_radius is not None else self.PLATE
        steel = material("steel", STEEL, 0.9, 0.3)
        iron = material("iron", IRON, 0.3, 0.55)
        self.root = bpy.data.objects.new("barbell", None)
        scene.collection.objects.link(self.root)
        cylinder("shaft", self.SHAFT, 2 * self.INNER, 0, steel, self.root)
        for sign in (1, -1):
            cylinder("collar", 0.03, 0.04, sign * (self.INNER + 0.02), steel, self.root)
            cylinder("sleeve", 0.025, 0.4, sign * (self.INNER + 0.24), steel, self.root)
            cylinder("plate", self.PLATE, 0.055, sign * (self.INNER + 0.08), iron, self.root)
        self.centre = Vector()

    def move(self, centre, frame):
        self.centre = centre
        self.root.location = centre
        self.root.keyframe_insert("location", frame=frame)

    def pose_open_hand(self, side, socket, pole, torso, surface, frame, problems):
        sign = SIDES[side]
        along = torso.direction(socket["along"], sign)
        palm = torso.direction(socket["palm"], sign)
        palm = (palm - along * palm.dot(along)).normalized()
        wrist = self.centre + torso.point(socket["wrist"], sign) - torso.origin
        target = wrist + along * GRIP[side][0] + palm * GRIP[side][1]
        gap = pose_arm(side, target, pole, "pronated", torso, contact_frame=(along, palm))
        transform = surface.transform
        posed = surface.points @ np.array(transform.to_3x3()).T + np.array(transform.translation)
        relative = posed - np.array(self.centre)
        axis = Vector((1, 0, 0))
        inverse = transform.inverted()
        distance = surface.shaft_distance(inverse @ self.centre, inverse.to_3x3() @ axis) - self.SHAFT
        outer = abs(relative[:, 0]).max()
        if outer > self.INNER:
            problems.add(frame, f"{side} hand reaches the bar collar", outer - self.INNER)
        surface.record_contact(distance)
        if distance < -.0002:
            problems.add(frame, f"{side} hand intersects the shaft", -distance)
        if distance > .0025:
            problems.add(frame, f"{side} hand loses shaft contact", distance)
        surface.check_wrist(frame, problems)
        return gap

    def intrusions(self, points, hand_mask):
        """Body points inside the shaft (hands excluded: they wrap it) or inside a plate."""
        rel = points - np.array(self.centre)
        radial = np.hypot(rel[:, 1], rel[:, 2])
        x = np.abs(rel[:, 0])
        in_shaft = (radial < self.SHAFT - 0.002) & (x < self.INNER) & ~hand_mask
        in_plate = (radial < self.PLATE) & (x > self.INNER + 0.05) & (x < self.INNER + 0.11)
        return int(in_shaft.sum()), int(in_plate.sum()), float((radial[~hand_mask & (x < self.INNER)] - self.SHAFT).min())


class BentBar(Barbell):
    """Rigid bars made from straight tube spans. Grip and contact use the rendered spans."""

    def __init__(self, kind, plate_radius=None):
        self.PLATE = plate_radius if plate_radius is not None else self.PLATE
        steel = material("steel", STEEL, .9, .3)
        iron = material("iron", IRON, .3, .55)
        self.root = bpy.data.objects.new(kind, None)
        scene.collection.objects.link(self.root)
        self.centre = Vector()
        self.spans, self.handles = [], {}

        def tube(a, b, radius, handle=None):
            start, end = Vector(a), Vector(b)
            direction = end - start
            part = cylinder("handle" if handle else "tube", radius, direction.length, 0, steel, self.root)
            part.location = (start + end) / 2
            part.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
            self.spans.append((np.array(start), np.array(direction.normalized()), direction.length, radius, handle))
            if handle:
                self.handles[handle] = part

        self.INNER = .46 if kind == "ez-bar" else .53
        for side, sign in SIDES.items():
            if kind == "ez-bar":
                points = [(0, -.035, 0), (sign*.12, -.035, 0), (sign*.34, .057, 0),
                          (sign*.40, 0, 0), (sign*self.INNER, 0, 0)]
                for i, (a, b) in enumerate(zip(points, points[1:])):
                    tube(a, b, self.SHAFT, side if i == 1 else None)
            else:
                points = [(0, -.34, 0), (sign*.37, -.19, 0), (sign*.37, .19, 0), (0, .34, 0)]
                for a, b in zip(points, points[1:]):
                    tube(a, b, .018)
                for y in [-.19, .19]:
                    tube((sign*.37,y,0), (sign*.278,y,0), .014)
                tube((sign*.278,.19,0), (sign*.278,-.19,0), self.SHAFT, side)
                tube((sign*.37,0,0), (sign*self.INNER,0,0), .021)
            cylinder("collar", .03, .04, sign*(self.INNER+.02), steel, self.root)
            cylinder("sleeve", .025, .24, sign*(self.INNER+.16), steel, self.root)
            cylinder("plate", self.PLATE, .055, sign*(self.INNER+.08), iron, self.root)

    def grip(self, side):
        part = self.handles[side]
        axis = part.rotation_euler.to_matrix().col[2].normalized()
        if axis.x < -.01:
            axis.negate()
        return self.centre + part.location, axis

    def intrusions(self, points, hand_mask):
        rel = points - np.array(self.centre)
        inside, closest = 0, math.inf
        for start, axis, length, radius, handle in self.spans:
            offset = rel[~hand_mask] - start if handle else rel - start
            distance = np.clip(offset @ axis, 0, length)
            gap = np.linalg.norm(offset - np.outer(distance, axis), axis=1) - radius
            inside += int((gap < -.002).sum())
            closest = min(closest, float(gap.min()))
        plate = (np.hypot(rel[:,1], rel[:,2]) < self.PLATE) & (np.abs(np.abs(rel[:,0])-self.INNER-.08) < .0275)
        return inside, int(plate.sum()), closest


class Landmine:
    """A floor pivot carrying a rigid shaft, a loaded sleeve and a grip attachment."""
    SHAFT = .014

    def __init__(self, config):
        self.pivot = Vector(config["pivot"])
        self.root = bpy.data.objects.new("landmine pivot", None)
        scene.collection.objects.link(self.root)
        self.root.location = self.pivot
        self.root.rotation_mode = "QUATERNION"
        steel = material("landmine steel", STEEL, .85, .34)
        iron = material("anchor iron", IRON, .45, .5)
        x, y, z = self.pivot
        self.anchor = []
        def fixed_part(name, size, centre):
            box(name, size, centre, iron)
            self.anchor.append((np.array(centre), np.array(size) / 2))

        fixed_part("anchor base", (.32, .33, .035), (x, y, .0175))
        for sign in (-1, 1):
            fixed_part("pivot cheek", (.025, .11, z), (x + sign*.055, y, z/2))
        self.parts = []
        self.handles = {}

        def tube(name, centre, axis, radius, length, finish):
            part = cylinder(name, radius, length, 0, finish, self.root)
            part.location = centre
            part.rotation_euler = Vector(axis).to_track_quat("Z", "Y").to_euler()
            self.parts.append((part, radius, length/2))
            return part

        along = (0, 1, 0)
        across = (1, 0, 0)
        tube("pivot socket", (0,.085,0), along, .042, .17, iron)
        tube("shaft", (0,.84,0), along, self.SHAFT, 1.68, steel)
        tube("sleeve", (0,1.70,0), along, .025, .24, steel)
        tube("weight plate", (0,1.69,0), along, .135, .045, iron)
        style = config["attachment"]
        if style == "parallel":
            row_axis = (0, math.cos(math.radians(12)), math.sin(math.radians(12)))
            tube("row crosspiece", (0,1.48,.027), across, .02, .31, iron)
            for side, sign in SIDES.items():
                self.handles[side] = tube("row grip", (-sign*.145,1.54,.04), row_axis, self.SHAFT,.18,steel)
        elif style == "end":
            side = config["side"]
            self.handles[side] = tube("end grip", (0,1.91,0), along, self.SHAFT,.18,steel)
        elif style == "cross":
            tube("end adapter", (0,1.86,0), along, .022,.10,iron)
            for side in config.get("sides", SIDES):
                self.handles[side] = tube("press grip", (SIDES[side]*.085,1.91,0), across,self.SHAFT,.17,steel)
        else:
            raise ValueError(f"Unknown landmine attachment {style}")

    def pose(self, span, frame):
        pitch, yaw = map(math.radians, span.sample("landmine_angles"))
        self.root.rotation_quaternion = (Matrix.Rotation(yaw,3,"Z") @ Matrix.Rotation(pitch,3,"X") @
                                         Matrix.Rotation(math.radians(span.sample("landmine_roll", 0)),3,"Y")).to_quaternion()
        self.root.keyframe_insert("rotation_quaternion", frame=frame)
        update()

    def check(self, points, frame, problems, samples, grips=None):
        hand_points = {}
        for side, surface in (grips or {}).items():
            transform = surface.transform
            hand_points[side] = surface.points @ np.array(transform.to_3x3()).T + np.array(transform.translation)
        for centre, half_size in self.anchor:
            depth = np.max(np.abs(points-centre)-half_size, axis=1).min()
            if depth < -.002:
                problems.add(frame, "landmine anchor intersects the body", -depth)
        if (self.root.matrix_world.translation-self.pivot).length > .001:
            problems.add(frame, "landmine shaft leaves pivot", (self.root.matrix_world.translation-self.pivot).length)
        for part, radius, half in self.parts:
            inverse = part.matrix_world.inverted()
            tested = [points]
            for side, skin in hand_points.items():
                if part != self.handles.get(side):
                    tested.append(skin)
            local = np.vstack(tested) @ np.array(inverse.to_3x3()).T + np.array(inverse.translation)
            radial = np.linalg.norm(local[:,:2],axis=1) - radius
            axial = np.abs(local[:,2])-half
            depth = np.maximum(radial,axial).min()
            if depth < -.002:
                problems.add(frame, part.name+" intersects the body", -depth)
            corners = np.array([part.matrix_world @ Vector(v) for v in part.bound_box])
            samples.append(corners)
            axis_z = part.matrix_world.to_3x3().col[2].z
            low = part.matrix_world.translation.z - abs(axis_z)*half - math.sqrt(max(0,1-axis_z**2))*radius
            if low < -.002:
                problems.add(frame, part.name+" crosses the floor",-low)


class Dumbbells:
    """A dumbbell in each hand, with independently oriented shafts and collision volumes."""

    HANDLE = Barbell.SHAFT  # the fists' grip cavity is sized for the barbell's shaft
    INNER = 0.065  # half the handle's length between the heads
    HEAD, DEPTH = 0.062, 0.06

    def __init__(self, sides=SIDES):
        steel = material("steel", STEEL, 0.9, 0.3)
        iron = material("iron", IRON, 0.3, 0.55)
        self.roots, self.centres, self.axes = {}, {}, {}
        for side in sides:
            root = bpy.data.objects.new(f"dumbbell.{side}", None)
            root.rotation_mode = "QUATERNION"
            scene.collection.objects.link(root)
            cylinder("handle", self.HANDLE, 2 * self.INNER, 0, steel, root)
            for sign in (1, -1):
                cylinder("head", self.HEAD, self.DEPTH, sign * (self.INNER + self.DEPTH / 2), iron, root)
            self.roots[side] = root

    def move(self, side, centre, axis, frame):
        root = self.roots[side]
        self.centres[side], self.axes[side] = centre, axis
        root.location = centre
        root.rotation_quaternion = Vector((1, 0, 0)).rotation_difference(axis)
        root.keyframe_insert("location", frame=frame)
        root.keyframe_insert("rotation_quaternion", frame=frame)

    def intrusions(self, points):
        """Body points inside a handle or a head, and the body's closest approach to either dumbbell."""
        inside, closest = 0, math.inf
        for side, centre in self.centres.items():
            axis = np.array(self.axes[side])
            rel = points - np.array(centre)
            along = np.abs(rel @ axis)
            radial = np.linalg.norm(rel - np.outer(rel @ axis, axis), axis=1)
            in_handle = (radial < self.HANDLE - 0.002) & (along < self.INNER)
            in_head = (radial < self.HEAD) & (along > self.INNER) & (along < self.INNER + self.DEPTH)
            inside += int(in_handle.sum() + in_head.sum())
            outside = np.where(along < self.INNER + self.DEPTH, radial - self.HEAD, np.hypot(np.maximum(radial - self.HEAD, 0), along - self.INNER - self.DEPTH))
            closest = min(closest, float(outside.min()))
        return inside, closest

    def corners(self):
        return [c + self.axes[side] * s * (self.INNER + self.DEPTH) + Vector((0, 0, z)) for side,c in self.centres.items() for s in (-1, 1) for z in (-self.HEAD, self.HEAD)]


class Kettlebells(Dumbbells):
    """Straight-grip kettlebells with a flared bail and rotation around the handle."""

    INNER, RADIUS, DROP = .072, .079, .163

    def __init__(self, sides=SIDES, shared=False):
        self.shared = shared
        if shared:
            self.INNER = .128
            sides = ("Left",)
        iron = material("cast iron", IRON, .35, .48)
        self.roots, self.centres, self.axes = {}, {}, {}
        self.legs = []
        for side in sides:
            root = bpy.data.objects.new("kettlebell." + side, None)
            root.rotation_mode = "QUATERNION"
            scene.collection.objects.link(root)
            cylinder("bell grip", self.HANDLE, self.INNER * 2, 0, iron, root)
            for sign in (-1, 1):
                a = Vector((sign*self.INNER, 0, 0))
                b = Vector((sign*.045, 0, -.112))
                delta = b - a
                part = cylinder("bell bail", self.HANDLE, delta.length, 0, iron, root)
                part.location = (a + b) / 2
                part.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
                if side == next(iter(sides)):
                    self.legs.append((np.array(a), np.array(delta.normalized()), delta.length))
            bpy.ops.mesh.primitive_uv_sphere_add(radius=self.RADIUS, location=(0, 0, -self.DROP))
            globe = bpy.context.object
            globe.name = "bell body"
            globe.parent = root
            globe.data.materials.append(iron)
            bpy.ops.object.shade_smooth()
            self.roots[side] = root

        if shared:
            self.roots["Right"] = self.roots["Left"]

    def move(self, side, centre, axis, frame, roll=0):
        if abs(axis.z) > 1e-4:
            raise ValueError("A kettlebell requires a horizontal grip")
        super().move(side, centre, axis, frame)
        if roll:
            root = self.roots[side]
            rotation = Matrix.Rotation(math.radians(roll), 3, axis).to_quaternion()
            root.rotation_quaternion = rotation @ root.rotation_quaternion
            root.keyframe_insert("rotation_quaternion", frame=frame)

    def intrusions(self, points):
        inside, closest = 0, math.inf
        for side, centre in self.centres.items():
            local = (points - np.array(centre)) @ np.array(self.roots[side].rotation_quaternion.to_matrix())
            distances = [np.linalg.norm(local - [0, 0, -self.DROP], axis=1) - self.RADIUS]
            for a, axis, length in self.legs + [(np.array([-self.INNER,0,0]), np.array([1,0,0]), 2*self.INNER)]:
                rel = local - a
                t = np.clip(rel @ axis, 0, length)
                distances.append(np.linalg.norm(rel - np.outer(t, axis), axis=1) - self.HANDLE)
            gap = np.minimum.reduce(distances)
            inside += int((gap < -.002).sum())
            closest = min(closest, float(gap.min()))
        return inside, closest

    def corners(self):
        return [centre + self.roots[side].rotation_quaternion @ Vector((x, y, z))
                for side, centre in self.centres.items()
                for x in (-max(.09, self.INNER + self.HANDLE), max(.09, self.INNER + self.HANDLE))
                for y in (-self.RADIUS,self.RADIUS)
                for z in (-self.DROP-self.RADIUS,self.HANDLE)]


def set_segment(part, start, end, frame):
    """Pose a unit cylinder along the segment between two world anchors."""
    delta = end - start
    if delta.length < .001:
        raise ValueError("Equipment segment has coincident anchors")
    part.location = (start + end) / 2
    part.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
    part.scale.z = delta.length
    for channel in ("location", "rotation_euler", "scale"):
        part.keyframe_insert(channel, frame=frame)


class CableStation:
    """A fixed column with a selectable cable exit and a moving attachment."""

    HEIGHTS = {"low": .18, "mid": 1.21, "high": 1.92}
    GRIP_HALF = {"d-handle": .068, "rope": .069, "straight-bar": .32, "v-bar": .078}
    RADIUS = .004
    LINE_LABEL = "cable line"
    TRAVEL = (.10, 3.05)

    def __init__(self, config):
        self.attachment = config["attachment"]
        self.half = self.GRIP_HALF[self.attachment]
        dual = self.attachment == "d-handle"
        self.stations = {}
        self.handles = {}
        self.lines = []
        self.straps = []
        self.rope_stops = {}
        self.bounds = []
        self.steel = material("cable hardware", STEEL, .8, .33)
        self.rubber = material("cable and rope", (.072, .078, .085), .24, .62)
        frame_finish = material("cable frame", (.085, .095, .11), .65, .43)
        self.footplate = config.get("footplate")
        if self.footplate:
            y, top = self.footplate
            box("row foot platform", (.51, .36, top), (0, y, top / 2), frame_finish)
            box("row foot stop", (.51, .035, .055), (0, y - .161, top + .0275), self.steel)
        columns = config["columns"]
        if not columns or not set(columns) <= (set(SIDES) if dual else {"Both"}):
            raise ValueError("D-handles need side-specific columns; other attachments need one Both column")
        ski = config.get("ski_frame", False)
        if ski:
            _, y = columns["Left"]["at"]
            box("ski erg platform", (.64, .48, .045), (0, y, .0225), frame_finish)
            box("ski erg mast", (.11, .15, 1.92), (0, y, .96), frame_finish)
            box("ski erg pulley crossbeam", (.62, .14, .10), (0, y, 1.92), frame_finish)
            fan = cylinder("ski erg fan housing", .207, .144, 0, frame_finish, None)
            fan.location = (0, y, .57)
        for key, column in columns.items():
            x, y = column["at"]
            facing = Vector((*column.get("exit", [0, 1]), 0)).normalized()
            if not facing.length:
                raise ValueError("Pulley exit direction must be nonzero")
            anchor = self.mount(column, x, y, facing, ski, frame_finish)
            grip_sides = (key,) if dual else SIDES
            for side in grip_sides:
                self.handles[side] = self.part("attachment grip", Barbell.SHAFT, self.steel)
                if config.get("end_stops"):
                    self.rope_stops[side] = self.part("rope end stop", .025, self.rubber)
            count = {"straight-bar": 1, "rope": 2, "v-bar": 2, "d-handle": 3}[self.attachment]
            links = [self.part("attachment link", .012 if self.attachment == "rope" else .008, self.rubber if self.attachment == "rope" else self.steel) for _ in range(count)]
            self.stations[key] = (anchor, self.make_line(), links)
        if self.attachment == "straight-bar":
            bpy.data.objects.remove(self.handles["Right"], do_unlink=True)
            self.handles["Right"] = self.handles["Left"]

    def mount(self, column, x, y, facing, ski, frame_finish):
        height = self.HEIGHTS[column["height"]]
        origin = Vector((x, y, height))
        anchor = origin + facing * .15
        if not ski:
            box("cable column", (.16, .18, 2.06), (x, y, 1.03), frame_finish)
            box("cable base", (.43, .38, .045), (x, y, .0225), frame_finish)
        box("pulley carriage", (.19, .19, .13), origin + facing * .065, frame_finish)
        pulley = cylinder("pulley wheel", .047, .036, 0, self.steel, None)
        pulley.location = anchor - facing * .038
        axle = facing.cross(Vector((0, 0, 1)))
        pulley.rotation_euler = axle.to_track_quat("Z", "Y").to_euler()
        stack_at = Vector((x, y, 0)) - facing * .19
        for plate in range(0 if ski else 10):
            box("stack plate", (.27, .16, .025), stack_at + Vector((0, 0, .105 + .033 * plate)), frame_finish)
        for side in (-1, 1):
            self.bounds.append(Vector((x + side * .22, y, 0)))
            self.bounds.append(Vector((x + side * .09, y, 2.06)))
        return anchor

    def make_line(self):
        return self.part("taut cable", self.RADIUS, self.rubber)

    def pose_line(self, cable, anchor, eye, frame, problems):
        length = (eye - anchor).length
        minimum, maximum = self.TRAVEL
        if not minimum <= length <= maximum:
            problems.add(frame, "cable outside its travel", max(minimum - length, length - maximum))
        if length >= .001:
            set_segment(cable, anchor, eye, frame)

    @staticmethod
    def part(name, radius, finish):
        part = cylinder(name, radius, 1, 0, finish, None)
        part.rotation_mode = "XYZ"
        return part

    def pose(self, span, torso, grips, frame, gaps, problems):
        targets, axes = {}, {}
        self.lines.clear()
        self.straps.clear()
        straight = self.attachment == "straight-bar"
        for side, sign in SIDES.items():
            if side not in self.handles:
                pole = torso.direction(span.sample("free_arm", [.27, .02, -1]), sign)
                gap = pose_arm(side, head(side + "Arm") + pole * .51, pole, "neutral", torso)
                gaps.append((side + " hand", gap))
                continue
            grip = span.keys[1].get("grip", "neutral")
            if "cable_target" in span.keys[1]:
                target = Vector(span.sample("cable_target"))
                target.x *= sign
                pole = torso.direction(span.sample("elbows", [.25, -.1, -1]), sign)
                axis = torso.direction(span.sample("handle_direction", [1, 0, 0]), sign)
                if straight:
                    axis = Vector((1, 0, 0))
                hand_frame = None
            else:
                arms = {field: span.sample(field) for field in ("upper_arm", "curl", "flex_toward")}
                neutral_axis, rough_target = held_point(side, arms, torso)
                pole = torso.direction(arms["upper_arm"], sign)
                upper, fore = segment(side + "Arm", side + "ForeArm", side + "Hand")
                elbow = head(side + "Arm") + pole * upper
                lower = (rough_target - elbow).normalized()
                axis = neutral_axis if grip == "neutral" else Vector((1, 0, 0))
                along, palm = hand_on_bar(lower, palm_facing(grip, lower, pole, torso, sign, axis), axis)
                target = elbow + lower * fore + along * GRIP[side][0] + palm * GRIP[side][1]
                hand_frame = (along, palm)
            targets[side], axes[side] = target, axis.normalized()
            gap = pose_arm(side, target, pole, grip, torso, axis, hand_frame)
            gaps.append((side + " cable grip", gap))
            surface = grips[side]
            axial = surface.points @ np.array(surface.transform.to_3x3().transposed() @ axis)
            axial += (surface.transform.translation - target).dot(axis)
            if not straight and (excess := np.abs(axial).max() - self.half) > 0:
                problems.add(frame, side + " fist extends off its cable grip", excess)
            tucked(side, torso, problems, frame)
            if not straight:
                set_segment(self.handles[side], target - axes[side] * self.half, target + axes[side] * self.half, frame)
        for key, (anchor, cable, links) in self.stations.items():
            if key == "Both":
                middle = (targets["Left"] + targets["Right"]) / 2
            else:
                middle = targets[key]
            tension = anchor - middle
            direction = tension.normalized()
            eye = middle + direction * (.17 if self.attachment == "rope" else .105)
            if straight:
                set_segment(self.handles["Left"], middle - Vector((self.half, 0, 0)), middle + Vector((self.half, 0, 0)), frame)
                set_segment(links[0], eye, middle, frame)
                for side, surface in grips.items():
                    axial = surface.points @ np.array(surface.transform.to_3x3().row[0])
                    axial += surface.transform.translation.x - middle.x
                    if (excess := np.abs(axial).max() - self.half) > 0:
                        problems.add(frame, side + " fist extends off the straight cable bar", excess)
            elif key == "Both":
                if self.attachment == "v-bar":
                    eye = middle + Vector((0, -.12, .07))
                for link, side in zip(links, SIDES):
                    axis = axes[side]
                    direction_sign = 1 if axis.dot(eye - targets[side]) > 0 else -1
                    if side in self.rope_stops:
                        direction_sign = 1
                    endpoint = targets[side] + axis * self.half * direction_sign
                    set_segment(link, eye, endpoint, frame)
                    if side in self.rope_stops:
                        stop = targets[side] - axis * self.half * direction_sign
                        set_segment(self.rope_stops[side], stop, stop - axis * .014 * direction_sign, frame)
            else:
                axis = axes[key]
                # Construct a triangular D-handle in the plane of the grip and cable.
                outward = (direction - axis * axis.dot(direction)).normalized()
                if outward.length < .5:
                    outward = axis.orthogonal().normalized()
                eye = middle + outward * .105
                width = self.half
                if "upper_arm" in span.keys[1]:
                    outward = world_rotation(key + "Hand").col[1].normalized()
                    eye = middle + outward * .155
                    width = .095
                    set_segment(self.handles[key], middle - axis * width, middle + axis * width, frame)
                endpoints = [middle + axis * width * sign for sign in (-1, 1)]
                for link, endpoint in zip(links[:2], endpoints):
                    set_segment(link, endpoint, eye, frame)
                    if "upper_arm" in span.keys[1]:
                        self.straps.append((key, endpoint, eye))
                set_segment(links[2], eye, eye + (anchor - eye).normalized() * .025, frame)
                eye += (anchor - eye).normalized() * .025
            self.pose_line(cable, anchor, eye, frame, problems)
            self.lines.append((anchor, eye))

    def check_grips(self, grips, frame, problems):
        check_rendered_grips(self.handles, grips, frame, problems)
        for side, start, end in self.straps:
            surface = grips[side]
            to_skin = surface.transform.inverted()
            start, end = to_skin @ start, to_skin @ end
            delta = end - start
            hit, _, _, _ = surface.surface.ray_cast(start, delta.normalized(), delta.length)
            if hit is not None:
                problems.add(frame, side + " stirrup strap crosses the fist", .008)

    def check(self, points, faces, frame, problems, samples):
        if self.footplate:
            y, top = self.footplate
            for side, sign in SIDES.items():
                over = (points[:, 0] * sign > 0) & (np.abs(points[:, 0]) < .255)
                over &= np.abs(points[:, 1] - y) < .18
                sole = points[over, 2].min(initial=1)
                if abs(sole - top) > .012:
                    problems.add(frame, side + " foot loses the row platform", abs(sole - top))
        # Cast the centreline and its surrounding cable surface through the posed skin.
        skin = BVHTree.FromPolygons(points, faces, all_triangles=True)
        segments = [(a, b, self.RADIUS, self.LINE_LABEL) for a, b in self.lines]
        segments += [(a, b, .008, "stirrup strap") for _, a, b in self.straps]
        for anchor, eye, radius, label in segments:
            delta = eye - anchor
            if delta.length < .001:
                continue
            direction = delta.normalized()
            first = direction.orthogonal().normalized()
            second = direction.cross(first)
            for offset in (Vector(), first, -first, second, -second):
                hit, _, _, distance = skin.ray_cast(anchor + offset * radius, direction, delta.length)
                if hit is not None:
                    problems.add(frame, label + " crosses the body", delta.length - distance)
                    break
        samples.append(np.array(self.bounds + [eye for _, eye in self.lines]))


def check_rendered_grips(handles, grips, frame, problems):
    for side, part in handles.items():
        transform = part.matrix_world
        axis = transform.col[2].to_3d().normalized()
        centre = transform.translation
        surface = grips[side]
        surface.check(frame, centre, axis, Barbell.SHAFT, problems)
        along = surface.points @ np.array(surface.transform.to_3x3().transposed() @ axis)
        along += (surface.transform.translation - centre).dot(axis)
        excess = np.abs(along).max() - transform.col[2].to_3d().length / 2
        if excess > 0:
            problems.add(frame, side + " fist extends past the rendered grip", excess)


class BandStation(CableStation):
    """Fixed anchors and elastic webbing with no pulley or moving stack."""

    HEIGHTS = {**CableStation.HEIGHTS, "floor": .085}
    RADIUS = .018
    LINE_LABEL = "resistance band"

    def __init__(self, config):
        self.rest_length = config["rest_length"]
        if not math.isfinite(self.rest_length) or self.rest_length <= 0:
            raise ValueError("Band rest length must be positive")
        self.parts = []
        self.elastic = material("amber resistance band", (.60, .205, .035), .03, .47)
        super().__init__(config)

    def mount(self, column, x, y, facing, ski, finish):
        height = self.HEIGHTS[column["height"]]
        origin = Vector((x, y, height))
        anchor = origin + facing * .12
        base = box("band anchor base", (.50, .54, .055), (x, y, .0275), finish)
        post = box("band anchor post", (.10, .10, height + .052),
                   (x, y, (height + .052) / 2), finish)
        stud = self.part("fixed band anchor pin", .024, self.steel)
        set_segment(stud, origin, anchor, 1)
        self.parts.extend(((base, False), (post, False), (stud, False)))
        self.bounds.extend(part.matrix_world @ Vector(v) for part in (base, post, stud) for v in part.bound_box)
        return anchor

    def make_line(self):
        return box("elastic resistance band", (.035, .005, 1), (0, 0, 0), self.elastic)

    def pose_line(self, band, anchor, eye, frame, problems):
        length = (eye - anchor).length
        ratio = length / self.rest_length
        if ratio < 1.05:
            problems.add(frame, "resistance band loses tension", 1.05 * self.rest_length - length)
        if ratio > 2.5:
            problems.add(frame, "resistance band exceeds its stretch range", length - 2.5 * self.rest_length)
        if length >= .001:
            set_segment(band, anchor, eye, frame)
            # Preserve volume as the strip extends. Both cross-section axes shrink.
            band.scale.x = band.scale.y = 1 / math.sqrt(max(1, ratio))
            band.keyframe_insert("scale", frame=frame)

    def check(self, points, faces, frame, problems, samples):
        super().check(points, faces, frame, problems, samples)
        check_hardware_clearance(self.parts, points, faces, np.zeros(len(points), dtype=bool), {}, frame, problems)


class ThighBand:
    """A closed elastic loop fitted around both thigh cross sections."""

    COUNT = 24

    def __init__(self, config):
        self.rest_length = config["rest_length"]
        angles = np.arange(self.COUNT) * math.tau / self.COUNT
        self.normals = np.column_stack((np.cos(angles), np.sin(angles)))
        self.corners = np.linalg.inv(np.stack((self.normals, np.roll(self.normals, -1, axis=0)), axis=1))
        faces = []
        for k in range(self.COUNT):
            n = (k + 1) % self.COUNT
            faces.append((k, n, n + self.COUNT, k + self.COUNT))
        mesh = bpy.data.meshes.new("thigh band webbing")
        mesh.from_pydata([(0, 0, 0)] * (2 * self.COUNT), [], faces)
        self.strip = bpy.data.objects.new("thigh band webbing", mesh)
        scene.collection.objects.link(self.strip)
        self.strip.data.materials.append(material("amber resistance band", (.60, .205, .035), .03, .47))
        thickness = self.strip.modifiers.new("rubber thickness", "SOLIDIFY")
        thickness.thickness = .002
        thickness.offset = 1
        self.strip.shape_key_add(name="Basis")

    def pose(self, points, contact, frame, problems, samples):
        hips = [head(side + "UpLeg") for side in SIDES]
        knees = [head(side + "Leg") for side in SIDES]
        axis = sum((knee - hip for hip, knee in zip(hips, knees)), Vector()).normalized()
        centre = sum((hip.lerp(knee, .72) for hip, knee in zip(hips, knees)), Vector()) / 2
        u = axis.orthogonal().normalized()
        v = axis.cross(u)
        basis = np.array([u, v]).T
        offsets = points - np.array(centre)
        height = offsets @ np.array(axis)
        contour = offsets @ basis
        supports = []
        for side in SIDES:
            thigh = np.unique(contact.vertices[contact.part == side + " thigh"])
            patch = contour[thigh[np.abs(height[thigh]) < .035]]
            if not len(patch):
                problems.add(frame, side + " thigh band loses contact", .035)
                return
            supports.append((patch @ self.normals.T).max(axis=0))
        outer = np.maximum(*supports)
        if any((outer - side).min() > .009 for side in supports):
            problems.add(frame, "thigh band loses skin contact", .009)
        walls = np.stack((outer, np.roll(outer, -1)), axis=1) + .003
        ring = (self.corners @ walls[:, :, None])[:, :, 0]
        perimeter = np.linalg.norm(ring - np.roll(ring, -1, axis=0), axis=1).sum()
        ratio = perimeter / self.rest_length
        if not 1.05 <= ratio <= 2.5:
            problems.add(frame, "thigh band outside its stretch range",
                         max(1.05 * self.rest_length - perimeter, perimeter - 2.5 * self.rest_length))
        world = ring @ basis.T + np.array(centre)
        half_width = .025 / math.sqrt(max(1, ratio)) * np.array(axis)
        vertices = np.vstack((world - half_width, world + half_width))
        pose = self.strip.shape_key_add(name=f"Frame {frame}", from_mix=False)
        for vertex, point in zip(pose.data, vertices):
            vertex.co = point
        for at, value in ((frame - 1, 0), (frame, 1), (frame + 1, 0)):
            pose.value = value
            pose.keyframe_insert("value", frame=at)
        pose.value = 1
        samples.append(vertices)


def pose_clamshell(pelvis, opening):
    """Keep the lower thigh and both ankles still as the upper knee opens."""
    down = pelvis @ Vector((0, 0, -1))
    forward = pelvis @ Vector((0, -1, 0))
    upper = (.77 * down + .64 * forward).normalized()
    lower = (.82 * down - .57 * forward).normalized()
    swing("LeftUpLeg", upper)
    swing("LeftLeg", lower)
    hip = head("RightUpLeg")
    ankle = head("LeftFoot") + Vector((0, 0, .085))
    first, second = segment("RightUpLeg", "RightLeg", "RightFoot")
    pole = Matrix.Rotation(math.radians(opening), 3, down) @ forward
    knee, _ = bend(hip, ankle, first, second, pole)
    swing("RightUpLeg", (knee - hip).normalized())
    swing("RightLeg", (ankle - knee).normalized())
    for side in SIDES:
        for bone in ("Foot", "ToeBase"):
            place(side + bone, pelvis @ REST[side + bone])


class HandBand(BandStation):
    """Two grips pull an elastic strip apart without a fixed anchor."""

    def __init__(self, config):
        self.rest_length = config["rest_length"]
        if not math.isfinite(self.rest_length) or self.rest_length <= 0:
            raise ValueError("Band rest length must be positive")
        self.elastic = material("amber resistance band", (.60, .205, .035), .03, .47)
        self.strip = self.make_line()
        finish = material("band grips", (.07, .08, .09), .12, .56)
        self.handles = {side: self.part(side + " band grip", Barbell.SHAFT, finish) for side in SIDES}
        self.lines, self.straps, self.bounds, self.parts = [], [], [], []
        self.footplate = None

    def pose(self, span, torso, grips, frame, gaps, problems):
        ends = []
        axis = Vector((0, 0, 1))
        for side, sign in SIDES.items():
            target = Vector(span.sample("band_grip"))
            target.x *= sign
            pole = torso.direction(span.sample("elbows"), sign)
            gap = pose_arm(side, target, pole, "thumb-forward", torso, axis)
            gaps.append((side + " band grip", gap))
            end = target + axis * .079
            set_segment(self.handles[side], target - axis * .079, end, frame)
            ends.append(end)
        self.lines[:] = [tuple(ends)]
        self.pose_line(self.strip, *ends, frame, problems)


class PlyoBox:
    """A fixed box for a two-foot landing and controlled step down."""

    def __init__(self, config):
        x, y, top = config["at"]
        self.centre = Vector((x, y, top / 2))
        self.size = Vector((.61, .60, top))
        finish = material("plyo box", (.12, .14, .155), .05, .64)
        self.box = box("plyo box", self.size, self.centre, finish)
        tread = material("plyo box tread", (.19, .22, .24), .12, .60)
        box("plyo box top", (.606, .596, .008), (x, y, top - .004), tread)
        self.contacts = config["contacts"]

    def check(self, points, contact, phase, frame, problems, samples):
        local = points - np.array(self.centre)
        half = np.array(self.size) / 2
        inside = np.all(np.abs(local) < half - .006, axis=1)
        if inside.any():
            depth = (half - np.abs(local[inside])).min(axis=1).max()
            problems.add(frame, "the body crosses the jump box", depth)
        for side, regions in self.contacts.items():
            for start, end, level in regions:
                if not start <= phase <= end:
                    continue
                foot = local[contact.foot_vertices[side]]
                if level == "box":
                    over = np.all(np.abs(foot[:, :2]) < half[:2], axis=1)
                    gap = foot[over, 2].min(initial=1) - half[2]
                else:
                    gap = foot[:, 2].min() + half[2]
                if not -.006 <= gap <= .012:
                    problems.add(frame, side + " foot loses " + level + " contact", abs(gap))
        samples.append(np.array([self.box.matrix_world @ Vector(v) for v in self.box.bound_box]))


class AbWheel:
    """A ground-contact wheel with a fixed transverse axle and two grips."""

    def __init__(self, config):
        self.radius = config["radius"]
        self.knees = Vector(config["knees"])
        axis = Vector((1, 0, 0))
        self.root = bpy.data.objects.new("ab wheel axle", None)
        scene.collection.objects.link(self.root)
        metal = material("ab wheel axle steel", STEEL, .65, .41)
        rubber = material("ab wheel rubber", (.06, .075, .086), .06, .8)
        rim = material("ab wheel rim", (.19, .21, .24), .5, .46)
        self.wheel = cylinder("ab wheel tyre", self.radius, .093, 0, rubber, self.root)
        for side, sign in SIDES.items():
            hub = cylinder("ab wheel hub", self.radius * .6, .014, sign * .048, rim, self.root)
            hub.rotation_euler = (0, math.pi / 2, 0)
        self.wheel.rotation_euler = (0, math.pi / 2, 0)
        self.handles = {side: CableStation.part(side + " ab wheel grip", Barbell.SHAFT, rubber) for side in SIDES}
        self.axis = axis

    def support(self, span, pelvis):
        thigh = Matrix.Rotation(math.radians(span.sample("thigh_lean")), 3, "X") @ Vector((0, 0, -1))
        for side in SIDES:
            swing(side + "UpLeg", thigh)
        midpoint = (head("LeftLeg") + head("RightLeg")) / 2
        place("Hips", pelvis @ REST["Hips"], head("Hips") + self.knees - midpoint)
        for side in SIDES:
            swing(side + "Leg", Vector((0, 1, 0)))
            foot = Matrix.Rotation(math.radians(164), 3, "X")
            for bone in ("Foot", "ToeBase"):
                place(side + bone, foot @ REST[side + bone])

    def pose(self, span, torso, frame, gaps):
        y = span.sample("wheel_y")
        self.root.location = (0, y, self.radius)
        self.root.keyframe_insert("location", frame=frame)
        # The tread rolls through the same distance that the axle translates.
        self.root.rotation_euler.x = -y / self.radius
        self.root.keyframe_insert("rotation_euler", frame=frame)
        for side, sign in SIDES.items():
            centre = Vector((sign * .17, y, self.radius))
            set_segment(self.handles[side], centre - self.axis * .12, centre + self.axis * .12, frame)
            elbow = torso.direction(span.sample("elbows"), sign)
            gaps.append((side + " ab wheel grip",
                         pose_arm(side, centre, elbow, "pronated", torso, self.axis)))

    def check(self, points, contact, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance([(self.wheel, False), *((part, True) for part in self.handles.values())],
                                 points, contact.faces, hands, grips, frame, problems)
        for side in SIDES:
            knee = np.array(head(side + "Leg"))
            patch = points[np.linalg.norm(points - knee, axis=1) < .10]
            height = patch[:, 2].min(initial=1)
            if not -.008 <= height <= .014:
                problems.add(frame, side + " knee loses rollout support", abs(height))
        samples.append(np.array([self.wheel.matrix_world @ Vector(v) for v in self.wheel.bound_box]))


def check_hardware_clearance(parts, points, faces, hands, grips, frame, problems):
    """Check fixed and moving mesh parts against posed skin, including actual fists."""
    skin = BVHTree.FromPolygons(points, faces, all_triangles=True)
    skin_min, skin_max = points.min(axis=0), points.max(axis=0)
    outside_hands = BVHTree.FromPolygons(
        points, [face for face in faces if not any(hands[index] for index in face)],
        all_triangles=True,
    )
    fist_surfaces = []
    for grip in grips.values():
        transform = grip.transform
        posed = grip.points @ np.array(transform.to_3x3()).T + np.array(transform.translation)
        fist_surfaces.append(BVHTree.FromPolygons(posed, grip.triangles, all_triangles=True))
    for part, held in parts:
        vertices = [part.matrix_world @ vertex.co for vertex in part.data.vertices]
        positions = np.array(vertices)
        if np.any(positions.max(axis=0) < skin_min) or np.any(positions.min(axis=0) > skin_max):
            continue
        centre = positions.mean(axis=0)
        part.data.calc_loop_triangles()
        polygons = [tuple(triangle.vertices) for triangle in part.data.loop_triangles]
        hardware = BVHTree.FromPolygons(vertices, polygons, all_triangles=True)
        surfaces = (outside_hands,) if held else (skin, *fist_surfaces)
        for surface in surfaces:
            nearest, normal, _, _ = surface.find_nearest(centre)
            inside = (surface is skin and nearest is not None and
                      np.all((skin_min <= centre) & (centre <= skin_max)) and
                      (Vector(centre) - nearest).dot(normal) < 0)
            if surface.overlap(hardware) or inside:
                problems.add(frame, part.name.split(".")[0] + " crosses the body", .001)
                break


class SmithRails:
    """The bar's sleeves travel on two fixed vertical guides."""

    def __init__(self, config):
        self.y = config["y"]
        self.travel = config.get("travel", [.27, 1.95])
        self.width = .96
        steel = material("Smith guide steel", STEEL, .83, .34)
        frame = material("Smith frame", IRON, .55, .45)
        self.blocks = []
        self.fixed = []
        self.bounds = []
        for sign in (-1, 1):
            x = sign * self.width
            guide = cylinder("Smith guide rail", .018, 2.10, 0, steel, None)
            guide.rotation_euler = (0, 0, 0)
            guide.location = (x, self.y, 1.12)
            base = box("Smith base", (.15, .70, .06), (x, self.y + .04, .03), frame)
            upright = box("Smith upright", (.095, .085, 2.17), (x, self.y + .16, 1.085), frame)
            bracket = box("Smith upper bracket", (.14, .22, .065), (x, self.y + .06, 2.12), frame)
            self.fixed.extend((guide, base, upright, bracket))
            block = box("Smith sleeve carriage", (.087, .091, .103), (0, 0, 0), frame)
            block.location = (x, self.y, 1)
            self.blocks.append(block)
            self.bounds.extend((Vector((x, self.y, 2.2)), Vector((x, self.y, 0))))

    def move(self, bar, frame, problems):
        centre = bar.centre
        minimum, maximum = self.travel
        if abs(centre.y - self.y) > .001:
            problems.add(frame, "Smith bar leaves its guides", abs(centre.y - self.y))
        if not minimum <= centre.z <= maximum:
            problems.add(frame, "Smith bar outside guide travel",
                         max(minimum-centre.z, centre.z-maximum))
        for block in self.blocks:
            block.location.z = centre.z
            block.keyframe_insert("location", frame=frame)

    def check(self, points, faces, hands, frame, problems, samples):
        check_hardware_clearance([(part, False) for part in (*self.fixed, *self.blocks)],
                           points, faces, hands, {}, frame, problems)
        samples.append(np.array(self.bounds))


class LegSled:
    """A foot plate follows inclined rails while the legs reach to its face."""

    def __init__(self, config):
        self.origin = Vector(config["origin"])
        self.travel = config["travel"]
        self.side = config.get("side")
        self.pitch = config.get("pitch", -47)
        self.rotation = Matrix.Rotation(math.radians(self.pitch), 3, "X")
        self.direction = Vector((0, -1, 1)).normalized()
        metal = material("leg sled frame", IRON, .6, .43)
        grip = material("leg sled foot plate", (.11, .12, .14), .55, .48)
        self.plate = box("leg sled foot plate", (.59, .38, .045), (0, 0, 0), grip)
        self.plate.rotation_euler = self.rotation.to_euler()
        self.carriage = box("leg sled carriage", (1.05, .20, .10), (0, 0, 0), metal)
        self.carriage.rotation_euler = self.rotation.to_euler()
        self.parts = [(self.carriage, False)]
        self.rails = []
        for sign in (-1, 1):
            start = self.origin + Vector((sign * .51, .09, -.13))
            end = start + self.direction * (self.travel[1] + .24)
            rail = CableStation.part("leg sled rail", .024, metal)
            set_segment(rail, start, end, 1)
            self.rails.extend((start, end))
            post = box("leg sled upright", (.09, .12, end.z), (end.x, end.y, end.z / 2), metal)
            foot = box("leg sled foot", (.17, .34, .04), (end.x, end.y, .02), metal)
            self.parts.extend((part, False) for part in (rail, post, foot))

    def pose(self, spec, span, key, frame, problems):
        distance = span.sample("sled")
        lo, hi = self.travel
        if not lo <= distance <= hi:
            problems.add(frame, "foot plate travels beyond the rails", max(lo-distance, distance-hi))
        self.face = self.origin + self.direction * distance
        self.plate.location = self.face - self.rotation @ Vector((0, 0, .0225))
        self.carriage.location = self.face - self.rotation @ Vector((0, 0, .155))
        for part in (self.plate, self.carriage):
            part.keyframe_insert("location", frame=frame)
        key["sled_toe_pitch"] = {side: self.pitch for side in ((self.side,) if self.side else SIDES)}
        for side, (ankle, yaw) in ankles(spec, key).items():
            if self.side and self.side != side:
                continue
            foot = rig.data.bones[side + "Foot"].head_local
            toe = rig.data.bones[side + "ToeBase"].head_local
            turned = Matrix.Rotation(math.radians(yaw), 3, "Z")
            pivot = foot - toe
            heel = span.sample("plate_heel", 0)
            angle = self.pitch + heel
            rotation = Matrix.Rotation(math.radians(angle), 3, "X")
            correction = turned @ (rotation @ pivot - pivot)
            target = self.face + Vector((ankle.x, 0, 0)) + self.rotation @ Vector((0, .057, FLOOR_ANKLE))
            if heel:
                target += turned @ (rotation @ pivot - self.rotation @ pivot)
                target += self.rotation @ Vector((0, 0, .00045 * heel))
            stride = target - ankle - correction
            key["foot_" + side.lower()] = [stride.y, stride.z, angle, stride.x]

    def check(self, points, faces, hands, frame, problems, samples):
        check_hardware_clearance(self.parts, points, faces, hands, {}, frame, problems)
        local = (points - np.array(self.face)) @ np.array(self.rotation)
        on_plate = (np.abs(local[:, 0]) < .295) & (np.abs(local[:, 1]) < .19)
        if local[on_plate, 2].min(initial=1) < -.010:
            problems.add(frame, "foot plate crosses the body", -local[on_plate, 2].min())
        for side, sign in SIDES.items():
            if self.side and self.side != side:
                continue
            sole = local[on_plate & (sign * local[:, 0] > 0), 2].min(initial=1)
            if abs(sole) > .014:
                problems.add(frame, side + " foot loses foot plate contact", abs(sole))
        samples.append(np.array(self.rails + [self.face]))


class SupportPad:
    """A padded contact face with a local normal pointing toward the supported skin."""

    def __init__(self, name, config, finish, frame_finish):
        self.name = name
        self.face = Vector(config["face"])
        self.rotation = Matrix.Rotation(math.radians(config.get("pitch", 0)), 3, "X")
        self.width, self.length = config["size"]
        self.split = config.get("split", False)
        centre = self.face - self.rotation @ Vector((0, 0, .04))
        box(name, (self.width, self.length, .08), centre, finish, rotation=self.rotation.to_euler())
        self.mounts = []
        x, y, z = self.face
        if config.get("mount") == "seat":
            self.mounts.append(box(name + " post", (.055, .06, z - .19),
                                   (x, y + .054, (z - .19) / 2), frame_finish))
        if config.get("mount") == "hold-down":
            outer = .43
            width = outer - self.width / 2
            for sign in (-1, 1):
                self.mounts.append(box(name + " bracket", (width + .03, .042, .036),
                                       (sign * (outer - width / 2), y, z + .043), frame_finish))
                self.mounts.append(box(name + " post", (.042, .06, z + .06),
                                       (sign * outer, y, (z + .06) / 2), frame_finish))
        if config.get("mount") == "bench":
            height = z - .06
            self.mounts.append(box(name + " support", (.095, .09, height),
                                   (x, y, height / 2), frame_finish))

    def check(self, points, frame, problems):
        local = (points - np.array(self.face)) @ np.array(self.rotation)
        over = (np.abs(local[:, 0]) < self.width / 2) & (np.abs(local[:, 1]) < self.length / 2)
        for sign in (-1, 1) if self.split else (0,):
            patch = over & (np.abs(local[:, 2]) < .09)
            if sign:
                patch &= local[:, 0] * sign > .045
            gap = local[patch, 2].min(initial=1)
            if gap < -.006:
                problems.add(frame, self.name + " penetrates the skin", -gap)
            if gap > .012:
                problems.add(frame, self.name + " loses skin contact", gap)


class CalfStation:
    """A forefoot step and a guided load borne through two padded faces."""

    def __init__(self, config):
        self.step_y, self.step_z = config["footplate"]
        self.seated = config.get("seated", False)
        self.pad_x, self.pad_y, self.pad_z = config["pad_at"]
        self.travel = config["travel"]
        self.fixed_grip = Vector(config["fixed_grip"]) if "fixed_grip" in config else None
        self.half = .094 if self.seated else .060
        self.pad_length = .132 if self.seated else .146
        metal = material("calf machine frame", IRON, .55, .45)
        fabric = material("calf machine upholstery", PAD, .05, .68)
        box("calf forefoot step", (.55, .16, self.step_z),
                        (0, self.step_y, self.step_z / 2), metal)
        self.pads, self.beams, self.parts = {}, {}, []
        self.handles, self.handle_links = {}, {}
        post_height = .85 if self.seated else 1.78
        base_length, base_y = .55, self.step_y + .13
        if self.fixed_grip:
            post_height = self.pad_z + self.travel[1] + .16
            rear = self.pad_y + .30
            base_length = rear - self.fixed_grip.y + .16
            base_y = (rear + self.fixed_grip.y) / 2
        for side, sign in SIDES.items():
            x = .53 * sign
            post = box("calf machine upright", (.065, .085, post_height),
                       (x, self.pad_y + .14, post_height / 2), metal)
            base = box("calf machine base", (.24 if self.fixed_grip else .18, base_length, .035),
                       (x, base_y, .0175), metal)
            beam = box("calf machine yoke", (.33, .06, .05), (0, 0, 0), metal)
            cushion = box("calf load pad", (self.half * 2, self.pad_length, .07),
                          (0, 0, 0), fabric)
            self.beams[side] = beam
            self.pads[side] = cushion
            self.parts.extend((part, False) for part in (post, base, beam))
            if config.get("handles") or self.fixed_grip:
                self.handles[side] = CableStation.part("calf grip", Barbell.SHAFT, metal)
                self.handle_links[side] = CableStation.part("calf grip support", .018, metal)
                self.parts.extend(((self.handles[side], True), (self.handle_links[side], False)))
        for i in range(9):
            weight = box("calf machine stack plate", (.24, .18, .025),
                         (.53, self.pad_y + .28, .06 + .032 * i), metal)
            self.parts.append((weight, False))
        self.bounds = [Vector((x, self.pad_y + .14, z))
                       for x in (-.58, .58) for z in (0, post_height)]

    def pose(self, span, torso, frame, gaps, problems):
        lift = span.sample("calf_lift")
        minimum, maximum = self.travel
        if not minimum <= lift <= maximum:
            problems.add(frame, "calf station outside its travel",
                         max(minimum - lift, lift - maximum))
        self.face_z = self.pad_z + lift
        for side, sign in SIDES.items():
            pad = self.pads[side]
            pad.location = (sign * self.pad_x, self.pad_y, self.face_z + .035)
            pad.keyframe_insert("location", frame=frame)
            beam = self.beams[side]
            beam.location = (sign * .386, self.pad_y + .055, self.face_z + .061)
            beam.keyframe_insert("location", frame=frame)
            if side in self.handles:
                axis = Vector((1, 0, 0))
                if self.fixed_grip:
                    target = Vector((sign * self.fixed_grip.x, self.fixed_grip.y, self.fixed_grip.z))
                    mount = Vector((sign * .44, target.y, .035))
                else:
                    target = Vector((sign * .283, self.pad_y - .24, self.face_z - .135))
                    mount = beam.location
                outer = target + axis * sign * .081
                set_segment(self.handles[side], target - axis * sign * .081, outer, frame)
                set_segment(self.handle_links[side], mount, outer, frame)
                pole = torso.direction([.48, .17, -1], sign)
                gap = pose_arm(side, target, pole, "pronated", torso, axis)
                gaps.append((side + " calf grip", gap))

    def check(self, points, faces, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, faces, hands, grips, frame, problems)
        for side, sign in SIDES.items():
            x = self.pad_x * sign
            under = (np.abs(points[:, 0] - x) < self.half) & (
                np.abs(points[:, 1] - self.pad_y) < self.pad_length / 2)
            near_face = np.abs(points[:, 2] - self.face_z) < .11
            depth = points[under & near_face, 2].max(initial=-1) - self.face_z
            if depth > .006:
                problems.add(frame, side + " calf load pad penetrates skin", depth)
            if depth < -.012:
                problems.add(frame, side + " calf load pad loses support", -depth)
            on_step = (points[:, 0] * sign > .045) & (np.abs(points[:, 0]) < .275)
            on_step &= np.abs(points[:, 1] - self.step_y) < .08
            forefoot = points[on_step, 2].min(initial=1)
            if abs(forefoot - self.step_z) > .012:
                problems.add(frame, side + " forefoot loses the calf step", abs(forefoot-self.step_z))
        samples.append(np.array(self.bounds))


class HipMachine:
    """A seat with a pair of yawing thigh pads and foot rests."""

    def __init__(self, config):
        self.contact_side = -1 if config["contact"] == "inner" else 1
        self.pad_gap = config["pad_offset"]
        self.travel = config["travel"]
        self.thigh_pitch = math.radians(config.get("thigh_pitch", 0))
        metal = material("hip station hardware", IRON, .55, .45)
        padding = material("hip station pads", PAD, .05, .63)
        self.back = SupportPad("hip machine backrest", config["backrest"], padding, metal)
        self.parts = [(mount, False) for mount in self.back.mounts]
        self.pads, self.rests, self.levers, self.posts, self.axes = {}, {}, {}, {}, {}
        self.rest_links, self.rest_drops = {}, {}
        self.handles = {}
        self.pad_faces, self.rest_faces = {}, {}
        for side, sign in SIDES.items():
            grip = self.handles[side] = CableStation.part("hip machine seat grip", Barbell.SHAFT, metal)
            target = self.grip_target(sign)
            axis = Vector((0, 1, 0))
            set_segment(grip, target - axis * .076, target + axis * .076, 1)
            mount = box("hip machine grip mount", (.05, .051, .105),
                        (target.x, target.y + .083, target.z - .041), metal)
            self.parts.extend(((grip, True), (mount, False)))
            self.pads[side] = box("hip machine thigh cushion", (.072, .15, .14), (0, 0, 0), padding)
            self.rests[side] = box("hip machine foot rest", (.15, .22, .025), (0, 0, 0), metal)
            self.levers[side] = CableStation.part("hip machine swing arm", .022, metal)
            self.posts[side] = CableStation.part("hip machine pad post", .019, metal)
            self.rest_links[side] = CableStation.part("hip machine foot rest support", .017, metal)
            self.rest_drops[side] = CableStation.part("hip machine foot rest drop", .017, metal)
            self.parts.extend((part, False) for part in
                              (self.levers[side], self.posts[side], self.rest_links[side], self.rest_drops[side]))
        height = .36
        base = box("hip machine floor frame", (.59, .58, .045), (0, .02, .0225), metal)
        column = box("hip machine bearing housing", (.25, .15, height), (0, .063, height / 2), metal)
        self.parts.extend(((base, False), (column, False)))

    @staticmethod
    def grip_target(sign):
        return Vector((sign * .315, .025, .559))

    def pose(self, span, torso, frame, gaps, problems):
        angle = span.sample("hip_angle")
        lo, hi = self.travel
        if not lo <= angle <= hi:
            problems.add(frame, "hip machine exceeds pivot travel", max(lo - angle, angle - hi), "degrees")
        for side, sign in SIDES.items():
            pole = torso.direction([.48, -.12, -1], sign)
            gap = pose_arm(side, self.grip_target(sign), pole, "thumb-forward", torso, Vector((0, 1, 0)))
            gaps.append((side + " hip machine seat grip", gap))
            yaw = Matrix.Rotation(math.radians(sign * angle), 3, "Z")
            forward = yaw @ Vector((0, -1, 0))
            outward = yaw @ Vector((sign, 0, 0))
            thigh = math.cos(self.thigh_pitch) * forward + Vector((0, 0, math.sin(self.thigh_pitch)))
            swing(side + "UpLeg", thigh)
            knee = head(side + "Leg")
            swing(side + "Leg", -.17 * forward + Vector((0, 0, -1)))
            place(side + "Foot", yaw @ REST[side + "Foot"])
            hip = head(side + "UpLeg")
            axle = Vector((hip.x, hip.y, .245))
            first = self.axes.setdefault(side, axle)
            if (first - axle).length > .002:
                problems.add(frame, "hip leaves the fixed machine axle", (first - axle).length)
            normal = -self.contact_side * outward
            face = knee - forward * .065 - normal * self.pad_gap + Vector((0, 0, .01))
            pad = self.pads[side]
            pad.location = face - normal * .036
            pad.rotation_euler = yaw.to_euler()
            foot = head(side + "Foot")
            rest_face = foot + forward * .067 - Vector((0, 0, FLOOR_ANKLE))
            rest = self.rests[side]
            rest.location = rest_face - Vector((0, 0, .0125))
            rest.rotation_euler = yaw.to_euler()
            for part in (pad, rest):
                for channel in ("location", "rotation_euler"):
                    part.keyframe_insert(channel, frame=frame)
            anchor = pad.location - normal * .015
            pivot_end = Vector((anchor.x, anchor.y, axle.z))
            set_segment(self.levers[side], axle, pivot_end, frame)
            set_segment(self.posts[side], pivot_end, anchor, frame)
            lower_joint = Vector((pivot_end.x, pivot_end.y, rest_face.z - .037))
            set_segment(self.rest_drops[side], pivot_end, lower_joint, frame)
            set_segment(self.rest_links[side], lower_joint, rest_face - Vector((0, 0, .024)), frame)
            self.pad_faces[side] = face, normal, forward
            self.rest_faces[side] = rest_face, outward, forward

    def check(self, points, faces, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, faces, hands, grips, frame, problems)
        self.back.check(points, frame, problems)
        for side in SIDES:
            face, normal, forward = self.pad_faces[side]
            delta = points - np.array(face)
            depth = delta @ np.array(normal)
            patch = (np.abs(delta[:, 2]) < .07) & (np.abs(delta @ np.array(forward)) < .075)
            patch &= np.abs(depth) < .065
            gap = depth[patch].min(initial=1)
            if gap > .008:
                problems.add(frame, side + " thigh loses hip machine pad", gap)
            if gap < -.006:
                problems.add(frame, side + " hip machine pad penetrates skin", -gap)
            face, outward, forward = self.rest_faces[side]
            delta = points - np.array(face)
            over = (np.abs(delta @ np.array(outward)) < .075) & (np.abs(delta @ np.array(forward)) < .11)
            sole = delta[over, 2].min(initial=1)
            if abs(sole) > .012:
                problems.add(frame, side + " foot loses hip machine rest", abs(sole))
        samples.append(np.array([part.matrix_world @ Vector(corner)
                                 for part in (*self.pads.values(), *self.rests.values()) for corner in part.bound_box]))


class GuidedSquat:
    """One padded carriage, mounted on either inclined rails or an overhead axle."""

    def __init__(self, config):
        self.start = Vector(config["at"])
        self.lean = config["lean"]
        self.travel = config["travel"]
        self.pivot = Vector(config["pivot"]) if "pivot" in config else None
        self.plate_y, self.plate_z = config["footplate"]
        self.back_y = config["back_y"]
        self.shoulder_z = config["shoulder_z"]
        self.parts, self.links, self.handles = [], {}, {}
        self.shoulders, self.bearings = {}, {}
        metal = material("squat machine frame", IRON, .55, .43)
        pad = material("squat machine pads", PAD, .05, .66)
        self.back = box("squat machine back pad", (.37, .08, .63), (0, 0, 0), pad)
        self.back_brace = CableStation.part("squat back brace", .026, metal)
        self.parts.append((self.back_brace, False))
        box("squat machine foot plate", (.64, .48, self.plate_z),
            (0, self.plate_y, self.plate_z / 2), metal)
        self.direction = Matrix.Rotation(math.radians(self.lean), 3, "X") @ Vector((0, 0, 1))
        self.width = .61
        self.bounds = []
        for side, sign in SIDES.items():
            x = self.width * sign
            base = box("squat machine foot", (.135, .84, .043),
                       (x, -.05, .0215), metal)
            self.parts.append((base, False))
            if self.pivot:
                pin = Vector((x, self.pivot.y, self.pivot.z))
                tower = box("squat pendulum upright", (.085, .09, pin.z), (x, pin.y, pin.z / 2), metal)
                bearing = cylinder("squat pendulum bearing", .048, .115, 0, metal, None)
                bearing.location = pin
                self.bearings[side] = pin
                self.parts.extend(((tower, False), (bearing, False)))
                self.bounds.append(pin)
            else:
                anchor = self.start + Vector((x, .19, .04))
                lower = anchor + self.direction * (min(self.travel) - .05)
                upper = anchor + self.direction * (max(self.travel) + .34)
                rail = CableStation.part("hack squat rail", .026, metal)
                set_segment(rail, lower, upper, 1)
                tower = box("hack rail support", (.077, .098, upper.z), (x, upper.y, upper.z / 2), metal)
                self.parts.extend(((rail, False), (tower, False)))
                self.bounds.extend((lower, upper))
            self.links[side] = [CableStation.part(name, radius, metal) for name, radius in (
                ("squat carriage arm", .028), ("squat shoulder bracket", .022),
                ("squat grip bracket", .018), ("squat pad support", .018))]
            self.handles[side] = CableStation.part("squat machine grip", Barbell.SHAFT, metal)
            self.shoulders[side] = box("squat shoulder pad", (.13, .17, .07), (0, 0, 0), pad)
            self.parts.extend((part, False) for part in self.links[side])
            self.parts.append((self.handles[side], True))

    def trunk(self, span, key, frame, problems):
        value = span.sample("carriage")
        minimum, maximum = self.travel
        if not minimum <= value <= maximum:
            problems.add(frame, "squat carriage outside travel",
                         max(minimum-value, value-maximum), "degrees" if self.pivot else "cm")
        if self.pivot:
            self.lean_now = self.lean + value
            rotation = Matrix.Rotation(math.radians(value), 3, "X")
            origin = self.pivot + rotation @ (self.start - self.pivot)
        else:
            self.lean_now = self.lean
            origin = self.start + self.direction * value
        self.origin = origin
        self.rotation = Matrix.Rotation(math.radians(self.lean_now), 3, "X")
        key.update(pelvis=origin, lean=self.lean_now)

    def pose(self, torso, frame, gaps):
        def mount(part, local):
            part.location = self.origin + self.rotation @ Vector(local)
            part.rotation_euler = self.rotation.to_euler()
            for channel in ("location", "rotation_euler"):
                part.keyframe_insert(channel, frame=frame)

        mount(self.back, (0, self.back_y + .04, .19))
        left = self.origin + self.rotation @ Vector((.31, self.back_y + .08, .35))
        set_segment(self.back_brace, left, left - Vector((.62, 0, 0)), frame)
        axis = Vector((1, 0, 0))
        for side, sign in SIDES.items():
            x = self.width * sign
            joint = self.origin + self.rotation @ Vector((x, self.back_y + .08, .35))
            outer = self.origin + self.rotation @ Vector((sign * .31, self.back_y + .08, .35))
            target = self.origin + self.rotation @ Vector((sign * .269, -.185, .302))
            leading = target + axis * sign * .075
            if self.pivot:
                set_segment(self.links[side][0], self.bearings[side], joint, frame)
            else:
                axle = self.origin + Vector((x, .19, .04))
                set_segment(self.links[side][0], axle, joint, frame)
            set_segment(self.links[side][1], joint, outer, frame)
            set_segment(self.links[side][2], outer, leading, frame)
            pad_mount = self.origin + self.rotation @ Vector((sign * .25, .015, self.shoulder_z + .06))
            set_segment(self.links[side][3], outer, pad_mount, frame)
            set_segment(self.handles[side], target - axis * sign * .075, leading, frame)
            mount(self.shoulders[side], (sign * .19, -.005, self.shoulder_z + .035))
            pole = torso.direction([.48, -.25, -1], sign)
            gap = pose_arm(side, target, pole, "pronated", torso, axis)
            gaps.append((side + " squat machine grip", gap))

    def check(self, points, faces, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, faces, hands, grips, frame, problems)
        local = (points - np.array(self.origin)) @ np.array(self.rotation)
        x, y, z = local.T
        back = (abs(x) < .185) & (abs(z - .19) < .315) & (abs(y - self.back_y) < .09)
        depth = y[back].max(initial=-1) - self.back_y
        if depth > .012 or depth < -.018:
            problems.add(frame, "back loses squat pad contact or penetrates it", abs(depth))
        for side, sign in SIDES.items():
            shoulder = (abs(sign * x - .19) < .065) & (abs(y + .005) < .085)
            shoulder &= abs(z - self.shoulder_z) < .08
            depth = z[shoulder].max(initial=-1) - self.shoulder_z
            if depth > .008 or depth < -.016:
                problems.add(frame, side + " shoulder pad contact", abs(depth))
            over = (sign * points[:, 0] > 0) & (abs(points[:, 0]) < .32)
            over &= abs(points[:, 1] - self.plate_y) < .24
            sole = points[over, 2].min(initial=1)
            if abs(sole - self.plate_z) > .012:
                problems.add(frame, side + " foot loses squat plate contact", abs(sole-self.plate_z))
        samples.append(np.array(self.bounds))


class AssistanceStation:
    """Fixed hand grips and a counterweighted platform that carries the knees."""

    def __init__(self, config):
        self.grip = Vector(config["grip"])
        self.axis = Vector(config["grip_axis"]).normalized()
        self.pad_y = config["pad_y"]
        self.travel = config["travel"]
        iron = material("assistance station frame", IRON, .62, .44)
        pad = material("assistance knee cushion", PAD, .05, .67)
        self.pad = box("assistance knee pad", (.51, .40, .085), (0, 0, 0), pad)
        self.carriage = box("assistance carriage", (.60, .13, .085), (0, 0, 0), iron)
        self.pad_mounts = [box("assistance platform bracket", (.035, .139, .145),
                               (0, 0, 0), iron) for _ in SIDES]
        self.parts = [(part, False) for part in (self.carriage, *self.pad_mounts)]
        self.handles = {}
        self.bounds = []
        for side, sign in SIDES.items():
            x = sign * .55
            column_z = self.grip.z + .11
            rail_y = self.pad_y + .27
            post = box("assistance frame upright", (.08, .10, column_z),
                       (x, rail_y, column_z / 2), iron)
            base = box("assistance frame foot", (.16, .85, .04), (x, self.pad_y, .02), iron)
            target = Vector((self.grip.x * sign, self.grip.y, self.grip.z))
            grip = CableStation.part("assistance grip", Barbell.SHAFT, iron)
            half = self.axis * .080
            set_segment(grip, target - half, target + half, 1)
            end = target + half * (sign if abs(self.axis.x) > .5 else -1)
            joint = Vector((x, end.y, end.z))
            outer = CableStation.part("assistance grip side bracket", .023, iron)
            end_link = CableStation.part("assistance grip end bracket", .021, iron)
            set_segment(outer, Vector((x, rail_y, end.z)), joint, 1)
            set_segment(end_link, joint, end, 1)
            self.parts.extend((part, False) for part in (outer, end_link, post, base))
            self.parts.append((grip, True))
            self.handles[side] = grip
            self.bounds.extend((Vector((x, rail_y, 0)), Vector((x, rail_y, column_z))))
        for i in range(9):
            plate = box("assistance counterweight", (.28, .18, .025),
                        (.55, self.pad_y + .43, .070 + i * .032), iron)
            self.parts.append((plate, False))

    def pose(self, span, torso, frame, gaps, problems):
        self.top = span.sample("assist_height")
        lo, hi = self.travel
        if not lo <= self.top <= hi:
            problems.add(frame, "assistance platform outside its stops", max(lo-self.top, self.top-hi))
        for part, y, z in ((self.pad, self.pad_y, self.top - .0425),
                           (self.carriage, self.pad_y + .25, self.top - .191)):
            part.location = (0, y, z)
            part.keyframe_insert("location", frame=frame)
        for mount, sign in zip(self.pad_mounts, SIDES.values()):
            mount.location = (sign * .248, self.pad_y + .202, self.top - .143)
            mount.keyframe_insert("location", frame=frame)
        thigh = torso.direction(span.sample("kneeling_thigh", [.16,.10,-1]))
        for side, sign in SIDES.items():
            outward = thigh.copy()
            outward.x *= sign
            swing(side + "UpLeg", outward)
            swing(side + "Leg", Vector((sign * .16, 1, .12)))
            foot = Matrix.Rotation(math.radians(sign * 11), 3, "Z") @ Matrix.Rotation(math.radians(68), 3, "X")
            place(side + "Foot", foot @ REST[side + "Foot"])
            target = Vector((self.grip.x * sign, self.grip.y, self.grip.z))
            pole = torso.direction(span.sample("elbows"), sign)
            gap = pose_arm(side, target, pole, span.keys[1].get("grip", "pronated"), torso, self.axis)
            gaps.append((side + " assisted station grip", gap))

    def check(self, points, faces, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, faces, hands, grips, frame, problems)
        for side, sign in SIDES.items():
            knee = head(side + "Leg")
            patch = (sign * points[:, 0] > 0) & (abs(points[:, 0]) < .255)
            patch &= (abs(points[:, 1] - self.pad_y) < .20) & (abs(points[:, 1] - knee.y) < .11)
            sole = points[patch, 2].min(initial=1)
            gap = sole - self.top
            if gap > .010 or gap < -.008:
                problems.add(frame, side + " knee platform contact", abs(gap))
        samples.append(np.array(self.bounds))


class RotatingTrunkStation:
    """A pelvis-height axle rotates a padded yoke with a seated torso."""

    def __init__(self, config):
        self.axle = Vector(config["axle"])
        self.front = config.get("support") == "chest"
        self.face_y = config["pad_y"]
        self.travel = config["travel"]
        metal = material("trunk machine frame", IRON, .56, .42)
        pad = material("trunk machine upholstery", PAD, .05, .67)
        self.pad = box("trunk machine pad", (.34, .074, .265), (0, 0, 0), pad)
        self.parts, self.handles, self.links = [], {}, {}
        self.brace = CableStation.part("trunk yoke cross brace", .022, metal)
        self.parts.append((self.brace, False))
        self.pad_mount = CableStation.part("trunk pad support", .024, metal)
        self.parts.append((self.pad_mount, False))
        for side, sign in SIDES.items():
            x = sign * .55
            foot = box("trunk machine foot", (.16, .62, .04), (x, .17, .02), metal)
            tower = box("trunk machine bearing support", (.10, .12, self.axle.z),
                        (x, self.axle.y, self.axle.z / 2), metal)
            bearing = cylinder("trunk machine bearing", .045, .115, 0, metal, None)
            bearing.location = (x, self.axle.y, self.axle.z)
            self.parts.extend((part, False) for part in (foot, tower, bearing))
            self.handles[side] = CableStation.part("trunk machine grip", Barbell.SHAFT, metal)
            self.parts.append((self.handles[side], True))
            self.links[side] = [CableStation.part(name, radius, metal) for name, radius in (
                ("trunk machine lever", .023), ("trunk machine grip arm", .018)) ]
            self.parts.extend((part, False) for part in self.links[side])

    def pose(self, span, torso, frame, gaps, problems):
        angle = span.sample("lean")
        lo, hi = self.travel
        if not lo <= angle <= hi:
            problems.add(frame, "trunk yoke exceeds its stops", max(lo-angle, angle-hi), "degrees")
        self.rotation = Matrix.Rotation(math.radians(angle), 3, "X")
        pad_sign = -1 if self.front else 1
        self.pad.location = self.axle + self.rotation @ Vector((0, self.face_y + .037 * pad_sign, .269))
        self.pad.rotation_euler = self.rotation.to_euler()
        for channel in ("location", "rotation_euler"):
            self.pad.keyframe_insert(channel, frame=frame)

        brace_y = self.face_y + (.16 if self.front else .075) * pad_sign
        ends = [self.axle + self.rotation @ Vector((sign * .55, brace_y, .269))
                for sign in (1, -1)]
        set_segment(self.brace, *ends, frame)
        mount = self.axle + self.rotation @ Vector((0, brace_y, .269))
        set_segment(self.pad_mount, self.pad.location, mount, frame)
        axis = Vector((1, 0, 0))
        for (side, sign), end in zip(SIDES.items(), ends):
            pivot = self.axle + Vector((sign * .55, 0, 0))
            goal = self.axle + self.rotation @ Vector((sign * .295, -.225, .248))
            outside = goal + axis * sign * .075
            set_segment(self.links[side][0], pivot, end, frame)
            set_segment(self.links[side][1], end, outside, frame)
            set_segment(self.handles[side], goal - axis * sign * .075, outside, frame)
            pole = torso.direction([.50, -.08, -1], sign)
            gap = pose_arm(side, goal, pole, "pronated", torso, axis)
            gaps.append((side + " trunk machine grip", gap))

    def check(self, points, contact, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, contact.faces, hands, grips, frame, problems)
        local = (points[contact.trunk_vertices] - np.array(self.axle)) @ np.array(self.rotation)
        x, y, z = local.T
        patch = (np.abs(x) < .17) & (np.abs(z - .269) < .1325)
        depth = ((y[patch] - self.face_y) * (-1 if self.front else 1)).max(initial=-1)
        if depth > .009:
            problems.add(frame, "trunk machine pad penetrates skin", depth)
        if depth < -.012:
            problems.add(frame, "torso loses trunk machine pad", -depth)
        samples.append(np.array([part.matrix_world @ Vector(corner)
                                 for part, _ in self.parts for corner in part.bound_box]))


class LateralRaiseStation:
    """Split outboard pads rotate with the elbows around shoulder-height axles."""

    def __init__(self, config):
        self.travel = config["travel"]
        self.pad_offset = config["pad_offset"]
        self.pads, self.handles, self.pivots, self.parts, self.links = {}, {}, {}, [], {}
        self.pad_faces = {}
        metal = material("lateral raise frame", IRON, .56, .44)
        foam = material("lateral raise upholstery", PAD, .05, .66)
        for side, sign in SIDES.items():
            support = box("lateral machine rear support", (.095,.13,1.05),
                          (sign*.20,.398,.525), metal)
            foot = box("lateral machine floor brace", (.16,.61,.039),
                       (sign*.27,.27,.0195), metal)
            self.parts.extend(((support,False),(foot,False)))
            self.pads[side] = box("lateral elbow cushion", (.07,.19,.112), (0,0,0), foam)
            self.handles[side] = CableStation.part("lateral machine grip", Barbell.SHAFT, metal)
            self.links[side] = [CableStation.part(name, radius, metal) for name, radius in (
                ("lateral machine swing arm", .022), ("lateral pad carrier", .021),
                ("lateral grip return", .017))]
            self.parts.extend((part, False) for part in self.links[side])
            self.parts.append((self.handles[side], True))

    def pose(self, span, torso, frame, gaps, problems):
        angle = span.sample("lever_angle")
        lo, hi = self.travel
        if not lo <= angle <= hi:
            problems.add(frame, "lateral machine exceeds its travel", max(lo-angle, angle-hi), "degrees")
        forward = Vector((0,-1,0))
        for side, sign in SIDES.items():
            shoulder = head(side + "Arm")
            pivot = self.pivots.setdefault(side, shoulder.copy())
            if (pivot - shoulder).length > .002:
                problems.add(frame, "shoulder leaves lateral machine axle", (pivot-shoulder).length)
            turn_out = Matrix.Rotation(math.radians(-sign * angle), 3, "Y")
            upper = turn_out @ Vector((0,0,-1))
            outward = turn_out @ Vector((sign,0,0))
            upper_length, fore = segment(side + "Arm", side + "ForeArm", side + "Hand")
            elbow = pivot + upper * upper_length
            palm = upper.cross(forward) * -sign
            target = elbow + forward * (fore + GRIP[side][0]) + palm * GRIP[side][1]
            gap = pose_arm(side, target, upper, "neutral", torso, upper, (forward,palm))
            gaps.append((side + " lateral machine grip", gap))
            face = elbow + outward * self.pad_offset + forward * .024
            pad = self.pads[side]
            pad.location = face + outward * .035
            pad.rotation_euler = turn_out.to_euler()
            for channel in ("location", "rotation_euler"):
                pad.keyframe_insert(channel, frame=frame)
            self.pad_faces[side] = face, outward, upper
            back = Vector((pivot.x,.395,pivot.z))
            outboard = elbow + outward * (self.pad_offset + .084)
            behind = Vector((outboard.x,back.y,outboard.z))
            set_segment(self.links[side][0], back, behind, frame)
            set_segment(self.links[side][1], behind, outboard, frame)
            end = target + upper * .069
            set_segment(self.links[side][2], outboard, end, frame)
            set_segment(self.handles[side], target - upper * .069, end, frame)

    def check(self, points, faces, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, faces, hands, grips, frame, problems)
        for side, (face, outward, upper) in self.pad_faces.items():
            delta = points - np.array(face)
            patch = (abs(delta[:, 1]) < .095) & (abs(delta @ np.array(upper)) < .056)
            depth = (delta @ np.array(outward))[patch]
            gap = -depth[abs(depth) < .080].max(initial=-1)
            if gap > .009 or gap < -.006:
                problems.add(frame, side + " lateral elbow pad contact", abs(gap))
        samples.append(np.array([part.matrix_world @ Vector(corner)
                                 for part, _ in self.parts for corner in part.bound_box]))


def pose_swim_stroke(keys, phase, torso, gaps):
    """Alternate the arm path so each underwater pull has an overwater recovery."""
    for side, sign in SIDES.items():
        stroke = PoseSpan(keys, phase + (0 if side == "Left" else .5))
        shoulder = head(side + "Arm")
        wrist = shoulder + torso.point(stroke.sample("stroke"), sign) - torso.origin
        pole = torso.direction(stroke.sample("stroke_elbow"), sign)
        upper, forearm = segment(side + "Arm", side + "ForeArm", side + "Hand")
        elbow, _ = bend(shoulder, wrist, upper, forearm, pole)
        along = (wrist - elbow).normalized()
        down = torso.direction(stroke.sample("stroke_palm"), sign)
        palm = (down - along * down.dot(along)).normalized()
        target = wrist + along * GRIP[side][0] + palm * GRIP[side][1]
        gaps.append((side + " swimming reach",
                     pose_arm(side, target, pole, "pronated", torso, contact_frame=(along, palm))))


def swim_surface(height):
    """Frame the swimmer's waterline with a translucent pool lane."""
    water = material("pool water", (.040, .13, .19), .11, .26)
    water.surface_render_method = "BLENDED"
    water.node_tree.nodes.get("Principled BSDF").inputs["Alpha"].default_value = .18
    length, centre = 2.48, .046
    box("pool waterline", (1.64, length, .004), (0, centre, height), water)
    lane = material("pool lane markings", (.035, .095, .115), .10, .46)
    for sign in (-1, 1):
        line = box("pool lane edge", (.015, length, .006), (sign * .82, centre, height - .006), lane)
        yield np.array([line.matrix_world @ Vector(corner) for corner in line.bound_box])


def pose_gait(keys, phase, key, torso, gaps, contacts, height=0, incline=0):
    pitch = math.radians(incline)
    for side, sign in SIDES.items():
        stride = PoseSpan(keys, phase + (0 if side == "Left" else .5))
        y, lift, heel = stride.sample("gait")
        contacts[side] = lift < .002
        ankle_bone = rig.data.bones[side + "Foot"].head_local
        toe_bone = rig.data.bones[side + "ToeBase"].head_local
        ankle_height = height - (y - (ankle_bone.y - toe_bone.y)) * math.tan(pitch) + lift
        # The toe pivots on the inclined belt as the heel rises.
        key["foot_" + side.lower()] = [y, ankle_height, heel - incline]
        key.setdefault("sled_toe_pitch", {})[side] = -incline
        upper = stride.sample("arm_swing")
        curl = stride.sample("arm_bend")
        _, hand = held_point(side, {"upper_arm":upper,"curl":curl,"flex_toward":[0,1,0]}, torso)
        pole = torso.direction(upper, sign)
        upper_length, _ = segment(side + "Arm", side + "ForeArm", side + "Hand")
        elbow = head(side + "Arm") + pole * upper_length
        along = (hand - elbow).normalized()
        inward = -torso.left * sign
        palm = (inward - along * along.dot(inward)).normalized()
        hand += palm * GRIP[side][1]
        gap = pose_arm(side, hand, pole, "neutral", torso, contact_frame=(along,palm))
        gaps.append((side + " gait arm", gap))


def check_gait(spec, phase, points, contact, frame, problems, belt=None):
    left_ankle, right_ankle = (head(side + "Foot").y for side in SIDES)
    left_wrist, right_wrist = (head(side + "Hand").y for side in SIDES)
    ankle_lead = right_ankle - left_ankle
    wrist_lead = right_wrist - left_wrist
    # Compare the two sides so a forward lean cannot disguise an in-phase swing.
    if abs(ankle_lead) > .24 and math.copysign(1, ankle_lead) * wrist_lead > -.045:
        problems.add(frame, "gait arms and legs swing in phase", abs(wrist_lead + math.copysign(.045, ankle_lead)))
    if not spec.get("running_gait"):
        return
    sole = points if belt is None else (points - np.array(belt.face)) @ np.array(belt.rotation)
    if .415 <= phase % .5 <= .463:
        height = min(sole[indices, 2].min() for indices in contact.foot_vertices.values())
        if height < .018:
            problems.add(frame, "running gait loses its flight phase", .018 - height)
    for side in SIDES:
        local = (phase + (0 if side == "Left" else .5)) % 1
        shoulder, elbow, wrist = (head(side + bone) for bone in ("Arm", "ForeArm", "Hand"))
        flex = math.degrees((elbow - shoulder).angle(wrist - elbow))
        if not 73 <= flex <= 102:
            problems.add(frame, side + " running elbow flexion", max(73 - flex, flex - 102), "degrees")
        if .135 <= local <= .17:
            hip, knee, ankle = (head(side + bone) for bone in ("UpLeg", "Leg", "Foot"))
            flex = math.degrees((knee - hip).angle(ankle - knee))
            if not 19 <= flex <= 33:
                problems.add(frame, side + " running support knee flexion", max(19 - flex, flex - 33), "degrees")


class Treadmill:
    """An inclined deck and a phase-shifted repeating gait on the belt."""

    def __init__(self, config):
        self.pitch = config.get("incline", 0)
        self.rotation = Matrix.Rotation(math.radians(-self.pitch), 3, "X")
        self.height = config.get("height", .14)
        self.face = Vector((0, 0, self.height))
        metal = material("treadmill frame", IRON, .55, .49)
        rubber = material("treadmill belt", (.023,.027,.032), .08, .70)
        frame_mid = self.face - self.rotation @ Vector((0,0,.041))
        box("treadmill belt", (.65,1.61,.080), frame_mid, rubber,
            rotation=self.rotation.to_euler())
        self.parts = []
        for sign in (-1, 1):
            rail = box("treadmill deck rail", (.096,1.69,.095),
                       frame_mid + Vector((sign*.378,0,0)), metal, rotation=self.rotation.to_euler())
            post = box("treadmill console post", (.071,.078,1.10),
                       (sign*.40,-.81,.55), metal)
            self.parts.extend(((rail,False),(post,False)))
        console = box("treadmill console", (.82,.17,.085), (0,-.81,1.11), metal, rotation=(-.26,0,0))
        self.parts.append((console,False))
        self.bounds = [Vector((sign*.43,y,z)) for sign in (-1,1) for y,z in ((.81,self.height),(-.85,1.15))]
        self.contacts = {}
        self.rib_positions = []
        edge = material("treadmill belt seams", (.066,.075,.083), .1,.65)
        for index in range(12):
            part = box("treadmill belt seam", (.64,.008,.002), (0,0,0), edge)
            part.rotation_euler = self.rotation.to_euler()
            self.rib_positions.append((index,part))

    def pose(self, spec, keys, phase, key, torso, frame, gaps):
        for index, seam in self.rib_positions:
            travel = ((index / len(self.rib_positions) + phase * .75) % 1) * 1.56 - .78
            seam.location = self.face + self.rotation @ Vector((0,travel,.001))
            seam.keyframe_insert("location", frame=frame)
        pose_gait(keys, phase, key, torso, gaps, self.contacts, self.height, self.pitch)

    def check(self, points, faces, hands, frame, problems, samples):
        check_hardware_clearance(self.parts, points, faces, hands, {}, frame, problems)
        local = (points - np.array(self.face)) @ np.array(self.rotation)
        for side, sign in SIDES.items():
            over = (local[:,0] * sign > 0) & (abs(local[:,0]) < .325) & (abs(local[:,1]) < .803)
            sole = local[over, 2].min(initial=1)
            if sole < -.013:
                problems.add(frame, side + " foot goes through treadmill belt", -sole)
            if self.contacts[side] and sole > .017:
                problems.add(frame, side + " stance foot loses treadmill belt", sole)
        samples.append(np.array(self.bounds))


class CycleStation:
    """A crank drives the pedals and, on an air bike, the moving handles."""

    def __init__(self, config):
        self.crank = Vector(config["crank"])
        self.radius = config.get("radius", .137)
        self.saddle = Vector(config["saddle"])
        self.grip = Vector(config["grip"])
        self.air = config.get("air", False)
        self.seat_half = .14 if config.get("backrest") else .089
        self.seat_depth = .12
        metal = material("cycle frame", IRON, .60, .46)
        rubber = material("cycle upholstery", PAD, .05, .70)
        box("cycle saddle", (2*self.seat_half,2*self.seat_depth,.075), self.saddle - Vector((0,0,.0375)), rubber)
        self.parts, self.handles, self.pedals, self.rods, self.handle_braces = [], {}, {}, {}, {}
        self.pedal_axles = {}
        self.backrest = SupportPad("recumbent cycle backrest", config["backrest"], rubber, metal) if "backrest" in config else None
        if self.backrest:
            self.parts.extend((mount,False) for mount in self.backrest.mounts)
        support = box("cycle saddle post", (.095,.11,self.saddle.z),
                      (0,self.saddle.y,self.saddle.z / 2), metal)
        self.parts.append((support,False))
        for y in (self.crank.y-.26,self.saddle.y+.13):
            base = box("cycle ground stabilizer", (.71,.115,.055),(0,y,.0275),metal)
            self.parts.append((base,False))
        front = Vector((0, self.crank.y - .34, .31))
        if self.backrest:
            wheel = cylinder("cycle flywheel", .175, .16, 0, metal, None)
            wheel.location = (0, self.crank.y - .29, .245)
        elif self.air:
            wheel = cylinder("air bike fan housing", .268, .18, 0, metal, None)
            wheel.location = front
            self.fan_grille(front, metal)
        else:
            shell = material("spin bike belt cover", (.135, .148, .165), .45, .36)
            wheel = cylinder("enclosed spin bike flywheel", .199, .12, 0, shell, None)
            wheel.location = front
        self.parts.append((wheel, False))
        for name, start, end in (
            ("cycle frame spine", Vector((0,self.saddle.y,.18)), self.crank),
            ("cycle flywheel carrier", self.crank, wheel.location),
        ):
            member = CableStation.part(name,.035,metal)
            set_segment(member,start,end,1)
            self.parts.append((member,False))
        if not self.backrest:
            self.member("cycle front dropout", front, Vector((0, self.crank.y - .26, .046)), .036, metal)
        if self.air:
            self.arm_axle = Vector((0, front.y, .557))
            self.member("air bike pivot mast", front, self.arm_axle, .047, metal)
            self.member("air bike arm axle",
                        self.arm_axle - Vector((self.grip.x + .094, 0, 0)),
                        self.arm_axle + Vector((self.grip.x + .094, 0, 0)), .027, metal)
        elif not self.backrest:
            stem = Vector((0, self.grip.y, self.grip.z))
            self.member("spin bike handlebar stem", front, stem, .036, metal)
            reach = Vector((self.grip.x - .077, 0, 0))
            self.member("spin bike handlebar bridge", stem - reach, stem + reach, .018, metal)
        for side, sign in SIDES.items():
            self.pedals[side] = box("cycle pedal", (.126,.22,.031), (0,0,0), rubber)
            self.rods[side] = CableStation.part("cycle crank arm", .016, metal)
            self.pedal_axles[side] = CableStation.part("cycle pedal spindle", .011, metal)
            self.handles[side] = CableStation.part("cycle grip", Barbell.SHAFT, metal)
            self.parts.extend(((self.rods[side], False), (self.pedal_axles[side], False),
                               (self.handles[side], True)))
            if self.backrest or self.air:
                self.handle_braces[side] = CableStation.part("cycle grip support", .022, metal)
                self.parts.append((self.handle_braces[side], False))
            if self.air:
                hub = cylinder("air bike arm bearing", .045, .042, 0, metal, None)
                hub.location = self.arm_axle + Vector((sign * (self.grip.x + .088), 0, 0))
                self.parts.append((hub, False))
        self.pedal_faces = {}
        self.bounds = [Vector((sign*.37,y,z)) for sign in (-1,1)
                       for y,z in ((self.crank.y-.44,.0),(self.saddle.y+.19,self.saddle.z))]

    def member(self, name, start, end, radius, finish):
        member = CableStation.part(name, radius, finish)
        set_segment(member, start, end, 1)
        self.parts.append((member, False))

    def fan_grille(self, centre, finish):
        grille = material("air bike fan grille", (.25, .27, .31), .62, .38)
        for sign in (-1, 1):
            face = centre + Vector((sign * .093, 0, 0))
            hub = cylinder("air bike fan hub", .053, .018, 0, finish, None)
            hub.location = face
            self.parts.append((hub, False))
            for blade in range(8):
                angle = blade * math.tau / 8
                start = face + Vector((0, .048 * math.cos(angle), .048 * math.sin(angle)))
                end = face + Vector((0, .239 * math.cos(angle + .22), .239 * math.sin(angle + .22)))
                self.member("air bike radial grille", start, end, .009, grille)

    def pose(self, spec, span, phase, key, torso, frame, gaps):
        for side, (ankle, yaw) in ankles(spec, key).items():
            sign = SIDES[side]
            angle = (phase + (0 if side == "Left" else .50)) * math.tau
            pedal = self.crank + Vector((sign*.165, self.radius * math.cos(angle), self.radius * math.sin(angle)))
            self.pedal_faces[side] = pedal
            part = self.pedals[side]
            part.location = pedal - Vector((0,0,.0155))
            part.keyframe_insert("location", frame=frame)
            axle = Vector((sign*.076,self.crank.y,self.crank.z))
            outer_joint = pedal - Vector((0,0,.031))
            inner_joint = Vector((axle.x,outer_joint.y,outer_joint.z))
            set_segment(self.rods[side], axle, inner_joint, frame)
            set_segment(self.pedal_axles[side], inner_joint, outer_joint, frame)
            key["foot_" + side.lower()] = [
                pedal.y + .063 - ankle.y, pedal.z + FLOOR_ANKLE - ankle.z,0,pedal.x - ankle.x]
            target = Vector((sign * self.grip.x,self.grip.y,self.grip.z))
            if self.air:
                base = self.arm_axle + Vector((sign * (self.grip.x + .077), 0, 0))
                rotation = Matrix.Rotation(.229 * math.cos(angle), 3, "X")
                target = base + rotation @ (target - base)
            axis = Vector((1,0,0))
            inner = target - axis * sign * .077
            outer = target + axis * sign * .077
            set_segment(self.handles[side],inner,outer,frame)
            if self.air:
                set_segment(self.handle_braces[side], base, outer, frame)
            elif self.backrest:
                base = Vector((sign * .406, self.crank.y - .28, .34))
                set_segment(self.handle_braces[side], base, outer, frame)
            gap = pose_arm(side,target,torso.direction(span.sample("elbows"),sign),"pronated",torso,axis)
            gaps.append((side + " cycle grip",gap))

    def check(self, points, faces, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, faces, hands, grips, frame, problems)
        if self.backrest:
            self.backrest.check(points, frame, problems)
        local = points - np.array(self.saddle)
        over = (abs(local[:,0]) < self.seat_half) & (abs(local[:,1]) < self.seat_depth)
        gap = local[over & (abs(local[:,2]) < .10),2].min(initial=1)
        if gap > .016 or gap < -.014:
            problems.add(frame,"seat loses cycle saddle contact",abs(gap))
        for side, face in self.pedal_faces.items():
            rel = points - np.array(face)
            over = (abs(rel[:,0]) < .063) & (abs(rel[:,1]) < .11)
            gap = rel[over,2].min(initial=1)
            if abs(gap) > .011:
                problems.add(frame,side + " foot loses cycle pedal contact",abs(gap))
        samples.append(np.array(self.bounds))


class PullupBar:
    """A stationary grip between uprights. The trunk hangs from the grip height."""

    def __init__(self, config):
        self.centre = Vector(config["at"])
        self.grip_width = config["grip_width"]
        self.grip = config.get("grip", "pronated")
        self.feet_supported = config.get("feet_supported", False)
        finish = material("pull-up frame", (.08, .09, .105), .55, .43)
        shaft = CableStation.part("pull-up bar", Barbell.SHAFT, finish)
        spread = Vector((.69, 0, 0))
        mount = self.centre.copy()
        self.axis = Vector((1, 0, 0))
        if self.grip == "thumb-forward":
            self.axis = Vector((0, 1, 0))
            mount += Vector((0, -.23, .12))
            self.handles, self.parts = {}, [(shaft, False)]
            for side, sign in SIDES.items():
                grip = CableStation.part(side + " parallel grip", Barbell.SHAFT, finish)
                support = CableStation.part(side + " parallel grip mount", .018, finish)
                target = self.target(sign)
                nose = target - self.axis * .16
                set_segment(grip, nose, target + self.axis * .12, 1)
                set_segment(support, nose, mount + Vector((sign * self.grip_width, 0, 0)), 1)
                self.handles[side] = grip
                self.parts.extend(((grip, True), (support, False)))
        else:
            self.handles = dict.fromkeys(SIDES, shaft)
            self.parts = [(shaft, True)]
        set_segment(shaft, mount - spread, mount + spread, 1)
        for sign in (-1, 1):
            x = mount.x + sign * .69
            y, z = mount.y, mount.z
            post = box("pull-up upright", (.076, .078, z + .055), (x, y, (z + .055) / 2), finish)
            foot = box("pull-up base", (.116, .67, .05), (x, y + .08, .025), finish)
            self.parts.extend(((post, False), (foot, False)))

    def target(self, sign):
        return self.centre + Vector((sign * self.grip_width, 0, 0))

    def pose(self, span, torso, gaps):
        for side, sign in SIDES.items():
            target = self.target(sign)
            pole = torso.direction(span.sample("elbows", [.42, .47, -.14]), sign)
            gaps.append((side + " pull-up grip", pose_arm(side, target, pole, self.grip, torso, self.axis)))

    def check(self, points, contact, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, contact.faces, hands, grips, frame, problems)
        for side, vertices in contact.foot_vertices.items():
            height = points[vertices, 2].min()
            if self.feet_supported:
                if not -.006 <= height <= .012:
                    problems.add(frame, side + " loses floor support below the low bar", abs(height))
            elif height < .10:
                problems.add(frame, side + " foot below hanging clearance", .10 - height)
        samples.append(np.array([part.matrix_world @ Vector(v)
                                 for part, _ in self.parts for v in part.bound_box]))


class ParallelBars:
    """Fixed rails for bodyweight support above the hands."""

    def __init__(self, config):
        self.grip = Vector(config["grip"])
        self.axis = Vector((0, -1, 0))
        self.handles, self.parts = {}, []
        finish = material("dip frame", (.08, .09, .105), .55, .43)
        for side, sign in SIDES.items():
            grip = Vector((sign * self.grip.x, self.grip.y, self.grip.z))
            rail = CableStation.part(side + " dip rail", Barbell.SHAFT, finish)
            set_segment(rail, grip - self.axis * .32, grip + self.axis * .40, 1)
            self.handles[side] = rail
            self.parts.append((rail, True))
            for offset in (-.30, .38):
                x, y, z = grip + self.axis * offset
                post = box("dip upright", (.060, .065, z), (x, y, z / 2), finish)
                foot = box("dip base", (.48, .16, .05), (x, y, .025), finish)
                self.parts.extend(((post, False), (foot, False)))

    def pose(self, span, torso, gaps):
        for side, sign in SIDES.items():
            target = Vector((sign * self.grip.x, self.grip.y, self.grip.z))
            pole = torso.direction(span.sample("elbows"), sign)
            gaps.append((side + " dip grip", pose_arm(side, target, pole, "thumb-forward", torso, self.axis)))

    def check(self, points, faces, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, faces, hands, grips, frame, problems)
        samples.append(np.array([part.matrix_world @ Vector(v)
                                 for part, _ in self.parts for v in part.bound_box]))


class StandingCardio:
    """Shared grip and foot contact checks for standing cardio machines."""

    def __init__(self, config):
        self.grip = Vector(config["grip"])
        self.finish = material("cardio machine frame", (.09, .103, .12), .53, .45)
        self.tread = material("cardio machine tread", PAD, .06, .67)
        self.parts, self.handles = [], {}
        self.contacts = {}
        for side in SIDES:
            handle = CableStation.part("cardio machine handle", Barbell.SHAFT, self.finish)
            self.handles[side] = handle
            self.parts.append((handle, True))

    def member(self, name, radius):
        member = CableStation.part(name, radius, self.finish)
        self.parts.append((member, False))
        return member

    def grip_pose(self, side, target, torso, frame, gaps):
        axis = Vector((1, 0, 0))
        set_segment(self.handles[side], target - axis * .08, target + axis * .08, frame)
        pole = torso.direction([.44, -.15, -1], SIDES[side])
        gaps.append((side + " cardio machine grip", pose_arm(side, target, pole, "pronated", torso, axis)))

    def check(self, points, faces, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, faces, hands, grips, frame, problems)
        for side, (centre, width, length) in self.contacts.items():
            rel = points - np.array(centre)
            patch = (abs(rel[:, 0]) < width / 2) & (abs(rel[:, 1]) < length / 2)
            sole = rel[patch, 2].min(initial=1)
            if abs(sole) > .012:
                problems.add(frame, side + " foot loses cardio tread contact", abs(sole))
        samples.append(np.array([part.matrix_world @ Vector(v)
                                 for part, _ in self.parts for v in part.bound_box]))


class Elliptical(StandingCardio):
    """A front crank guides the foot platforms and reciprocating grips."""

    def __init__(self, config):
        super().__init__(config)
        self.pivot = Vector((0, -.60, .69))
        tower = box("elliptical mast", (.105, .14, .69), (0, -.60, .345), self.finish)
        flywheel = cylinder("elliptical flywheel cover", .205, .16, 0, self.finish, None)
        flywheel.location = (0, -.60, .27)
        base = box("elliptical frame beam", (.13, 1.30, .09), (0, -.15, .05), self.finish)
        self.parts.extend((part, False) for part in (tower, flywheel, base))
        for y in (-.69, .41):
            foot = box("elliptical stabilizer", (.61, .11, .077), (0, y, .0385), self.finish)
            self.parts.append((foot, False))
        self.platforms, self.rockers, self.drives, self.spindles = {}, {}, {}, {}
        for side, sign in SIDES.items():
            pedal = box("elliptical platform", (.137, .31, .036), (0, 0, 0), self.tread)
            self.platforms[side] = pedal
            self.rockers[side] = self.member("elliptical handle rocker", .021)
            self.drives[side] = self.member("elliptical pedal linkage", .025)
            self.spindles[side] = self.member("elliptical pedal spindle", .024)
            axle = self.member("elliptical rocker axle", .022)
            set_segment(axle, self.pivot, self.pivot + Vector((sign * (self.grip.x + .08), 0, 0)), 1)

    def pose(self, spec, keys, phase, key, torso, frame, gaps):
        for side, (ankle, _) in ankles(spec, key).items():
            sign = SIDES[side]
            angle = math.tau * (phase + (0 if sign > 0 else .5))
            pedal = Vector((sign * .155, -.024 - .239 * math.cos(angle), .211 + .074 * math.sin(angle)))
            self.platforms[side].location = pedal - Vector((0, 0, .018))
            self.platforms[side].keyframe_insert("location", frame=frame)
            self.contacts[side] = pedal, .137, .31
            key["foot_" + side.lower()] = [pedal.y + .061 - ankle.y, pedal.z, 0, pedal.x - ankle.x]
            pivot = self.pivot + Vector((sign * (self.grip.x + .08), 0, 0))
            handle = Vector((sign * self.grip.x, self.grip.y, self.grip.z))
            swing = Matrix.Rotation(-.15 * math.cos(angle), 3, "X")
            target = pivot + swing @ (handle - pivot)
            outer = target + Vector((sign * .08, 0, 0))
            set_segment(self.rockers[side], pivot, outer, frame)
            set_segment(self.drives[side], Vector((pedal.x, -.60, .088)), pedal - Vector((0, 0, .068)), frame)
            set_segment(self.spindles[side], pedal - Vector((0, 0, .073)), pedal - Vector((0, 0, .032)), frame)
            self.grip_pose(side, target, torso, frame, gaps)


class StairClimber(StandingCardio):
    """Treads descend in lockstep, with feet alternating support and swing."""

    rise, run = .16, .27

    def __init__(self, config):
        super().__init__(config)
        self.steps = [box("moving stair tread", (.59, self.run, .062), (0, 0, 0), self.tread)
                      for _ in range(7)]
        for side, sign in SIDES.items():
            rail_x = sign * (self.grip.x + .08)
            target = Vector((rail_x, self.grip.y, self.grip.z))
            post = self.member("step mill handle upright", .031)
            set_segment(post, Vector((rail_x, target.y, 0)), target, 1)
            rail = self.member("step mill side frame", .037)
            set_segment(rail, Vector((sign * .34, .78, .07)), Vector((sign * .34, -.82, 1.02)), 1)
        front = box("step mill front cabinet", (.66, .25, 1.04), (0, -1.0, .52), self.finish)
        self.parts.append((front, False))

    def pose(self, spec, keys, phase, key, torso, frame, gaps):
        self.contacts.clear()
        for index, step in enumerate(self.steps):
            distance = (index + phase * 2) % len(self.steps) - 3
            step.location = (0, distance * self.run, .63 - distance * self.rise - .031)
            step.keyframe_insert("location", frame=frame)
        for side, (ankle, _) in ankles(spec, key).items():
            sign = SIDES[side]
            stride = (phase + (0 if sign > 0 else .5)) % 1
            distance = 2 * stride
            if stride < .5:
                tread_y = distance * self.run
                level = .63 - distance * self.rise
                self.contacts[side] = Vector((sign * .145, tread_y, level)), .19, self.run
            else:
                progress = (stride - .5) * 2
                blend = progress * progress * (3 - 2 * progress)
                tread_y = (1 - blend) * self.run
                level = .47 + .16 * blend + .145 * math.sin(math.pi * progress)**2
            key["foot_" + side.lower()] = [tread_y + .056 - ankle.y, level, 0, 0]
            self.grip_pose(side, Vector((sign * self.grip.x, self.grip.y, self.grip.z)),
                           torso, frame, gaps)


class RowingErg:
    """The carriage slides along a floor rail while a chain pulls the flywheel."""

    def __init__(self, config):
        self.foot_y, self.foot_z = config["footplate"]
        self.seat_z = config["seat_height"]
        self.anchor = Vector((0, -1.16, .58))
        frame = material("rowing erg frame", (.09, .102, .122), .52, .42)
        finish = material("rowing erg upholstery", PAD, .08, .63)
        self.seat = box("rowing erg sliding seat", (.32, .26, .067), (0, 0, 0), finish)
        rail = box("rowing erg guide", (.09, 1.75, .082), (0, .06, self.seat_z - .104), frame)
        wheel = cylinder("rowing erg flywheel", .237, .22, 0, frame, None)
        wheel.location = (0, -1.16, .34)
        supports = (
            box("rowing erg rear foot", (.50, .115, self.seat_z - .08), (0, .87, (self.seat_z - .08) / 2), frame),
            box("rowing erg front foot", (.56, .16, .14), (0, -1.16, .07), frame),
        )
        connector = CableStation.part("rowing erg front frame", .043, frame)
        set_segment(connector, Vector((0, -.81, self.seat_z - .104)), wheel.location, 1)
        platform_mount = box("rowing erg foot rest crossbeam", (.46, .13, .05),
                             (0, self.foot_y, self.foot_z - .038), frame)
        stays = CableStation.part("rowing erg platform brace", .039, frame)
        set_segment(stays, Vector((0, self.foot_y, self.foot_z - .038)),
                    Vector((0, self.foot_y, self.seat_z - .104)), 1)
        self.parts = [(part, False) for part in (rail, wheel, connector, platform_mount, stays, *supports)]
        for sign in (-1, 1):
            box("rowing erg foot rest", (.145, .30, self.foot_z),
                (sign * .166, self.foot_y, self.foot_z / 2), frame)
        bar = CableStation.part("rowing erg handle", Barbell.SHAFT, frame)
        self.handles = dict.fromkeys(SIDES, bar)
        self.chain = CableStation.part("rowing erg chain", .005, frame)
        self.parts.extend(((bar, True), (self.chain, False)))

    def pose(self, span, torso, frame, gaps):
        centre = Vector(span.sample("row_handle"))
        axis = Vector((1, 0, 0))
        set_segment(self.handles["Left"], centre - axis * .29, centre + axis * .29, frame)
        set_segment(self.chain, self.anchor, centre, frame)
        self.seat.location = (0, span.sample("seat_travel"), self.seat_z - .0335)
        self.seat.keyframe_insert("location", frame=frame)
        for side, sign in SIDES.items():
            target = centre + axis * sign * .205
            pole = torso.direction([.43, -.30, -.76], sign)
            gaps.append((side + " rowing erg grip", pose_arm(side, target, pole, "pronated", torso, axis)))

    def check(self, points, faces, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, faces, hands, grips, frame, problems)
        over = (abs(points[:, 0]) < .16) & (abs(points[:, 1] - self.seat.location.y) < .13)
        gap = points[over & (abs(points[:, 2] - self.seat_z) < .09), 2].min(initial=1) - self.seat_z
        if not -.007 <= gap <= .015:
            problems.add(frame, "rowing seat loses contact", abs(gap))
        for side, sign in SIDES.items():
            over = (abs(points[:, 0] - sign * .166) < .073) & (abs(points[:, 1] - self.foot_y) < .15)
            sole = points[over, 2].min(initial=1) - self.foot_z
            if abs(sole) > .012:
                problems.add(frame, side + " foot loses rowing foot rest", abs(sole))
        samples.append(np.array([part.matrix_world @ Vector(v)
                                 for part, _ in self.parts for v in part.bound_box]))


class RotaryTorsoStation:
    """Chest pads and grips turn around a vertical axle above the fixed seat."""

    def __init__(self, config):
        self.pivot = Vector(config["pivot"])
        self.pad_y = config["pad_y"]
        self.travel = config["travel"]
        steel = material("rotary torso frame", IRON, .54, .46)
        cushion = material("rotary torso upholstery", PAD, .05, .67)
        self.pad = box("rotary torso pad", (.33, .075, .27), (0, 0, 0), cushion)
        self.root = Vector((self.pivot.x, self.pivot.y, .036))
        base = box("rotary torso base", (.77, .43, .055),(0, .237, .0275), steel)
        self.parts = [(base, False)]
        self.rear_arm = CableStation.part("rotary torso rear arm", .018, steel)
        self.parts.append((self.rear_arm, False))
        self.handles, self.links = {}, {}
        self.brace = CableStation.part("rotary torso pad brace", .024, steel)
        self.pad_mount = CableStation.part("rotary torso pad support", .023, steel)
        self.parts.extend(((self.brace, False),(self.pad_mount, False)))
        for side in SIDES:
            self.handles[side] = CableStation.part("rotary torso grip", Barbell.SHAFT, steel)
            self.links[side] = [CableStation.part(name, radius, steel) for name, radius in (
                ("rotary torso rear crossbeam", .018), ("rotary torso carrier", .018),
                ("rotary torso riser", .024), ("rotary torso grip return", .018))]
            self.parts.extend((part, False) for part in self.links[side])
            self.parts.append((self.handles[side], True))

    def pose(self, span, torso, frame, gaps, problems):
        angle = span.sample("torso_twist")
        lo, hi = self.travel
        if not lo <= angle <= hi:
            problems.add(frame, "rotary torso outside its travel", max(lo-angle, angle-hi), "degrees")
        self.rotation = Matrix.Rotation(math.radians(angle), 3, "Z")

        def point(x, y, z):
            return self.pivot + self.rotation @ Vector((x, y, z))

        self.pad.location = point(0, self.pad_y-.0375, .255)
        self.pad.rotation_euler = self.rotation.to_euler()
        for channel in ("location", "rotation_euler"):
            self.pad.keyframe_insert(channel, frame = frame)
        brace_y = self.pad_y - .275
        set_segment(self.brace, point(-.59, brace_y, .255), point(.59, brace_y, .255), frame)
        set_segment(self.pad_mount, self.pad.location, point(0, brace_y, .255), frame)
        axis = self.rotation @ Vector((1, 0, 0))
        floor_z = self.root.z - self.pivot.z
        rear = point(0, .27, floor_z)
        set_segment(self.rear_arm, self.root, rear, frame)
        for side, sign in SIDES.items():
            outside_rear = point(sign * .59, .27, floor_z)
            lower = point(sign * .59, brace_y, floor_z)
            outer = point(sign * .59, brace_y, .255)
            grip = point(sign * .278, -.286, .225)
            end = grip + axis * sign * .075
            set_segment(self.links[side][0], rear, outside_rear, frame)
            set_segment(self.links[side][1], outside_rear, lower, frame)
            set_segment(self.links[side][2], lower, outer, frame)
            set_segment(self.links[side][3], outer, end, frame)
            set_segment(self.handles[side], grip - axis * sign * .075, end, frame)
            pole = torso.direction([.46, -.07, -1], sign)
            gap=pose_arm(side, grip, pole, "pronated", torso, axis)
            gaps.append((side+" rotary torso grip", gap))

    def check(self, points, contact, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, contact.faces, hands, grips, frame, problems)
        local = (points[contact.trunk_vertices]-np.array(self.pivot)) @ np.array(self.rotation)
        mask = (abs(local[:, 0])<.165)&(abs(local[:, 2]-.255)<.135)
        gap = local[mask, 1].min(initial = 1)-self.pad_y
        if gap < -.009 or gap > .012:
            problems.add(frame, "rotary torso chest pad contact", abs(gap))
        samples.append(np.array([part.matrix_world @ Vector(v)
                                 for part,_ in self.parts for v in part.bound_box]))


class HipThrustStation:
    """A transverse hip pad and hand grips share a lever mounted behind the bench."""

    def __init__(self, config):
        self.pivot = Vector(config["pivot"])
        self.offset = Vector(config["pad_offset"])
        self.travel = config["travel"]
        metal = material("hip thrust machine frame", IRON,.57,.44)
        pad = material("hip thrust machine upholstery",PAD,.05,.66)
        self.radius, self.half = .048,.20
        self.pad = CableStation.part("hip thrust load pad",self.radius,pad)
        self.parts, self.links, self.handles = [],{},{}
        for side,sign in SIDES.items():
            axle = (sign*.52,self.pivot.y,self.pivot.z)
            post = box("hip thrust machine upright",(.08,.105,self.pivot.z),
                       (axle[0],axle[1],axle[2]/2),metal)
            base = box("hip thrust base",(.15,.83,.055),(axle[0],.31,.0275),metal)
            bearing = cylinder("hip thrust bearing",.044,.095,0,metal,None)
            bearing.location = axle
            self.parts.extend((part,False) for part in (post,base,bearing))
            self.links[side] = [CableStation.part(name,radius,metal) for name,radius in (
                ("hip thrust lever",.024),("hip thrust grip return",.018),
                ("hip thrust pad spindle",.014))]
            self.parts.extend((part,False) for part in self.links[side])
            self.handles[side] = CableStation.part("hip thrust grip",Barbell.SHAFT,metal)
            self.parts.append((self.handles[side],True))

    def pose(self, span, torso, frame, gaps, problems):
        angle=span.sample("thrust_lever")
        lo,hi=self.travel
        if not lo <= angle <= hi:
            problems.add(frame,"hip thrust lever outside travel",max(lo-angle,angle-hi),"degrees")
        rotation=Matrix.Rotation(math.radians(angle),3,"X")
        self.centre=self.pivot+rotation @ self.offset
        axis=Vector((1,0,0))
        set_segment(self.pad,self.centre-axis*self.half,self.centre+axis*self.half,frame)
        for side,sign in SIDES.items():
            pivot=Vector((sign*.52,self.pivot.y,self.pivot.z))
            outer=Vector((pivot.x,self.centre.y,self.centre.z))
            grip=self.centre+axis*sign*.300
            set_segment(self.links[side][0],pivot,outer,frame)
            set_segment(self.links[side][1],outer,grip+axis*sign*.073,frame)
            set_segment(self.links[side][2], self.centre + axis * sign * (self.half - .008),
                        grip - axis * sign * .073, frame)
            set_segment(self.handles[side],grip-axis*sign*.073,grip+axis*sign*.073,frame)
            gap=pose_arm(side,grip,torso.direction([.65,-.1,-.55],sign),"pronated",torso,axis)
            gaps.append((side+" hip thrust grip",gap))

    def check(self, points, faces, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, faces, hands, grips, frame, problems)

        # Measure the contact region in the pelvis frame, which tips back during the rep.
        hips = head("Hips")
        rotation = world_rotation("Hips") @ REST["Hips"].transposed()
        local = (points - np.array(hips)) @ np.array(rotation)
        span = abs(points[:, 0] - self.centre.x) < self.half
        front_crease = (local[:, 1] < -.07) & (local[:, 2] >= -.105) & (local[:, 2] <= .024)
        radial = np.linalg.norm((points - np.array(self.centre))[:, 1:], axis=1)
        gap = radial[span & front_crease].min(initial=1) - self.radius
        if gap > .014:
            problems.add(frame, "hip thrust pad loses pelvis contact", gap)
        depth = self.radius - radial[span].min(initial=1)
        if depth > .007:
            problems.add(frame, "hip thrust pad penetrates skin", depth)
        centre = rotation.transposed() @ (self.centre - hips)
        # As the hips extend, the pad settles toward the thigh side of the crease.
        upper = -.025 + .133 * rotation[2][2]
        if not -.10 <= centre.z <= upper:
            problems.add(frame, "hip thrust pad leaves the front hip crease",
                         max(-.10 - centre.z, centre.z - upper))
        samples.append(np.array([part.matrix_world @ Vector(v)
                                 for part, _ in self.parts for v in part.bound_box]))


class BeltSquatStation:
    """The waist belt tensions a cable to the load below a split foot platform."""

    def __init__(self, config):
        self.platform_y, self.platform_z = config["footplate"]
        self.radii = np.array(config["belt_radii"])
        self.half_width = .031
        self.anchor = Vector(config["anchor"])
        self.grip = Vector(config["grip"])
        steel = material("belt squat frame", IRON, .55, .43)
        fabric = material("belt squat webbing", PAD, .05, .72)
        for sign in (-1, 1):
            box("belt squat platform",(.40, .71, self.platform_z),
                (sign*.286, self.platform_y, self.platform_z/2), steel)
        self.parts, self.handles = [],{}
        for side, sign in SIDES.items():
            target = Vector((sign*self.grip.x, self.grip.y, self.grip.z))
            axis = Vector((1, 0, 0))
            handle = CableStation.part("belt squat grip", Barbell.SHAFT, steel)
            set_segment(handle, target-axis*.077, target+axis*.077, 1)
            outer_x = (self.grip.x+.077)*sign
            column=box("belt squat handle post",(.07, .078, self.grip.z),
                       (outer_x, self.grip.y, self.grip.z/2), steel)
            self.handles[side] = handle
            self.parts.extend(((column, False),(handle, True)))
        self.cable = CableStation.part("belt squat cable", .005, steel)
        self.buckle = CableStation.part("belt squat load buckle", .011, steel)
        self.parts.extend(((self.cable, False),(self.buckle, False)))
        self.ring=bpy.data.objects.new("belt squat waist belt", self.make_belt())
        scene.collection.objects.link(self.ring)
        self.ring.data.materials.append(fabric)
        self.bounds = [Vector((sign*.49, y, z)) for sign in (-1, 1)
                     for y, z in ((self.platform_y+.36, 0),(self.grip.y, self.grip.z))]

    def make_belt(self):
        width = 64
        vertices = []
        for thickness, sign in ((0, -1), (0, 1), (.012, 1), (.012, -1)):
            z = sign * self.half_width
            for i in range(width):
                angle = math.tau*i/width
                vertices.append(((self.radii[0]+thickness)*math.cos(angle),
                                 (self.radii[1]+thickness)*math.sin(angle), z))
        faces = []
        for layer in range(4):
            next_layer = (layer+1)%4
            for index in range(width):
                next_index = (index+1)%width
                faces.append((layer*width+index, layer*width+next_index,
                              next_layer*width+next_index, next_layer*width+index))
        mesh=bpy.data.meshes.new("belt squat strap mesh")
        mesh.from_pydata(vertices,[], faces)
        mesh.update()
        return mesh

    def pose(self, torso, frame, gaps):
        self.rotation = Matrix((torso.left, -torso.forward, torso.up)).transposed()
        self.centre = head("Hips") + self.rotation @ Vector((0, -.024, .122))
        self.ring.location = self.centre
        self.ring.rotation_euler = self.rotation.to_euler()
        self.ring.keyframe_insert("location", frame=frame)
        self.ring.keyframe_insert("rotation_euler", frame=frame)
        end = self.centre + self.rotation @ Vector((0, -self.radii[1] - .055, -.040))
        set_segment(self.buckle, self.centre + self.rotation @ Vector((0, -self.radii[1] - .015, -.031)), end, frame)
        set_segment(self.cable, self.anchor, end, frame)
        axis = Vector((1, 0, 0))
        for side, sign in SIDES.items():
            target = Vector((sign*self.grip.x, self.grip.y, self.grip.z))
            gap=pose_arm(side, target, torso.direction([.57, -.30, -.35], sign), "pronated", torso, axis)
            gaps.append((side+" belt squat grip", gap))

    def check(self, points, contact, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, contact.faces, hands, grips, frame, problems)
        local = (points - np.array(self.centre)) @ np.array(self.rotation)
        trunk = local[contact.trunk_vertices]
        waist = trunk[abs(trunk[:, 2]) < self.half_width, :2]
        rim = (np.linalg.norm(waist / self.radii, axis = 1) - 1) * min(self.radii)
        gap = -rim.max(initial = -1)
        if gap > .014 or gap < -.009:
            problems.add(frame, "waist belt contact", abs(gap))
        # Adjacent glute vertices can rest against the belt, but the strap must
        # remain clear of the leg as the thigh travels forward below the hips.
        self.ring.data.calc_loop_triangles()
        webbing = BVHTree.FromPolygons(
            [self.ring.matrix_world @ v.co for v in self.ring.data.vertices],
            [tuple(t.vertices) for t in self.ring.data.loop_triangles],
            all_triangles = True,
        )
        thighs = contact.vertices[np.isin(contact.part, ("Left thigh", "Right thigh"))]
        leg_skin = BVHTree.FromPolygons(points, thighs, all_triangles = True)
        if webbing.overlap(leg_skin):
            problems.add(frame, "waist belt crosses the thighs", .001)
        for side, sign in SIDES.items():
            over = (abs(points[:, 0]-sign*.286)<.20)&(abs(points[:, 1]-self.platform_y)<.355)
            gap = points[over, 2].min(initial = 1)-self.platform_z
            if abs(gap)>.014:
                problems.add(frame, side+" foot loses belt squat platform", abs(gap))
        samples.append(np.array(self.bounds))


class LegRollerMachine:
    """A knee-height axle drives padded rollers through a fixed arc."""

    def __init__(self, config):
        self.side = config.get("side")
        self.hip_drive = config.get("hip_drive", False)
        self.grip = Vector(config["support_grip"]) if "support_grip" in config else None
        self.forearm_support = config.get("forearm_support")
        self.handles = {}
        sides = (self.side,) if self.side else SIDES
        self.offset = Vector(config["roller_offset"])
        self.range = config["travel"]
        self.thigh_pitch = config.get("thigh_pitch", 0)
        self.radius = .057
        self.half = .092
        self.axes = {}
        metal = material("leg machine frame", IRON, .55, .42)
        pad = material("roller upholstery", PAD, .05, .67)
        self.pads = [SupportPad(name, data, pad, metal) for name, data in config.get("pads", {}).items()]
        self.levers = {side: CableStation.part("roller lever", .022, metal) for side in sides}
        self.returns = {side: CableStation.part("roller return", .018, metal) for side in sides}
        self.rollers = {side: CableStation.part("shin roller", self.radius, pad) for side in sides}
        self.bearings = {side: cylinder("roller axle", .041, .08, 0, metal, None) for side in sides}
        self.columns = {side: box("roller support", (.07, .12, 1), (0, 0, 0), metal) for side in sides}
        self.parts = [(part, False) for parts in (self.levers, self.returns, self.bearings, self.columns)
                      for part in parts.values()]
        self.parts.extend((mount, False) for pad in self.pads for mount in pad.mounts)
        if self.forearm_support:
            self.frame_finish = material("kickback frame", (.10, .115, .13), .52, .39)
            self.axle_finish = material("kickback axle cap", (.26, .28, .32), .66, .34)
            self.axle_caps = {}
            for side in sides:
                self.columns[side].data.materials[0] = self.frame_finish
                self.levers[side].data.materials[0] = self.frame_finish
                cap = cylinder("kickback fixed pivot", .062, .115, 0, self.axle_finish, None)
                self.axle_caps[side] = cap
                self.parts.append((cap, False))
        if self.grip:
            for side, sign in SIDES.items():
                target = Vector((sign * self.grip.x, self.grip.y, self.grip.z))
                outer = target + Vector((sign * .077, 0, 0))
                handle = CableStation.part("standing roller support grip", Barbell.SHAFT, metal)
                set_segment(handle, target - Vector((sign * .077, 0, 0)), outer, 1)
                post = box("standing roller grip post", (.057,.062,outer.z),
                           (outer.x, outer.y, outer.z / 2), metal)
                if self.forearm_support:
                    post.data.materials[0] = self.frame_finish
                    support = self.forearm_support
                    face = (sign * support["face"][0], *support["face"][1:])
                    self.pads.append(SupportPad(side + " kickback forearm support",
                                                {**support, "face": face}, pad, self.frame_finish))
                    cradle = CableStation.part("kickback forearm support bracket", .022, self.frame_finish)
                    start = Vector((outer.x, outer.y, face[2] - .066))
                    end = Vector((face[0], face[1], face[2] - .053))
                    set_segment(cradle, start, end, 1)
                    self.parts.append((cradle, False))
                self.handles[side] = handle
                self.parts.extend(((handle, True), (post, False)))

    def pose_legs(self, span, frame, problems):
        angle = span.sample("lever_angle")
        lo, hi = self.range
        if not lo <= angle <= hi:
            problems.add(frame, "roller outside its travel", max(lo-angle, angle-hi), "degrees")
        axis = Vector((1, 0, 0))
        rotation = Matrix.Rotation(math.radians(angle), 3, "X")
        thigh_angle = math.radians(self.thigh_pitch)
        thigh = Vector((0, -math.cos(thigh_angle), math.sin(thigh_angle)))
        for side in self.rollers:
            sign = SIDES[side]
            shin_direction = rotation @ Vector((0, 0, -1))
            swing(side + "UpLeg", shin_direction if self.hip_drive else thigh)
            pivot = head(side + ("UpLeg" if self.hip_drive else "Leg"))
            if self.hip_drive:
                shin_direction = Matrix.Rotation(math.radians(8), 3, "X") @ shin_direction
            swing(side + "Leg", shin_direction)
            shoe_rotation = Matrix.Rotation(math.radians(angle * .32), 3, "X") if self.side else rotation
            place(side + "Foot", shoe_rotation @ REST[side + "Foot"])
            outside = Vector((sign * .44, pivot.y, pivot.z))
            centre = pivot + rotation @ self.offset
            elbow = Vector((outside.x, centre.y, centre.z))
            inside = centre + axis * self.half * sign
            set_segment(self.levers[side], outside, elbow, frame)
            set_segment(self.returns[side], elbow, inside, frame)
            set_segment(self.rollers[side], centre - axis * self.half, centre + axis * self.half, frame)
            if frame == 1:
                self.axes[side] = outside
                self.bearings[side].location = outside
                column = self.columns[side]
                column.location = (outside.x, outside.y, outside.z / 2)
                column.scale.z = outside.z
                if self.forearm_support:
                    self.axle_caps[side].location = outside + Vector((sign * .035, 0, 0))
                    front_y = self.grip.y - .045
                    back_y = outside.y + .16
                    foot = box("kickback base rail", (.115, back_y - front_y, .052),
                               (sign * .423, (front_y + back_y) / 2, .026), self.frame_finish)
                    self.parts.append((foot, False))
            if (outside - self.axes[side]).length > .002:
                problems.add(frame, "knee leaves the fixed roller axle", (outside - self.axes[side]).length)

    def pose_grips(self, torso, gaps):
        for side in self.handles:
            sign = SIDES[side]
            target = Vector((sign * self.grip.x, self.grip.y, self.grip.z))
            pole = torso.direction([.42, -.12, -1], sign)
            gap = pose_arm(side, target, pole, "pronated", torso)
            gaps.append((side + " roller station grip", gap))

    def check(self, points, faces, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, faces, hands, grips, frame, problems)
        for side, part in self.rollers.items():
            transform = part.matrix_world
            axis = np.array(transform.col[2].to_3d().normalized())
            local = points - np.array(transform.translation)
            across = local @ axis
            radial = np.linalg.norm(local - across[:, None] * axis, axis=1)
            in_width = np.abs(across) < self.half
            knee, ankle = np.array(head(side + "Leg")), np.array(head(side + "Foot"))
            shin = ankle - knee
            along = (points - knee) @ shin / (shin @ shin)
            calf = (along > .60) & (along < .95)
            gap = radial[in_width & calf].min(initial=1) - self.radius
            if gap > .004:
                problems.add(frame, side + " roller contact", gap)
            depth = self.radius - radial[in_width].min(initial=1)
            if depth > .006:
                problems.add(frame, side + " roller penetrates skin", depth)
        for pad in self.pads:
            pad.check(points, frame, problems)
        visible = (*self.rollers.values(), *(part for part, _ in self.parts)) if self.forearm_support else self.rollers.values()
        samples.append(np.array([part.matrix_world @ Vector(corner)
                                 for part in visible for corner in part.bound_box]))


class SelectorMachine:
    """A seated press whose grips and lever rotate about the same fixed axle."""

    def __init__(self, config):
        self.pivot = Vector(config["pivot"])
        self.offset = Vector(config["grip_offset"])
        self.travel = config["travel"]
        self.grip_axis = Vector(config.get("grip_axis", [1, 0, 0])).normalized()
        self.pad_face = None
        self.pad_width, self.pad_length = config.get("pad_size", (.36, .57))
        self.pad_sign = -1 if config.get("support") == "chest" else 1
        self.metal = material("machine frame", (.085, .095, .11), .65, .43)
        pad = material("machine upholstery", PAD, .05, .65)
        if "back_pad" in config:
            y, bottom, incline = config["back_pad"]
            self.pad_rotation = Matrix.Rotation(math.radians(incline), 3, "X")
            self.pad_face = Vector((0, y, bottom))
            box("machine back pad", (self.pad_width, .09, self.pad_length),
                self.pad_face + self.pad_rotation @ Vector((0, self.pad_sign * .045, self.pad_length / 2)),
                pad, rotation=self.pad_rotation.to_euler())
        fixed = [box("machine support", (.63, .72, .06), (0, .26, .03), self.metal)]
        for x in (.18, .42):
            fixed.append(box("machine stack rail", (.028, .028, .85), (x, .53, .46), self.metal))
        weight = material("machine weight", IRON, .4, .55)
        for plate in range(10):
            fixed.append(box("machine stack plate", (.34, .17, .026), (.30, .53, .086 + .036 * plate), weight))
        self.handles = {}
        self.arms = {}
        self.links = {}
        self.parts = [(part, False) for part in fixed]
        self.restraints = [SupportPad(name, cfg, pad, self.metal)
                           for name, cfg in config.get("restraints", {}).items()]
        self.parts.extend((mount, False) for restraint in self.restraints for mount in restraint.mounts)
        for side, sign in SIDES.items():
            bearing = self.pivot.copy()
            bearing.x *= sign
            support_y = .49 if config.get("motion") == "fly" else bearing.y
            support_x = sign * config.get("bearing_support_width", abs(bearing.x))
            support = box("machine bearing support", (.075, .09, bearing.z),
                          (support_x, support_y, bearing.z / 2), self.metal)
            pin = cylinder("machine pivot", .045, .10, 0, self.metal, None)
            pin.location = bearing
            self.parts.extend(((support, False), (pin, False)))
            if config.get("motion") == "fly":
                pin.rotation_euler = (0, 0, 0)
                if support_x == bearing.x:
                    bracket = box("fly bearing bracket", (.08, support_y - bearing.y, .06),
                                  (bearing.x, (support_y + bearing.y) / 2, bearing.z + .06), self.metal)
                else:
                    bracket = CableStation.part("fly bearing bracket", .033, self.metal)
                    set_segment(bracket, Vector((support_x, support_y, bearing.z)),
                                bearing + Vector((0, 0, .055)), 1)
                self.parts.append((bracket, False))
            self.arms[side] = CableStation.part("machine lever", .023, self.metal)
            self.links[side] = CableStation.part("machine handle return", .019, self.metal)
            self.handles[side] = CableStation.part("machine grip", Barbell.SHAFT, self.metal)
            self.parts.extend(((self.arms[side], False), (self.links[side], False),
                               (self.handles[side], True)))

    def pose(self, span, torso, grips, frame, gaps, problems):
        angle = span.sample("lever_angle")
        minimum, maximum = self.travel
        if not minimum <= angle <= maximum:
            problems.add(frame, "machine lever outside its stops",
                         max(minimum - angle, angle - maximum), "degrees")
        rotation = Matrix.Rotation(math.radians(angle), 3, "X")
        axis = rotation @ self.grip_axis
        for side, sign in SIDES.items():
            pivot = self.pivot.copy()
            pivot.x *= sign
            grip = pivot + rotation @ Vector((sign * self.offset.x, self.offset.y, self.offset.z))
            pole = torso.direction(span.sample("elbows"), sign)
            gap = pose_arm(side, grip, pole, span.keys[1].get("grip", "pronated"), torso, axis)
            gaps.append((side + " machine grip", gap))
            set_segment(self.handles[side], grip - axis * .076, grip + axis * .076, frame)
            outside = grip + axis * .076 * (sign if abs(axis.x) > .5 else -1)
            elbow = Vector((pivot.x, outside.y, outside.z))
            set_segment(self.arms[side], pivot, elbow, frame)
            set_segment(self.links[side], elbow, outside, frame)

    def check(self, points, faces, hands, grips, frame, problems, samples):
        if self.pad_face is not None:
            # Measure skin against the front plane of the upholstery in pad coordinates.
            local = (points - np.array(self.pad_face)) @ np.array(self.pad_rotation)
            on_pad = (np.abs(local[:, 0]) < self.pad_width / 2) & (local[:, 2] > 0) & (local[:, 2] < self.pad_length)
            depth = (self.pad_sign * local[on_pad, 1]).max(initial=-1)
            if depth < -.035:
                problems.add(frame, "back loses machine pad contact", -depth)
            if depth > .025:
                problems.add(frame, "the body sinks into the machine pad", depth)
        for restraint in self.restraints:
            restraint.check(points, frame, problems)
        check_hardware_clearance(self.parts, points, faces, hands, grips, frame, problems)
        samples.append(np.array([part.matrix_world @ Vector(corner)
                                 for part, _ in self.parts for corner in part.bound_box]))


class FlyMachine(SelectorMachine):
    """Overhead vertical bearings drive suspended handles around the chest."""

    def __init__(self, config):
        super().__init__(config)
        self.drops = {side: CableStation.part("fly handle drop", .018, self.metal) for side in SIDES}
        self.parts.extend((part, False) for part in self.drops.values())

    def pose(self, span, torso, grips, frame, gaps, problems):
        angle = span.sample("lever_angle")
        lo, hi = self.travel
        if not lo <= angle <= hi:
            problems.add(frame, "fly arm outside its travel", max(lo-angle, angle-hi), "degrees")
        axis = Vector((0, 0, 1))
        for side, sign in SIDES.items():
            pivot = self.pivot.copy()
            pivot.x *= sign
            rotation = Matrix.Rotation(math.radians(angle * sign), 3, "Z")
            grip = pivot + rotation @ Vector((sign * self.offset.x, self.offset.y, self.offset.z))
            gap = pose_arm(side, grip, torso.direction(span.sample("elbows"), sign), "thumb-forward", torso, axis)
            gaps.append((side + " fly grip", gap))
            top = Vector((grip.x, grip.y, pivot.z))
            set_segment(self.arms[side], pivot, top, frame)
            set_segment(self.links[side], top, top - axis * .05, frame)
            set_segment(self.drops[side], top - axis * .05, grip + axis * .078, frame)
            set_segment(self.handles[side], grip - axis * .068, grip + axis * .078, frame)


class ContactLoad:
    """One or two loads held by their faces or ends. Dimensions drive mesh and contact checks."""

    def __init__(self, config):
        self.kind = config["type"]
        self.paired = config.get("paired", False)
        self.roots = {}
        self.discs = []
        if self.kind == "plate":
            self.discs.append((0., config.get("radius", .115), config.get("thickness", .018)/2, .014))
            self.axis = Vector(config.get("axis", [1,0,0])).normalized()
        else:
            self.discs = [(-.094,.077,.032,0), (0,.014,.063,0), (.094,.077,.032,0)]
            self.axis = Vector((0,0,1))
        finish = material("cast weight", IRON, .38, .42)
        for name in (SIDES if self.paired else ["both"]):
            root = bpy.data.objects.new(self.kind+"."+name, None)
            root.rotation_mode = "QUATERNION"
            scene.collection.objects.link(root)
            self.roots[name] = root
            for offset, radius, half, bore in self.discs:
                if bore:
                    # Revolve the rim and bore together so the centre hole is real.
                    profile = [(bore,-half),(radius-.002,-half),(radius,-half+.002),
                               (radius,half-.002),(radius-.002,half),(bore,half)]
                    verts, faces = [], []
                    for i in range(64):
                        angle = 2*math.pi*i/64
                        for r,z in profile:
                            verts.append((r*math.cos(angle),r*math.sin(angle),z))
                        for j in range(len(profile)):
                            n = len(profile)
                            faces.append((i*n+j, ((i+1)%64)*n+j, ((i+1)%64)*n+(j+1)%n, i*n+(j+1)%n))
                    mesh = bpy.data.meshes.new("plate with bore")
                    mesh.from_pydata(verts, [], faces)
                    part = bpy.data.objects.new("weight plate",mesh)
                    scene.collection.objects.link(part)
                    part.data.materials.append(finish)
                    part.parent = root
                else:
                    part = cylinder("dumbbell end" if offset else "handle", radius, half*2, 0, finish, root)
                part.rotation_euler = self.axis.to_track_quat("Z","Y").to_euler()
                part.location = self.axis*offset

    def distance(self, local, upper_head=False):
        if upper_head and self.kind != "vertical-dumbbell":
            raise ValueError("An upper-head checkpoint requires a vertical dumbbell")
        axial = local @ np.array(self.axis)
        radial = np.linalg.norm(local - np.outer(axial,self.axis),axis=1)
        distances = []
        for offset, radius, half, bore in (self.discs[-1:] if upper_head else self.discs):
            across = radial-radius
            if bore:
                across = np.maximum(across,bore-radial)
            end = np.abs(axial-offset)-half
            distances.append(np.hypot(np.maximum(across,0),np.maximum(end,0)) +
                             np.minimum(np.maximum(across,end),0))
        return np.minimum.reduce(distances)

    def pose(self, spec, span, torso, grips, frame, gaps, problems):
        centre = Vector(span.sample("load", resolve=lambda t:bar_centre(t,torso)))
        angle = math.radians(span.sample("load_pitch",0))
        rotation = Matrix.Rotation(angle,3,"X")
        if "follow" in spec:
            follow = spec["follow"]
            bone = follow["bone"]
            delta = world_rotation(bone) @ REST[bone].transposed()
            centre = head(bone) + delta @ centre
            rotation = delta @ rotation
        for name, root in self.roots.items():
            root.location = centre.copy()
            if self.paired:
                root.location.x += SIDES[name]*span.sample("spacing")
            root.rotation_quaternion = rotation.to_quaternion()
            for field in ("location","rotation_quaternion"):
                root.keyframe_insert(field,frame=frame)
        for side,sign in SIDES.items():
            root = self.roots[side if self.paired else "both"]
            socket = spec["contact"]
            def vector(field):
                x,y,z = socket[field]
                return rotation @ Vector((sign*x,y,z))
            along, palm = vector("along").normalized(), vector("palm").normalized()
            palm = (palm-along*palm.dot(along)).normalized()
            wrist = root.location + vector("wrist")
            target = wrist + along*GRIP[side][0] + palm*GRIP[side][1]
            pole = torso.direction(span.sample("elbows",[.4,-.5,-1]),sign)
            gaps.append((side+" contact wrist",pose_arm(side,target,pole,"pronated",torso,contact_frame=(along,palm))))
            surface = grips[side]
            posed = surface.points @ np.array(surface.transform.to_3x3()).T + np.array(surface.transform.translation)
            local = (posed-np.array(root.location)) @ np.array(rotation)
            distance = self.distance(local)
            if distance.min() < -.002:
                problems.add(frame,side+" hand intersects load",-distance.min())
            if distance.min() > .0025:
                problems.add(frame,side+" hand loses load",distance.min())
            surface.record_contact(distance.min())
            if spec.get("hands", {}).get(side) == "pinch" and self.kind == "plate":
                axial = local @ np.array(self.axis)
                for face in (-1,1):
                    patch = distance[axial*face>0]
                    if patch.min(initial=1) > .0025:
                        problems.add(frame,side+" pinch loses plate face "+str(face),patch.min(initial=1))

    def check_body(self, points, frame, problems, samples, contact_bone=None):
        for root in self.roots.values():
            local = (points-np.array(root.location)) @ np.array(root.rotation_quaternion.to_matrix())
            distance = self.distance(local)
            if contact_bone:
                near = np.linalg.norm(points - np.array(head(contact_bone)), axis=1) < .18
                if distance[near].min(initial=1) > .004:
                    problems.add(frame,"load loses "+contact_bone+" contact",distance[near].min(initial=1))
            if distance.min() < -.004:
                problems.add(frame,self.kind+" intersects the body",-distance.min())
            for part in root.children:
                corners = np.array([part.matrix_world @ Vector(v) for v in part.bound_box])
                samples.append(corners)
                if corners[:,2].min() < -.005:
                    problems.add(frame,self.kind+" crosses the floor",-corners[:,2].min())


class PreacherPad:
    """Split sloping pads leave chest clearance between the supported upper arms."""

    def __init__(self, config):
        self.rotation = Matrix.Rotation(math.radians(config["angle"]), 3, "X")
        self.tops = {}
        self.surfaces = []
        centre = Vector(config["at"])
        pad = material("arm pad", PAD, 0., .7)
        steel = material("pad support", IRON, .55, .4)
        for side, sign in SIDES.items():
            top = centre + Vector((sign * .231, 0, 0))
            self.tops[side] = np.array(top)
            part = box("preacher arm pad", (.106,.18,.05), top + self.rotation @ Vector((0,0,-.025)),
                       pad, rotation=self.rotation.to_euler())
            self.surfaces.append(Bench.surface(part))
            box("preacher stanchion", (.045,.045,top.z-.05), (top.x,top.y,(top.z-.05)/2), steel)
        box("preacher base rail", (.50,.09,.035), (centre.x,centre.y,.0175), steel)

    def check(self, points, frame, problems):
        for side, top in self.tops.items():
            local = (points-top) @ np.array(self.rotation)
            over = (np.abs(local[:,0]) < .053) & (np.abs(local[:,1]) < .09)
            heights = local[:,2]
            inside = over & (heights > -.05) & (heights < -.014)
            if inside.any():
                problems.add(frame, side+" body sinks into preacher pad", -heights[inside].min())
            midpoint = np.array(head(side+"Arm").lerp(head(side+"ForeArm"), .65))
            upper_arm = np.linalg.norm(points-midpoint, axis=1) < .085
            gap = np.abs(heights[over & upper_arm]).min(initial=1)
            if gap > .009:
                problems.add(frame, side+" upper arm loses preacher pad",gap)


class PullStation:
    """Physical starting supports for pulls, measured against the feet and moving shaft."""
    def __init__(self, config):
        self.kind = config["type"]
        self.height = config["height"]
        steel = material("pull supports", IRON, .55, .48)
        self.boxes = []
        def support(name, size, centre):
            box(name, size, centre, steel)
            self.boxes.append((np.array(centre), np.array(size)/2))
        if self.kind == "platform":
            support("lifting platform", (.62,.48,self.height), (0,0,self.height/2))
        else:
            for x in (-.52, .52):
                for y in (-.36,.15):
                    support("rack upright", (.045,.055,self.height+.08), (x,y,(self.height+.08)/2))
                support("rack safety pin", (.038,.52,.032), (x,-.105,self.height-.016))
                support("rack foot", (.15,.64,.03), (x,-.105,.015))

    def check(self, points, bar, frame, problems):
        for centre, half in self.boxes:
            depth = np.max(np.abs(points-centre)-half,axis=1).min()
            if depth < -.012:
                problems.add(frame, self.kind+" intersects the body", -depth)
        if self.kind == "platform":
            for side in SIDES:
                foot = np.array(head(side+"Foot"))
                over = (np.abs(points[:,0]-foot[0]) < .07) & (np.abs(points[:,1]-foot[1]) < .14)
                sole = points[over,2].min(initial=1)
                if abs(sole-self.height) > .012 or abs(foot[0]) > .24:
                    problems.add(frame, side+" foot loses platform support", abs(sole-self.height))
        else:
            gap = bar.centre.z - bar.SHAFT - self.height
            if gap < -.001 or frame == 1 and (abs(gap) > .002 or not -.32 < bar.centre.y < .11):
                problems.add(frame, "shaft misses rack pins", abs(gap))


class Bench:
    def __init__(self, at, length=1.2, angle=None, support="back", width=.30):
        self.top, self.length, self.width = Vector(at), length, width
        pad = material("pad", PAD, 0.0, 0.7)
        frame = material("frame", IRON, 0.6, 0.4)
        x, y, z = self.top
        self.chest_support = support == "chest"
        self.pads = []
        self.surfaces = []
        if angle is not None:
            # The specified top is the seat/back hinge. The back rises toward
            # +Y for a positive angle, or toward -Y on a prone bench.
            if support not in ("back", "chest") or not -30 <= angle <= 80 or length <= .40:
                raise ValueError("Invalid adjustable bench setup")
            prone = self.chest_support
            direction = -1 if prone else 1
            rotation = Matrix.Rotation(math.radians(direction * angle), 3, "X")
            for extent, offset, rot in ((.32, -.165*direction, Matrix.Identity(3)),
                                         (length-.32, (length-.32)*direction/2+.005*direction, rotation)):
                top = self.top + rot @ Vector((0, offset, 0))
                self.pads.append((np.array(top), np.array(rot), extent))
                part = box("bench pad", (.30, extent, .08), top + rot @ Vector((0,0,-.04)),
                           pad, rotation=rot.to_euler())
                self.surfaces.append(self.surface(part))
            support_y = min(.55, (length - .32) * math.cos(math.radians(angle)) - .045)
            for offset in (-.20, support_y):
                leg_y = y + direction*offset
                height = z-.08 + (math.tan(math.radians(angle))*offset if offset>0 else 0)
                box("bench post", (.065,.065,height), (x,leg_y,height/2), frame)
                box("bench foot", (.46,.08,.04), (x,leg_y,.02), frame)
            box("bench rail", (.065, support_y + .23, .06),
                (x, y + direction*(support_y - .21)/2, .09), frame)
            return
        flat_pad = box("bench pad", (self.width, length, 0.08), (x, y, z - 0.04), pad)
        self.surfaces.append(self.surface(flat_pad))
        box("bench spine", (0.08, length * 0.9, 0.06), (x, y, z - 0.11), frame)
        for end in (-1, 1):
            leg_y = y + end * length * 0.4
            box("bench leg", (0.06, 0.06, z - 0.14), (x, leg_y, (z - 0.14) / 2), frame)
            box("bench foot", (0.42, 0.07, 0.04), (x, leg_y, 0.02), frame)

    @staticmethod
    def surface(part):
        points = [part.matrix_world @ v.co for v in part.data.vertices]
        return BVHTree.FromPolygons(points, [p.vertices[:] for p in part.data.polygons])

    def check_apparatus(self, roots, frame, problems):
        for root in roots:
            for part in root.children:
                moving = self.surface(part)
                if any(pad.overlap(moving) for pad in self.surfaces):
                    problems.add(frame, f"{part.name} intersects the bench pad", 1, "intersection")

    def gap(self, points):
        """The smallest height of the body above the pad's top; below 0 means it sinks into the pad."""
        if self.pads:
            gaps = []
            for top, rotation, extent in self.pads:
                local = (points - top) @ rotation
                over = (np.abs(local[:,0]) < .15) & (np.abs(local[:,1]) < extent/2) & (local[:,2] > -.08)
                if over.any():
                    gaps.append(float(local[over,2].min()))
            return min(gaps, default=math.inf)
        rel = points - np.array(self.top)
        over = (np.abs(rel[:, 0]) < self.width / 2) & (np.abs(rel[:, 1]) < self.length / 2) & (rel[:, 2] > -0.08)
        return float(rel[over, 2].min()) if over.any() else math.inf


class RomanChair:
    """A 45-degree thigh pad and ankle rollers support a free hip hinge."""

    def __init__(self, config):
        self.hips = Vector(config["hips"])
        self.rotation = Matrix.Rotation(math.radians(-45), 3, "X")
        self.leg_axis = self.rotation @ Vector((0, 1, 0))
        self.normal = self.rotation @ Vector((0, 0, 1))
        thighs, shins = segment("LeftUpLeg", "LeftLeg", "LeftFoot")
        self.ankle = self.hips + self.leg_axis * (thighs + shins - .001)
        frame = material("Roman chair frame", IRON, .55, .42)
        foam = material("Roman chair upholstery", PAD, .05, .7)
        face = self.hips + self.rotation @ Vector((0, .216, config["pad_height"]))
        self.pad = SupportPad("Roman chair hip pad", {
            "face": face, "size": [.40, .172], "pitch": -45, "split": True,
        }, foam, frame)
        self.parts = []
        backbone = CableStation.part("Roman chair spine", .037, frame)
        set_segment(backbone, face - self.normal * .112, self.ankle - self.normal * .16, 1)
        self.parts.append((backbone, False))
        for point in (face - self.normal * .105, self.ankle - self.normal * .15):
            self.parts.extend((
                (box("Roman chair post", (.08, .08, point.z), (0, point.y, point.z / 2), frame), False),
                (box("Roman chair base", (.64, .125, .055), (0, point.y, .0275), frame), False),
            ))
        self.roller_radius = .038
        self.roller_half = .090
        anchor = self.ankle + self.rotation @ Vector(config["roller_offset"])
        self.rollers = {}
        for side, sign in SIDES.items():
            centre = anchor + Vector((sign * .123, 0, 0))
            self.rollers[side] = centre
            roller = CableStation.part("Roman chair ankle roller", self.roller_radius, foam)
            width = Vector((self.roller_half, 0, 0))
            set_segment(roller, centre - width, centre + width, 1)
            bracket = CableStation.part("Roman chair roller bracket", .023, frame)
            end = centre + width * sign
            lower = self.ankle - self.normal * .15
            lower.x = end.x
            set_segment(bracket, end, lower, 1)
            crossbar = CableStation.part("Roman chair roller mount", .022, frame)
            set_segment(crossbar, lower, self.ankle - self.normal * .15, 1)
            self.parts.extend(((bracket, False), (crossbar, False)))

    def anchor(self, pelvis):
        midpoint = (head("LeftUpLeg") + head("RightUpLeg")) / 2
        place("Hips", pelvis @ REST["Hips"], head("Hips") + self.hips - midpoint)

    def pose_legs(self, gaps):
        for side in SIDES:
            hip = head(side + "UpLeg")
            ankle = self.ankle + Vector((hip.x, 0, 0))
            thigh, shin = segment(side + "UpLeg", side + "Leg", side + "Foot")
            knee, gap = bend(hip, ankle, thigh, shin, -self.normal)
            swing(side + "UpLeg", (knee - hip).normalized())
            swing(side + "Leg", (ankle - head(side + "Leg")).normalized())
            for bone in ("Foot", "ToeBase"):
                place(side + bone, self.rotation @ REST[side + bone])
            gaps.append((side + " Roman chair ankle", gap))

    def check(self, points, contact, hands, frame, problems, samples):
        check_hardware_clearance(self.parts, points, contact.faces, hands, {}, frame, problems)
        self.pad.check(points, frame, problems)
        trunk = (head("Neck") - head("Hips")).normalized()
        if trunk.dot(self.normal) > .035:
            problems.add(frame, "Roman chair lockout extends past the legs",
                         math.degrees(math.asin(trunk.dot(self.normal))), "degrees")
        # The front edge meets the uppermost supported thigh, just below the hip.
        pad_points = (points - np.array(self.pad.face)) @ np.array(self.rotation)
        at_edge = (abs(pad_points[:, 0]) < self.pad.width / 2) & (
            abs(pad_points[:, 1] + self.pad.length / 2) < .020)
        for side, sign in SIDES.items():
            on_thigh = np.unique(contact.vertices[contact.part == side + " thigh"])
            patch = pad_points[on_thigh]
            edge = at_edge[on_thigh] & (sign * patch[:, 0] > .045)
            gap = np.abs(patch[edge, 2]).min(initial=1)
            if gap > .018:
                problems.add(frame, side + " Roman chair front edge loses upper thigh contact", gap)
        for side, centre in self.rollers.items():
            local = points - np.array(centre)
            under = np.abs(local[:, 0]) < self.roller_half
            distance = np.linalg.norm(local[:, 1:], axis=1) - self.roller_radius
            penetration = distance[under].min(initial=1)
            if penetration < -.006:
                problems.add(frame, side + " Roman chair roller penetrates skin", -penetration)
            ankle_region = np.linalg.norm(points - np.array(head(side + "Foot")), axis=1) < .115
            gap = distance[under & ankle_region].min(initial=1)
            if gap > .014:
                problems.add(frame, side + " ankle loses Roman chair roller contact", gap)
        samples.append(np.array([part.matrix_world @ Vector(corner)
                                 for part, _ in self.parts for corner in part.bound_box]))


class NordicBench:
    """A low knee pad and ankle roller keep the shins fixed during the curl."""

    def __init__(self, config):
        self.knees = Vector(config["knees"])
        metal = material("Nordic bench frame", IRON, .55, .42)
        foam = material("Nordic bench pads", PAD, .05, .7)
        self.pad = SupportPad("Nordic knee pad", {
            "face": [0, .055, config["pad_height"]], "size": [.42, .33], "split": True,
        }, foam, metal)
        self.roller = Vector(config["roller"])
        self.radius = .043
        roller = CableStation.part("Nordic ankle roller", self.radius, foam)
        width = Vector((.253, 0, 0))
        set_segment(roller, self.roller - width, self.roller + width, 1)
        self.parts = []
        for sign in (-1, 1):
            x = sign * .266
            post = box("Nordic roller upright", (.052, .065, self.roller.z),
                       (x, self.roller.y, self.roller.z / 2), metal)
            rail = box("Nordic base rail", (.061, .68, .035), (x, .18, .0175), metal)
            self.parts.extend(((post, False), (rail, False)))
        self.parts.append((box("Nordic platform base", (.56, .33, .025), (0, .055, .0125), metal), False))

    def pose_legs(self, pelvis):
        for side in SIDES:
            swing(side + "UpLeg", pelvis @ Vector((0, 0, -1)))
        mid = (head("LeftLeg") + head("RightLeg")) / 2
        place("Hips", pelvis @ REST["Hips"], head("Hips") + self.knees - mid)
        for side in SIDES:
            swing(side + "Leg", Vector((0, 1, 0)))
            foot = Matrix.Rotation(math.radians(12), 3, "X")
            for bone in ("Foot", "ToeBase"):
                place(side + bone, foot @ REST[side + bone])

    def check(self, points, contact, hands, frame, problems, samples):
        check_hardware_clearance(self.parts, points, contact.faces, hands, {}, frame, problems)
        self.pad.check(points, frame, problems)
        rel = points - np.array(self.roller)
        distances = np.linalg.norm(rel[:, 1:], axis=1) - self.radius
        if distances[abs(rel[:, 0]) < .253].min(initial=1) < -.006:
            problems.add(frame, "Nordic roller penetrates the ankles", -distances.min())
        for side, sign in SIDES.items():
            ankle = np.array(head(side + "Foot"))
            near = np.linalg.norm(points - ankle, axis=1) < .12
            gap = distances[near & (rel[:, 0] * sign > 0) & (abs(rel[:, 0]) < .253)].min(initial=1)
            if gap > .014:
                problems.add(frame, side + " ankle loses Nordic roller contact", gap)
        samples.append(np.array([part.matrix_world @ Vector(corner)
                                 for part, _ in self.parts for corner in part.bound_box]))


class CaptainsChair:
    """Fixed forearm rests and upright grips support a hanging knee raise."""

    def __init__(self, config):
        metal = material("captain's chair frame", IRON, .55, .42)
        foam = material("captain's chair pads", PAD, .05, .7)
        self.grip = Vector(config["grip"])
        self.axis = Vector((0, 0, 1))
        self.handles, self.parts, self.pads = {}, [], {}
        self.back = SupportPad("captain's chair back pad", {
            "face": config["back"], "pitch": 90, "size": [.32, .38],
        }, foam, metal)
        for side, sign in SIDES.items():
            x = sign * self.grip.x
            pad_y, pad_z = config["forearm_pad"]
            self.pads[side] = SupportPad(side + " captain's chair arm pad", {
                "face": [x, pad_y, pad_z], "size": [.136, .28],
            }, foam, metal)
            y = self.back.face.y + .14
            post = box("captain's chair upright", (.065, .075, pad_z), (x, y, pad_z / 2), metal)
            base = box("captain's chair foot", (.09, .75, .06), (x, y - .22, .03), metal)
            rail = box("captain's chair arm rest mount", (.058, y - self.grip.y, .055),
                       (x, (y + self.grip.y) / 2, pad_z - .097), metal)
            grip = Vector((x, self.grip.y, self.grip.z))
            handle = CableStation.part(side + " captain's chair grip", Barbell.SHAFT, metal)
            set_segment(handle, Vector((x, self.grip.y, pad_z - .108)), grip + self.axis * .093, 1)
            self.parts.extend(((post, False), (base, False), (rail, False), (handle, True)))
            self.handles[side] = handle
        back_mount = box("captain's chair backrest mount", (.52, .18, .065),
                         (0, self.back.face.y + .16, self.back.face.z), metal)
        self.parts.append((back_mount, False))

    def pose(self, torso, gaps):
        for side, sign in SIDES.items():
            target = Vector((sign * self.grip.x, self.grip.y, self.grip.z))
            pole = torso.direction([.18, -.45, -1], sign)
            gaps.append((side + " captain's chair grip",
                         pose_arm(side, target, pole, "thumb-forward", torso, self.axis)))

    def check(self, points, contact, hands, grips, frame, problems, samples):
        check_rendered_grips(self.handles, grips, frame, problems)
        check_hardware_clearance(self.parts, points, contact.faces, hands, grips, frame, problems)
        for side, pad in self.pads.items():
            pad.check(points, frame, problems)
            forearm = points[np.unique(contact.vertices[contact.part == side + " forearm"])]
            pad.check(forearm, frame, problems)
        self.back.check(points, frame, problems)
        contact.check_unsupported_feet(frame, points, {side: .10 for side in SIDES}, problems)
        samples.append(np.array([part.matrix_world @ Vector(corner)
                                 for part, _ in self.parts for corner in part.bound_box]))


class CoreBench:
    """A decline bench with an ankle restraint, or a flat bench with fixed grips."""

    def __init__(self, config):
        self.top = Vector(config["at"])
        self.angle = config.get("angle", 0)
        self.flag = "grip" in config
        self.rotation = Matrix.Rotation(math.radians(self.angle), 3, "X")
        self.parts, self.contacts, self.handles = [], {}, {}
        frame = material("core bench frame", IRON, .55, .42)
        foam = material("core bench pad", PAD, .05, .65)
        y, length = config["pad"]
        self.pad = SupportPad("core bench backrest", {
            "face": self.point((0, y, 0)), "size": [.35, length], "pitch": self.angle,
        }, foam, frame)
        for offset in (y - length * .35, y + length * .35):
            x, py, z = self.point((0, offset, -.08))
            self.parts.extend((
                (box("core bench post", (.065, .07, z), (x, py, z / 2), frame), False),
                (box("core bench base", (.45, .09, .045), (x, py, .0225), frame), False),
            ))
        if self.flag:
            anchor = Vector(config["grip"])
            for side, sign in SIDES.items():
                target = Vector((sign * anchor.x, anchor.y, anchor.z))
                rail = CableStation.part(side + " core bench grip", Barbell.SHAFT, frame)
                root = self.point((sign * .16, y + length * .40, -.115))
                end = target + Vector((sign * .12, 0, 0))
                brace = CableStation.part("core bench grip brace", .023, frame)
                set_segment(rail, target - Vector((sign * .12, 0, 0)), end, 1)
                set_segment(brace, root, end, 1)
                self.handles[side] = rail
                self.parts.extend(((rail, True), (brace, False)))
        else:
            platform = SupportPad("ankle station footplate", {
                "face": self.point((0, -.59, 0)), "size": [.40, .32], "pitch": self.angle, "split": True,
            }, foam, frame)
            self.contacts["plate"] = platform
            roller = Vector(config["roller"])
            roller = self.point(roller)
            pad = CableStation.part("ankle restraint roller", .032, foam)
            width = Vector((.22, 0, 0))
            set_segment(pad, roller - width, roller + width, 1)
            self.parts.append((pad, False))
            for sign in (-1, 1):
                strut = CableStation.part("ankle restraint bracket", .022, frame)
                set_segment(strut, self.point((sign * .22, -.42, -.04)), roller + width * sign, 1)
                self.parts.append((strut, False))
            link = CableStation.part("core bench spine", .033, frame)
            set_segment(link, self.point((0, -.72, -.095)), self.point((0, y, -.095)), 1)
            self.parts.append((link, False))
            self.roller = roller

    def point(self, offset):
        return self.top + self.rotation @ Vector(offset)

    def trunk(self, key):
        if not self.flag:
            key["pelvis"] = self.point(key["pelvis"])
            key["lean"] += self.angle

    def anchor_flag(self, contact):
        # Keep the middle of the shoulder girdle over one spot on the pad, then
        # settle the dorsal skin against the surface before solving the hands.
        hips = head("Hips")
        shoulder = (head("LeftArm") + head("RightArm")) / 2
        hips.y += self.pad.face.y + self.pad.length / 2 - .008 - shoulder.y
        place("Hips", world_rotation("Hips"), hips)
        points, _ = evaluated_points(body)
        back = points[contact.upper_back_vertices]
        over = np.abs(back[:, 1] - self.pad.face.y) < self.pad.length / 2
        hips.z += self.pad.face.z - back[over, 2].min() + .003
        place("Hips", world_rotation("Hips"), hips)

    def pose(self, torso, gaps):
        if self.flag:
            for side, sign in SIDES.items():
                target = self.handles[side].matrix_world.translation
                pole = torso.direction([.38, 1, 0], sign)
                gap = pose_arm(side, target, pole, "pronated", torso, Vector((1, 0, 0)))
                gaps.append((side + " core bench grip", gap))

    def check(self, points, contact, hands, grips, frame, phase, problems, samples, spec):
        contact.check_supine_neck(frame, problems)
        check_hardware_clearance(self.parts, points, contact.faces, hands, grips, frame, problems)
        check_rendered_grips(self.handles, grips, frame, problems)
        self.pad.check(points, frame, problems)
        for pad in self.contacts.values():
            pad.check(points, frame, problems)
        if not self.flag:
            for side in SIDES:
                foot = points[contact.foot_vertices[side]]
                distance = np.linalg.norm(foot[:, 1:] - np.array(self.roller)[1:], axis=1).min()
                if distance > .041:
                    problems.add(frame, side + " ankle loses restraint contact", distance - .032)
        for key, indices in (
            ("head_contact", contact.head_vertices),
            ("upper_back_contact", contact.upper_back_vertices),
            ("pelvis_contact", contact.pelvis_vertices),
        ):
            if any(start <= phase <= end for start, end in spec.get(key, ())):
                self.pad.check(points[indices], frame, problems)
        samples.append(np.array([obj.matrix_world @ Vector(v)
                                 for obj in scene.objects if obj.name.startswith(("core bench", "ankle "))
                                 for v in obj.bound_box]))


# ---------------------------------------------------------------- muscles, camera, checks


def light_up(muscles):
    for mesh in (body, bpy.data.objects["skin"]):
        count = len(mesh.data.vertices)
        glow = np.zeros(count)
        for level, groups in ((1.0, muscles.get("primary", [])), (0.4, muscles.get("secondary", []))):
            for group in groups:
                attribute = mesh.data.attributes.get(f"muscle:{group}")
                if attribute is None:
                    continue
                values = np.zeros(count)
                attribute.data.foreach_get("value", values)
                glow = np.maximum(glow, values * level)
        mesh.data.attributes["glow"].data.foreach_set("value", glow)


def evaluated_points(mesh):
    """The posed, subdivided surface, and which of its points belong to the hands."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = mesh.evaluated_get(depsgraph)
    data = evaluated.to_mesh()
    points = np.zeros(len(data.vertices) * 3)
    data.vertices.foreach_get("co", points)
    hand = np.zeros(len(data.vertices))
    data.attributes["hand"].data.foreach_get("value", hand)
    evaluated.to_mesh_clear()
    return points.reshape(-1, 3), hand > 0.5


def frame_camera(spec, view, angle, samples):
    camera = scene.camera
    if angle is None:
        angle = spec.get("camera", {}).get("angle", 30) + (180 if view == "back" else 0)
    angle = math.radians(angle)
    elevation = math.radians(spec.get("camera", {}).get("elevation", 12))
    lo, hi = samples.min(axis=0), samples.max(axis=0)
    centre = Vector((lo + hi) / 2)
    direction = Vector((-math.sin(angle) * math.cos(elevation), -math.cos(angle) * math.cos(elevation), math.sin(elevation)))
    camera.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    camera.location = centre + direction * 10
    update()
    location, _ = camera.camera_fit_coords(bpy.context.evaluated_depsgraph_get(), samples.ravel())
    # Back off a little so nothing touches the edge of the frame.
    camera.location = centre + (Vector(location) - centre) * spec.get("camera", {}).get("margin", 1.12)
    bpy.data.objects["lights"].rotation_euler = (0, 0, -angle)


def held_point(side, key, torso):
    """Where a hand's grip goes for an arm given as an upper-arm direction and an elbow bend.

    The upper arm points along `upper_arm` ([out, forward, up] on the torso). `curl` bends the elbow
    that many degrees, swinging the forearm forwards and up from straight, so between keys the hand
    travels round an arc about the elbow instead of cutting across it.
    """
    sign = SIDES[side]
    upper, fore = segment(f"{side}Arm", f"{side}ForeArm", f"{side}Hand")
    down = torso.direction(key["upper_arm"], sign)
    elbow = head(f"{side}Arm") + down * upper
    toward = torso.direction(key["flex_toward"], sign) if "flex_toward" in key else torso.forward
    ahead = (toward - down * toward.dot(down)).normalized()
    curl = math.radians(key["curl"])
    axis = ahead * math.cos(curl) - down * math.sin(curl)
    return axis, elbow + (down * math.cos(curl) + ahead * math.sin(curl)) * (fore + GRIP[side][0])


def supported_wrist(spec, span, side):
    """Flex a hand around a stationary wrist with the shaft transverse to the forearm."""
    wrist = Vector(spec["wrist_rest"])
    wrist.x *= SIDES[side]
    rotation = Matrix.Rotation(-math.radians(span.sample("hand_pitch")), 3, "X")
    along = rotation @ Vector((0,-1,0))
    palm = rotation @ Vector((0,0,1 if spec["grip"] == "supinated" else -1))
    return wrist + along*GRIP[side][0] + palm*GRIP[side][1], (along, palm)


def planar_grip(pitch):
    """A pronated hand rotating around the shaft as it turns over."""
    angle = math.radians(pitch)
    along = Vector((0, -math.cos(angle), math.sin(angle)))
    return along, Vector((1, 0, 0)).cross(along)


def arm_arc_target(side, elbow_x, upper_pitch, grip_x, hand_frame):
    """Keep the elbow on an authored arc and derive the grip from both limb lengths."""
    shoulder = head(side + "Arm")
    upper, fore = segment(side + "Arm", side + "ForeArm", side + "Hand")
    dx, fore_x = elbow_x - shoulder.x, grip_x - elbow_x
    upper_radius = math.sqrt(upper ** 2 - dx ** 2)
    angle = math.radians(upper_pitch)
    pole = Vector((dx, -upper_radius * math.cos(angle), upper_radius * math.sin(angle)))
    along, palm = hand_frame
    wrist = shoulder + pole + Vector((fore_x, 0, 0)) + along * math.sqrt(fore ** 2 - fore_x ** 2)
    grip = wrist + along * GRIP[side][0] + palm * GRIP[side][1]
    return grip, pole


def bar_centre(target, torso):
    if isinstance(target, list):
        return Vector(target)
    if target["at"] == "lockout":
        shoulder = head("LeftArm")
        y = target["y"]
        height = vertical_arm_reach(target["grip_width"] - shoulder.x, y - shoulder.y, target.get("slack", .0003))
        return Vector((0, y, shoulder.z + height))
    return torso.point(LANDMARKS[target["at"]]) + torso.point(target.get("offset", (0, 0, 0))) - torso.origin + Vector(target.get("world_offset", (0, 0, 0)))


class Problems:
    """Collects check failures and reports each kind once, with the frames it covers and its worst size."""

    def __init__(self):
        self.found = {}

    def add(self, frame, what, size, unit="cm"):
        frames, worst, _ = self.found.get(what, ([], 0.0, unit))
        self.found[what] = (frames + [frame], max(worst, size), unit)

    def lines(self):
        for what, (frames, worst, unit) in self.found.items():
            span = f"frames {frames[0]}-{frames[-1]}" if len(frames) > 1 else f"frame {frames[0]}"
            size = worst * 100 if unit == "cm" else worst
            yield f"{what}: {size:.2f} {unit} at worst, {span} ({len(frames)} frames)" if frames[0] else f"{what}: {size:.2f} {unit}"


# Body parts by bone, and the two parts either side of each hinge.
PARTS = {"Hips": "trunk", "Spine": "trunk", "Spine1": "trunk", "Spine2": "trunk"}
for _side in SIDES:
    PARTS.update({f"{_side}{bone}": f"{_side} {part}" for bone, part in (
        ("Arm", "upper arm"), ("ArmSwing", "upper arm"), ("ForeArm", "forearm"), ("ForeArmRoll", "forearm"),
        ("UpLeg", "thigh"), ("Leg", "shin"))})
HINGES = {pair for side in SIDES for x, y in (("trunk", f"{side} thigh"), (f"{side} thigh", f"{side} shin"),
                                               (f"{side} upper arm", f"{side} forearm")) for pair in (f"{x}|{y}", f"{y}|{x}")}


class SkinContact:
    """Measure crossing triangles on non-neighbouring parts of the skin cage."""

    def __init__(self):
        body.data.calc_loop_triangles()
        self.faces = [tuple(t.vertices) for t in body.data.loop_triangles]
        self.vertices = np.asarray(self.faces)
        rest = [v.co.copy() for v in body.data.vertices]
        self.centres = np.asarray(rest)[self.vertices].mean(axis=1)
        self.rest_pairs = set(self.crossings(rest))
        # Which side of a hinge each face is on. Across a deeply bent hip, knee or elbow, the
        # flesh either side presses together inside a closed crease, as real flesh does.
        names = {group.index: group.name for group in body.vertex_groups}
        owner = [names[max(v.groups, key=lambda g: g.weight).group] if v.groups else "" for v in body.data.vertices]
        self.part = np.array([PARTS.get(owner[i], owner[i]) for i in self.vertices[:, 0]])
        self.foot_vertices = {
            side: [i for i, name in enumerate(owner) if name in (side + "Foot", side + "ToeBase")]
            for side in SIDES
        }
        self.trunk_vertices = [i for i, name in enumerate(owner) if PARTS.get(name) == "trunk"]

        self.pelvis_vertices = [i for i, name in enumerate(owner) if name == "Hips"]
        self.lumbar_vertices = [i for i, name in enumerate(owner) if name == "Spine"]
        self.upper_back_vertices = [i for i, name in enumerate(owner) if name == "Spine2"]

        self.head_vertices = [i for i, name in enumerate(owner) if name == "Head"]

    def check_supine_neck(self, frame, problems):
        torso = Torso()
        for bone in ("Neck", "Head"):
            forward = world_rotation(bone) @ REST[bone].transposed() @ Vector((0, -1, 0))
            pitch = math.degrees(math.atan2(-forward.dot(torso.up), forward.dot(torso.forward)))
            if pitch < -5:
                problems.add(frame, bone + " extends during supine support", -pitch, "degrees")

    def check_supine_support(self, frame, points, support, phase, problems):
        self.check_supine_neck(frame, problems)
        regions = []
        for key, label, vertices, maximum, default in (
            ("pelvis_contact", "pelvis", self.pelvis_vertices, .012, [[0, 1]]),
            ("lumbar_contact", "lower back", self.lumbar_vertices, .028, [[0, 1]]),
            ("head_contact", "head", self.head_vertices, .008, []),
            ("upper_back_contact", "upper back", self.upper_back_vertices, .012, []),
        ):
            if any(start <= phase <= end for start, end in support.get(key, default)):
                regions.append((label, vertices, maximum))
        if support.get("feet"):
            regions.extend((side + " foot", vertices, .010) for side, vertices in self.foot_vertices.items())
        for label, vertices, maximum in regions:
            gap = points[vertices, 2].min()
            if gap > maximum:
                problems.add(frame, label + " loses supine floor support", gap)
            if gap < -.006:
                problems.add(frame, label + " penetrates the floor", -gap)

    def check_side_support(self, frame, points, palm, problems, bench=None):
        hips = (head("LeftUpLeg") + head("RightUpLeg")) / 2
        ankles = head("RightFoot") if bench else (head("LeftFoot") + head("RightFoot")) / 2
        body_line = math.degrees((hips - ankles).angle(Torso().up))
        if body_line > 5:
            problems.add(frame, "hips break the side plank line", body_line, "degrees")
        head_to_ankles = head("Head") - ankles
        shoulders = (head("LeftArm") + head("RightArm")) / 2
        for label, point in (("hips", hips), ("shoulders", shoulders)):
            offset = (point - ankles).cross(head_to_ankles).length / head_to_ankles.length
            if offset > .035:
                problems.add(frame, label + " leave the head-to-heel line", offset)
        shoulder, elbow, wrist = (head("Left" + bone) for bone in ("Arm", "ForeArm", "Hand"))
        upper_arm = shoulder - elbow
        offset = upper_arm.xy.length
        if offset > .025:
            problems.add(frame, "support elbow is not under the shoulder", offset)
        vertical = math.degrees(upper_arm.angle(Vector((0, 0, 1))))
        if vertical > 6:
            problems.add(frame, "support upper arm is not vertical", vertical, "degrees")
        axis = wrist - elbow
        forward = Torso().forward
        forward.z = 0
        direction = math.degrees(axis.angle(forward))
        if direction > 8:
            problems.add(frame, "support forearm does not point forward along the floor", direction, "degrees")
        forearm = points[np.unique(self.vertices[self.part == "Left forearm"])]
        progress = (forearm - np.array(elbow)) @ np.array(axis) / axis.length_squared
        edges = (0, .23, .48, .73, .97)
        for index, (start, end) in enumerate(zip(edges, edges[1:]), 1):
            heights = forearm[(progress >= start) & (progress < end), 2]
            gap = heights.min(initial=1)
            if not -.006 <= gap <= .008 or np.count_nonzero(heights <= .012) < 3:
                problems.add(frame, f"ulna section {index} loses floor contact", abs(gap))
        height = points[self.foot_vertices["Left"], 2].min()
        if not bench and not -.006 <= height <= .008:
            problems.add(frame, "lower foot loses side support contact", abs(height))
        transform = palm.transform
        heights = palm.points @ np.array(transform.to_3x3().row[2]) + transform.translation.z
        if heights.min() < -.002 or np.count_nonzero(np.abs(heights) < .004) < 20:
            problems.add(frame, "lower palm loses side support contact", abs(heights.min()))
        if bench:
            gap = bench.gap(points[self.foot_vertices["Right"]])
            if not -.006 <= gap <= .010:
                problems.add(frame, "upper foot loses Copenhagen bench support", abs(gap))
            return
        lower_faces = self.vertices[np.isin(self.vertices, self.foot_vertices["Left"]).all(axis=1)]
        lower_foot = BVHTree.FromPolygons(points.tolist(), lower_faces.tolist(), all_triangles=True)
        upper_points = points[self.foot_vertices["Right"]]
        # Use the lower edge of the upper foot so a shank or stray toe cannot satisfy the stack.
        edge = upper_points[upper_points[:, 2] < upper_points[:, 2].min() + .020]
        gap = min(lower_foot.find_nearest(Vector(point))[3] for point in edge)
        if gap > .012:
            problems.add(frame, "upper foot loses its stack", gap)

    def check_prone_support(self, frame, points, problems):
        for label, vertices in (("front of the pelvis", self.pelvis_vertices), ("abdomen", self.lumbar_vertices)):
            gap = points[vertices, 2].min()
            if not -.008 <= gap <= .016:
                problems.add(frame, label + " loses prone floor support", abs(gap))

    def check_unsupported_feet(self, frame, points, clearances, problems):
        for side, minimum in clearances.items():
            height = points[self.foot_vertices[side], 2].min()
            if height < minimum:
                problems.add(frame, side + " unsupported foot is too close to the floor", minimum - height)

    def check_grounded_heels(self, frame, points, sides, problems):
        for side in sides:
            heel_y = rig.data.bones[side + "Foot"].head_local.y - .035
            heel = [i for i in self.foot_vertices[side] if body.data.vertices[i].co.y >= heel_y]
            gap = points[heel, 2].min()
            if not -.006 <= gap <= .008:
                problems.add(frame, side + " heel loses floor contact", abs(gap))

    def check_kneeling_support(self, frame, points, support, phase, frame_checks, problems):
        for side in SIDES:
            if any(check.get("hand_mode") == "floor-plant" and check.get("side", side) == side
                   for check in frame_checks):
                gap = (head(side + "Arm") - head(side + "Hand")).xy.length
                if gap > .030:
                    problems.add(frame, side + " shoulder is not over the wrist", gap)
        for side, intervals in support.items():
            if not any(start <= phase <= end for start, end in intervals):
                continue
            offset = (head(side + "UpLeg") - head(side + "Leg")).xy.length
            if offset > .030:
                problems.add(frame, side + " hip is not over the knee", offset)
            triangles = self.vertices[np.isin(self.part, (side + " thigh", side + " shin"))]
            vertices = points[np.unique(triangles)]
            near = np.linalg.norm(vertices - np.array(head(side + "Leg")), axis=1) < .105
            gap = vertices[near, 2].min(initial=1)
            if not -.006 <= gap <= .008:
                problems.add(frame, side + " knee loses floor support", abs(gap))

    def check_resting_forearms(self, frame, points, problems):
        for side in SIDES:
            thighs = self.vertices[self.part == side + " thigh"]
            forearms = np.unique(self.vertices[self.part == side + " forearm"])
            tree = BVHTree.FromPolygons(points.tolist(), thighs.tolist(), all_triangles=True)
            distances = sorted(tree.find_nearest(Vector(point))[3] for point in points[forearms])
            if distances[3] > .008:
                problems.add(frame, side + " forearm loses thigh support", distances[3])

    def crossings(self, points):
        tree = BVHTree.FromPolygons(points, self.faces, all_triangles=True)
        return ((a, b) for a, b in tree.overlap(tree)
                if a < b and set(self.faces[a]).isdisjoint(self.faces[b]))

    def check(self, frame, points, problems):
        pairs = list(set(self.crossings(points.tolist())) - self.rest_pairs)
        if not pairs:
            return
        a, b = np.asarray(pairs).T

        def depth(source, target):
            tri = points[self.vertices[target]]
            normal = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
            normal /= np.maximum(np.linalg.norm(normal, axis=1)[:, None], 1e-12)
            distances = ((points[self.vertices[source]] - tri[:, :1]) * normal[:, None]).sum(axis=2)
            return -distances.min(axis=1)
        overlap = np.minimum(depth(a, b), depth(b, a))
        nearby = np.linalg.norm(self.centres[a] - self.centres[b], axis=1) < .15
        pair = np.char.add(np.char.add(self.part[a], "|"), self.part[b])
        hinge = np.isin(pair, list(HINGES))
        for mask, limit, label in ((hinge, .03, "flesh presses together across a bent joint"),
                                   (nearby & ~hinge, .02, "local skin fold"),
                                   (~nearby & ~hinge, .01, "distant skin contact")):
            if mask.any() and overlap[mask].max() > limit:
                problems.add(frame, label, overlap[mask].max())


class ElbowSection:
    """Track the same loop of skin through the pose, including points between cage vertices."""

    def __init__(self, side):
        self.side = side
        rest = np.array([v.co[:] for v in body.data.vertices])
        edges = np.array([e.vertices[:] for e in body.data.edges])
        joint = rig.data.bones[f"{side}ForeArm"].head_local
        normal = (rig.data.bones[f"{side}Hand"].head_local - rig.data.bones[f"{side}Arm"].head_local).normalized()
        offsets = rest - np.array(joint)
        distances = offsets @ normal
        a, b = edges.T
        crosses = (distances[a] * distances[b] < 0) & (np.linalg.norm(offsets[a], axis=1) < 0.09)
        self.a, self.b = edges[crosses].T
        if len(self.a) < 6:
            raise ValueError(f"Cannot sample the {side} elbow section on this mesh")
        self.fraction = (distances[self.a] / (distances[self.a] - distances[self.b]))[:, None]
        ring = self.section(rest) - joint
        x = normal.orthogonal().normalized()
        order = np.argsort(np.arctan2(ring @ normal.cross(x), ring @ x))
        self.a, self.b, self.fraction = self.a[order], self.b[order], self.fraction[order]
        self.rest_area = self.area(self.section(rest))
        self.minimum = math.inf
        self.maximum = 0

    def section(self, points):
        return points[self.a] + (points[self.b] - points[self.a]) * self.fraction

    @staticmethod
    def area(ring):
        ring = ring - ring.mean(axis=0)
        return np.linalg.norm(np.cross(ring, np.roll(ring, -1, axis=0)).sum(axis=0)) / 2

    def check(self, frame, points, problems):
        ratio = self.area(self.section(points)) / self.rest_area
        self.minimum = min(self.minimum, ratio)
        self.maximum = max(self.maximum, ratio)
        if not 0.75 <= ratio <= 1.35:
            problems.add(frame, f"{self.side} elbow section changes excessively", abs(1 - ratio) * 100, "%")


class ShoulderShape:
    """Measure local stretch across the pec and shoulder on the posed skin cage."""

    def __init__(self, side):
        self.side = side
        rest = np.array([v.co[:] for v in body.data.vertices])
        edges = np.array([e.vertices[:] for e in body.data.edges])
        x, y, z = rest.T
        x = x * SIDES[side]
        # Sample contiguous skin in rest space, including the front armpit crease, measured
        # from the shoulder joint.
        joint = rig.data.bones[f"{side}Arm"].head_local
        z = z - joint.z
        regions = {
            "pectoral": (x > .03) & (x < .15) & (z > -.145) & (z < .005) & (y < joint.y - .03),
            "shoulder": (x > .13) & (x < .235) & (z > -.095) & (z < .065),
            "armpit": (x > .12) & (x < .23) & (z > -.165) & (z < -.055),
        }
        self.patches = {}
        self.worst = {}
        for name, mask in regions.items():
            a, b = edges[mask[edges].all(axis=1)].T
            if len(a) < 20:
                raise ValueError(f"Cannot sample {side} {name}")
            self.patches[name] = a, b, np.linalg.norm(rest[a] - rest[b], axis=1)

    def check(self, frame, points, problems):
        for name, (a, b, lengths) in self.patches.items():
            stretch = np.linalg.norm(points[a] - points[b], axis=1) / lengths
            # The broad pec and pit distort across a patch. Axial twist makes
            # a narrower ridge on the deltoid, so sample its upper tail.
            # Calibrated on the MakeHuman body, whose long edges round the shoulder stretch
            # further than a sculpt's in a raised arm without the surface distorting.
            percentile, limit = {"pectoral": (95, 1.55), "shoulder": (99, 2.9),
                                 "armpit": (95, 2.1)}[name]
            upper = float(np.percentile(stretch, percentile))
            self.worst[name] = max(self.worst.get(name, 1), upper)
            if upper > limit:
                problems.add(frame, f"{self.side} {name} skin stretches excessively", (upper - 1) * 100, "%")


class GripSurface:
    """Check the rigid subset of the continuous skin, independently of the IK grip target.

    Transform the shaft into rest space on every frame using the same hand bone
    and rigid weights as the rendered mesh.
    """
    def __init__(self, side):
        self.side = side
        self.skin = bpy.data.objects["skin"]
        self.bone = bones[side + "Hand"]
        mesh = self.skin.data
        marker = self.skin.vertex_groups["GripSurface." + side].index
        hand = self.skin.vertex_groups[side + "Hand"].index
        deform = {g.index for g in self.skin.vertex_groups if g.name in bones}
        indices = []
        for vertex in mesh.vertices:
            weights = {g.group: g.weight for g in vertex.groups}
            if marker in weights:
                if {g:w for g,w in weights.items() if g in deform and w} != {hand:1.0}:
                    raise RuntimeError(f"{side} grip surface must be rigid")
                indices.append(vertex.index)
        mesh.calc_loop_triangles()
        triangles = np.empty(3 * len(mesh.loop_triangles), dtype=np.int32)
        mesh.loop_triangles.foreach_get("vertices", triangles)
        lookup = np.full(len(mesh.vertices), -1, dtype=np.int32)
        lookup[indices] = np.arange(len(indices))
        triangles = lookup[triangles.reshape(-1,3)]
        self.triangles = triangles[np.all(triangles >= 0, axis=1)]
        self.points = np.array([mesh.vertices[i].co[:] for i in indices])
        self.surface = BVHTree.FromPolygons(self.points.tolist(), self.triangles.tolist(), all_triangles=True)
        self.axis = Vector(self.skin["grip_axis." + side])
        self.origin = Vector(self.skin["grip_origin." + side])
        self.sections = self.skin["grip_sections." + side]
        self.cache = {}
        self.metrics = {"penetration_mm": 0, "gap_mm": 0, "wrist_degrees": 0, "coverage_degrees": 360}

    def record_contact(self, distance):
        """Track face contact separately from the shaft enclosure measured for fists."""
        if not hasattr(self, "contact_metrics"):
            self.contact_metrics = {"penetration_mm": 0., "gap_mm": 0.}
        for key, value in (("penetration_mm", -distance), ("gap_mm", distance)):
            self.contact_metrics[key] = max(self.contact_metrics[key], value * 1000)

    @property
    def transform(self):
        return self.skin.matrix_world @ self.bone.matrix @ self.bone.bone.matrix_local.inverted()

    def check(self, frame, centre, axis, radius, problems):
        inverse = self.transform.inverted()
        centre = inverse @ centre
        axis = (inverse.to_3x3() @ axis).normalized()
        # Cache only an unchanged rigid shaft/skin relationship, to one micrometre.
        # Translation along the shaft does not affect cylindrical contact. The actual
        # object transform and wrist angle are still checked on every frame.
        local_centre = centre - axis * (centre-self.origin).dot(axis)
        key = tuple(round(v, 6) for v in (*local_centre, *axis, radius))
        if key not in self.cache:
            issues = Problems()
            self.geometry(local_centre, axis, radius, issues)
            self.cache[key] = issues.found
        for what, (_, size, unit) in self.cache[key].items():
            problems.add(frame, what, size, unit)
        self.check_wrist(frame, problems)

    def check_wrist(self, frame, problems):
        forearm = world_rotation(f"{self.side}ForeArm").col[1]
        hand = world_rotation(f"{self.side}Hand").col[1]
        angle = math.degrees(forearm.angle(hand))
        self.metrics["wrist_degrees"] = max(self.metrics["wrist_degrees"], angle)
        if angle > 40:
            problems.add(frame, f"{self.side} wrist bend exceeds 40 degrees", angle, "degrees")

    def shaft_distance(self, centre, axis):
        offset = self.points - np.array(centre)
        radial = offset - (offset @ np.array(axis))[:, None] * np.array(axis)
        # Exact distance from the shaft axis to every triangle, including its
        # interior and edges. Checking vertices alone misses a face crossing the bar.
        triangles = radial[self.triangles]
        distances, signs = [], []
        for i in range(3):
            a, b = triangles[:, i], triangles[:, (i+1) % 3]
            edge = b-a
            fraction = np.clip(-np.einsum('ij,ij->i', a, edge) / np.maximum(np.einsum('ij,ij->i', edge, edge), 1e-20), 0, 1)
            distances.append(np.linalg.norm(a + fraction[:,None]*edge, axis=1))
            signs.append(np.cross(a,b) @ np.array(axis))
        signs = np.array(signs)
        enclosed = ((signs.min(axis=0) > 1e-12) | (signs.max(axis=0) < -1e-12))
        return 0 if enclosed.any() else np.min(distances)

    def geometry(self, centre, axis, radius, problems):
        frame = 0
        penetration = radius - self.shaft_distance(centre, axis)
        self.metrics["penetration_mm"] = max(self.metrics["penetration_mm"], float(penetration)*1000)
        if penetration > .0002:
            problems.add(frame, f"{self.side} fist skin penetrates the bar", penetration)
        alignment = abs(axis.dot(self.axis))
        if alignment < .999:
            problems.add(frame, f"{self.side} fist cavity is skew to the bar", .08 * math.sqrt(1-alignment**2))
        u = axis.orthogonal().normalized()
        v = axis.cross(u)
        for index, x in enumerate(self.sections):
            station = self.origin + self.axis * x
            on_axis = centre + axis * (station-centre).dot(axis)
            distances = []
            for i in range(32):
                angle = math.tau*i/32
                direction = u*math.cos(angle) + v*math.sin(angle)
                hit, _, _, distance = self.surface.ray_cast(on_axis, direction, radius+.04)
                distances.append(distance if hit is not None else math.inf)
            # Fingers and palm must surround at least 3/4 of the circumference at
            # every digit, with at least one actual contact patch per digit.
            missing = sum(d > radius+.01 for d in distances)
            self.metrics["coverage_degrees"] = min(self.metrics["coverage_degrees"], (32-missing)*360/32)
            if missing > 8:
                problems.add(frame, f"{self.side} digit {index+1} does not enclose the bar (open arc)", missing/32 * math.tau*radius)
            gap = min(distances)-radius
            self.metrics["gap_mm"] = max(self.metrics["gap_mm"], min(gap,.04)*1000)
            if gap > .003:
                problems.add(frame, f"{self.side} digit {index+1} floats off the bar", min(gap,.04))


def tucked(side, torso, problems, frame):
    """An elbow can't go in behind the back: it would have to pass through the body."""
    elbow = head(f"{side}ForeArm") - head(f"{side}Arm")
    inward = -elbow.dot(torso.left) * SIDES[side]
    if inward > 0.02 and elbow.dot(torso.forward) < 0.05:
        problems.add(frame, f"{side} elbow tucks in behind the back", inward)


def detail(on):
    """The smoothed surface is only needed for the final pictures; posing and checks use the plain one."""
    for modifier in body.modifiers:
        if modifier.type == "SUBSURF":
            modifier.levels = modifier.render_levels if on else 0


def wrist_collision_points():
    """Skin the actual transition vertices with the same weights as the render mesh.

    The topology checks use the MakeHuman cage. Its forearms end at the stitch,
    so equipment, floor and bench checks also need the flexible wrist surface.
    """
    skin = bpy.data.objects["skin"]
    cage = np.empty(len(skin.data.vertices), dtype=np.int32)
    skin.data.attributes["cage_point"].data.foreach_get("value", cage)
    markers = {skin.vertex_groups["GripSurface." + side].index for side in SIDES}
    vertices = [skin.data.vertices[int(i)] for i in np.flatnonzero(cage == 0)]
    wrist = [v for v in vertices if not any(g.group in markers for g in v.groups)]
    mesh = bpy.data.meshes.new("wrist collision points")
    mesh.from_pydata([v.co[:] for v in wrist], [], [])
    samples = bpy.data.objects.new(mesh.name, mesh)
    scene.collection.objects.link(samples)
    groups = {}
    for i, vertex in enumerate(wrist):
        for weight in vertex.groups:
            name = skin.vertex_groups[weight.group].name
            if name not in groups:
                groups[name] = samples.vertex_groups.new(name=name)
            groups[name].add([i], weight.weight, "REPLACE")
    modifier = samples.modifiers.new("wrist skin", "ARMATURE")
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    return samples


def shoulder_corrective(side, radius):
    """Spread high-elevation deltoid and armpit strain over the shoulder girdle."""
    joint = rig.data.bones[side + "Arm"].head_local
    group = body.vertex_groups.new(name=side + " shoulder corrective")
    for vertex in body.data.vertices:
        distance = (vertex.co - joint).length
        if distance < radius:
            group.add([vertex.index], min(1, (radius-distance)/.06), "REPLACE")
    mod = body.modifiers.new(group.name, "CORRECTIVE_SMOOTH")
    mod.vertex_group = group.name
    mod.smooth_type = "LENGTH_WEIGHTED"
    mod.factor = 1
    body.modifiers.move(len(body.modifiers)-1, 1)
    return mod


def movement_checkpoints(spec, frames):
    """Dispatch independent movement expectations at the closest baked frame."""
    scheduled = {}
    for check in spec.get("checkpoints", []):
        phase = check.get("at")
        if phase is not None and not 0 <= phase < 1:
            raise ValueError("Checkpoint phase must be in [0, 1)")
        unknown = set(check) - {"at", "during", "side", "elbow", "position", "handle_axis", "palm", "upper_arm_to_torso", "fixed_elbow_m", "head_pitch", "surface_gap", "hand_pitch", "wrist_bend", "knee", "shin_vertical", "hand_mode"}
        if unknown or not set(check) & {"elbow", "position", "handle_axis", "palm", "upper_arm_to_torso", "fixed_elbow_m", "head_pitch", "surface_gap", "hand_pitch", "wrist_bend", "knee", "shin_vertical", "hand_mode"}:
            raise ValueError(f"Invalid movement checkpoint: {check}")
        if check.get("side", "Left") not in SIDES:
            raise ValueError(f"Unknown checkpoint side: {check['side']}")
        if "during" in check:
            start, end = check["during"]
            if phase is not None or not 0 <= start < end <= 1:
                raise ValueError("Checkpoint interval must be an increasing pair in [0, 1]")
            times = [f for f in range(1, frames + 1) if start <= (f - 1) / frames < end]
        else:
            times = range(1, frames + 1) if phase is None else [min(frames, 1 + round(phase * frames))]
        for frame in times:
            scheduled.setdefault(frame, []).append(check)
    return scheduled


def check_movement(checks, frame, barbell, dumbbells, problems, initial=None, contact_load=None, landmine=None, cables=None):
    """Measure actual joints and rendered apparatus transforms in world coordinates."""
    for check in checks:
        for side in ([check["side"]] if "side" in check else SIDES):
            def joint(name):
                return head(side + name if side + name in bones else name)

            def bounds(label, value, limits, unit):
                lo, hi = limits
                if lo > hi:
                    raise ValueError(f"Reversed bounds for {label}")
                if not lo <= value <= hi:
                    problems.add(frame, f"{side} {label} outside [{lo}, {hi}] {unit}",
                                 max(lo-value, value-hi), "cm" if unit == "m" else unit)

            tool = barbell.root if barbell else dumbbells.roots.get(side) if dumbbells else None
            if contact_load:
                tool = contact_load.roots[side if contact_load.paired else "both"]
            if landmine:
                tool = landmine.handles.get(side)
            if cables:
                tool = cables.handles.get(side)
            if "surface_gap" in check:
                expected = check["surface_gap"]
                if contact_load is None:
                    raise ValueError("A surface gap checkpoint requires a face-held weight")
                landmark = Torso().point(LANDMARKS[expected["landmark"]])
                local = tool.matrix_world.inverted() @ landmark
                gap = contact_load.distance(np.array([local]), expected.get("upper_head", False))[0]
                bounds("load to " + expected["landmark"], max(0, gap), [0, expected["max_m"]], "m")
            if "hand_mode" in check:
                if check["hand_mode"] != "floor-plant":
                    raise ValueError(f"Unknown hand mode: {check['hand_mode']}")
                forearm = world_rotation(side + "ForeArm").col[1]
                rotation = world_rotation(side + "Hand")
                along = rotation.col[1]
                normal = rotation @ palm_axis(side)
                extension = math.degrees(math.atan2(forearm.dot(normal), forearm.dot(along)))
                bounds("floor-plant wrist extension", extension, [75, 100], "degrees")
            if "wrist_bend" in check:
                forearm = joint("Hand") - joint("ForeArm")
                along = world_rotation(side + "Hand").col[1]
                bounds("wrist bend", math.degrees(forearm.angle(along)), check["wrist_bend"], "degrees")
            if "hand_pitch" in check:
                along = world_rotation(side + "Hand").col[1]
                bounds("hand pitch", math.degrees(math.asin(max(-1, min(1, along.z)))), check["hand_pitch"], "degrees")
            if "head_pitch" in check:
                head_delta = world_rotation("Head") @ REST["Head"].transposed()
                forward = head_delta @ Vector((0, -1, 0))
                torso = Torso()
                pitch = math.degrees(math.atan2(-forward.dot(torso.up), forward.dot(torso.forward)))
                bounds("head pitch relative to torso", pitch, check["head_pitch"], "degrees")
            if "elbow" in check:
                upper = joint("ForeArm") - joint("Arm")
                fore = joint("Hand") - joint("ForeArm")
                bounds("elbow flexion", math.degrees(upper.angle(fore)), check["elbow"], "degrees")
            if "knee" in check or "shin_vertical" in check:
                thigh = joint("Leg") - joint("UpLeg")
                shin = joint("Foot") - joint("Leg")
                if "knee" in check:
                    bounds("knee flexion", math.degrees(thigh.angle(shin)), check["knee"], "degrees")
                if "shin_vertical" in check:
                    bounds("shin to vertical", math.degrees(shin.angle(Vector((0, 0, -1)))),
                           [0, check["shin_vertical"]], "degrees")
            if "upper_arm_to_torso" in check:
                upper = joint("ForeArm") - joint("Arm")
                bounds("upper arm to torso", math.degrees(upper.angle(-Torso().up)),
                       [0, check["upper_arm_to_torso"]], "degrees")
            if "fixed_elbow_m" in check:
                elbow = joint("ForeArm")
                anchor = initial.setdefault(side + " elbow anchor", elbow.copy())
                bounds("elbow drift", (elbow - anchor).length, [0, check["fixed_elbow_m"]], "m")
            if "position" in check:
                expected = check["position"]
                point = tool.matrix_world.translation if expected["point"] == "handle" else joint(expected["point"])
                if expected["point"] == "handle" and isinstance(barbell, BentBar):
                    point = barbell.handles[side].matrix_world.translation
                if "relative_to" in expected:
                    point = point - joint(expected["relative_to"])
                for axis in ("x", "y", "z"):
                    if axis in expected:
                        bounds(f'{expected["point"]} {axis}', getattr(point, axis), expected[axis], "m")
            for field in ("handle_axis", "palm"):
                if field not in check:
                    continue
                target = check[field]
                direction = Vector(target["direction"]).normalized()
                if direction.length < .99:
                    raise ValueError("Expected a nonzero checkpoint direction")
                if field == "palm":
                    direction.x *= SIDES[side]
                    actual = world_rotation(side + "Hand") @ palm_axis(side)
                    cosine = actual.dot(direction)
                else:
                    actual = tool.matrix_world.to_3x3().col[0].normalized()
                    if cables:
                        actual = tool.matrix_world.to_3x3().col[2].normalized()
                    if landmine:
                        actual = tool.matrix_world.to_3x3().col[2].normalized()
                    if contact_load:
                        actual = tool.matrix_world.to_3x3() @ contact_load.axis
                    if isinstance(barbell, BentBar):
                        actual = barbell.handles[side].matrix_world.to_3x3().col[2].normalized()
                    cosine = actual.dot(direction)
                    if not target.get("directed", False):
                        cosine = abs(cosine)
                angle = math.degrees(math.acos(max(-1, min(1, cosine))))
                bounds(field + " deviation", angle, [0, target["degrees"]], "degrees")


def bake(spec, keys):
    frames = spec.get("frames", 96)
    checkpoints = movement_checkpoints(spec, frames)
    FOREARM.clear()
    detail(False)
    equipment = [e["type"] for e in spec.get("equipment", [])]
    unknown = set(equipment) - {"barbell", "trap-bar", "ez-bar", "kettlebells", "dumbbells", "plate", "vertical-dumbbell", "landmine", "bench", "rack-pins", "platform", "cable", "selector-machine", "leg-roller", "leg-sled", "smith-rails", "calf-station", "hip-machine", "guided-squat", "assist-station", "trunk-station", "lateral-station", "treadmill", "cycle-station", "rowing-erg", "pullup-bar", "core-bench", "parallel-bars", "elliptical", "stair-climber", "wall-support", "rotary-torso", "thrust-station", "belt-squat", "resistance-band", "roman-chair", "nordic-bench", "captains-chair", "thigh-band", "hand-band", "plyo-box", "ab-wheel"}
    if unknown or len(equipment) != len(set(equipment)) or len(set(equipment) - {"bench","platform","rack-pins","smith-rails"}) > 1:
        raise ValueError(f"Unsupported equipment combination: {equipment}")
    barbell = None
    for item in spec.get("equipment", []):
        kind = item["type"]
        if kind in {"barbell", "ez-bar", "trap-bar"}:
            radius = item.get("plate_radius", Barbell.PLATE)
            if not .03 < radius <= .225:
                raise ValueError("Plate radius must clear the sleeve and fit a standard barbell")
            barbell = Barbell(radius) if kind == "barbell" else BentBar(kind, radius)
    db_spec = next((e for e in spec.get("equipment", []) if e["type"] == "dumbbells"), None)
    dumbbells = Dumbbells([db_spec["side"]] if "side" in db_spec else SIDES) if db_spec else None
    bell_spec = next((e for e in spec.get("equipment", []) if e["type"] == "kettlebells"), None)
    if bell_spec:
        dumbbells = Kettlebells([bell_spec["side"]] if "side" in bell_spec else SIDES, bell_spec.get("shared", False))
    bench = next((Bench(e["at"], e.get("length", 1.2), e.get("angle"), e.get("support", "back"), e.get("width", .30)) for e in spec.get("equipment", []) if e["type"] == "bench"), None)
    preacher = next((PreacherPad(e["arm_pad"]) for e in spec.get("equipment", []) if "arm_pad" in e), None)
    if preacher:
        bench.surfaces.extend(preacher.surfaces)
    contact_load = next((ContactLoad(e) for e in spec.get("equipment", []) if e["type"] in ("plate","vertical-dumbbell")),None)
    landmine = next((Landmine(e) for e in spec.get("equipment", []) if e["type"] == "landmine"), None)
    thigh_band = next((ThighBand(e) for e in spec.get("equipment", []) if e["type"] == "thigh-band"), None)
    plyo_box = next((PlyoBox(e) for e in spec.get("equipment", []) if e["type"] == "plyo-box"), None)
    ab_wheel = next((AbWheel(e) for e in spec.get("equipment", []) if e["type"] == "ab-wheel"), None)
    tension_stations = {"cable": CableStation, "resistance-band": BandStation, "hand-band": HandBand}
    cables = next((tension_stations[e["type"]](e) for e in spec.get("equipment", [])
                   if e["type"] in tension_stations), None)
    belt_squat = next((BeltSquatStation(e) for e in spec.get("equipment", []) if e["type"] == "belt-squat"), None)
    rotary = next((RotaryTorsoStation(e) for e in spec.get("equipment", []) if e["type"] == "rotary-torso"), None)
    hip_thrust = next((HipThrustStation(e) for e in spec.get("equipment", []) if e["type"] == "thrust-station"), None)
    nordic = next((NordicBench(e) for e in spec.get("equipment", []) if e["type"] == "nordic-bench"), None)
    captains_chair = next((CaptainsChair(e) for e in spec.get("equipment", []) if e["type"] == "captains-chair"), None)
    roman_chair = next((RomanChair(e) for e in spec.get("equipment", []) if e["type"] == "roman-chair"), None)
    treadmill = next((Treadmill(e) for e in spec.get("equipment", []) if e["type"] == "treadmill"), None)
    wall_config = next((e for e in spec.get("equipment", []) if e["type"] == "wall-support"), None)
    wall_feet = wall_config and wall_config.get("contact") == "feet"
    wall = SupportPad("wall toe contact" if wall_feet else "wall back contact", wall_config,
                      material("wall", (.12, .13, .145), .04, .72), None) if wall_config else None
    pullup = next((PullupBar(e) for e in spec.get("equipment", []) if e["type"] == "pullup-bar"), None)
    dip_bars = next((ParallelBars(e) for e in spec.get("equipment", []) if e["type"] == "parallel-bars"), None)
    standing_cardio_types = {"elliptical": Elliptical, "stair-climber": StairClimber}
    standing_cardio = next((standing_cardio_types[e["type"]](e) for e in spec.get("equipment", [])
                            if e["type"] in standing_cardio_types), None)
    rower = next((RowingErg(e) for e in spec.get("equipment", []) if e["type"] == "rowing-erg"), None)
    cycle = next((CycleStation(e) for e in spec.get("equipment", []) if e["type"] == "cycle-station"), None)
    lateral = next((LateralRaiseStation(e) for e in spec.get("equipment", []) if e["type"] == "lateral-station"), None)
    trunk_station = next((RotatingTrunkStation(e) for e in spec.get("equipment", []) if e["type"] == "trunk-station"), None)
    assist = next((AssistanceStation(e) for e in spec.get("equipment", []) if e["type"] == "assist-station"), None)
    guided_squat = next((GuidedSquat(e) for e in spec.get("equipment", []) if e["type"] == "guided-squat"), None)
    hip_machine = next((HipMachine(e) for e in spec.get("equipment", []) if e["type"] == "hip-machine"), None)
    calf = next((CalfStation(e) for e in spec.get("equipment", []) if e["type"] == "calf-station"), None)
    sled = next((LegSled(e) for e in spec.get("equipment", []) if e["type"] == "leg-sled"), None)
    roller = next((LegRollerMachine(e) for e in spec.get("equipment", []) if e["type"] == "leg-roller"), None)
    machine = next(((FlyMachine if e.get("motion") == "fly" else SelectorMachine)(e) for e in spec.get("equipment", []) if e["type"] == "selector-machine"), None)
    smith = next((SmithRails(e) for e in spec.get("equipment", []) if e["type"] == "smith-rails"), None)
    if smith and type(barbell) is not Barbell:
        raise ValueError("Smith rails require a straight bar")
    station = next((PullStation(e) for e in spec.get("equipment", []) if e["type"] in ("platform","rack-pins")), None)
    if station and not barbell:
        raise ValueError("Pull stations need a barbell")
    support_side = spec.get("support", {}).get("side")
    if support_side and (not bench or bench.pads or not dumbbells or support_side in dumbbells.roots):
        raise ValueError("A support hand needs a free arm and a flat bench")
    rack_contact = spec.get("rack_contact")
    cradle = spec.get("elbow_cradle")
    floor_hands = spec.get("floor_hands")
    if (rack_contact or cradle) and type(barbell) is not Barbell:
        raise ValueError("Open rack contact requires a straight barbell")
    core_bench = next((CoreBench(e) for e in spec.get("equipment", []) if e["type"] == "core-bench"), None)
    handled_station = next((item for item in (
        cables, machine, hip_machine, guided_squat, assist, trunk_station, lateral, ab_wheel,
        pullup, dip_bars, captains_chair, core_bench, standing_cardio, rower, cycle, belt_squat, rotary, hip_thrust, calf, roller,
    ) if item is not None and item.handles), None)
    for side in SIDES:
        shape = spec.get("hands", {}).get(side, "fist")
        if (side == support_side or floor_hands) and shape not in ("support", "diamond"):
            raise ValueError("Bench contact needs the open support hand")
        if rack_contact and shape == "fist":
            raise ValueError("Rack contact requires open hands")
        holds_handle = (barbell and not (rack_contact or cradle) or dumbbells and side in dumbbells.roots
                        or landmine and side in landmine.handles or handled_station and side in handled_station.handles)
        if holds_handle and shape != "fist":
            raise ValueError("A handle needs a closed fist")
        if contact_load and shape == "fist":
            raise ValueError("Face contact needs a pinch, cup or open hand")
        if rig.get("hand_shape." + side, "fist") != shape:
            raise ValueError("Scene hand shape does not match the spec")
    problems = Problems()
    planted_sides = {side for check in spec.get("checkpoints", []) if check.get("hand_mode") == "floor-plant"
                     for side in ([check["side"]] if "side" in check else SIDES)}
    if planted_sides and not floor_hands:
        raise ValueError("Floor-plant checkpoints need floor_hands")
    elevated_palms = spec.get("palm_support") == "bench"
    if elevated_palms and (not bench or bench.pads or not planted_sides):
        raise ValueError("Elevated palms need a flat bench and floor-plant checkpoints")
    side_support = spec.get("side_support")
    has_grips = side_support or barbell or dumbbells or contact_load or landmine or floor_hands or handled_station or "thigh_reach" in keys[0]
    grips = {side: GripSurface(side) for side in SIDES} if has_grips else {}
    relaxing = {side: relaxed_fingers(side, spec.get("relaxed_reach", False)) for side in planted_sides
                if any("plant_" + side.lower() in key for key in keys)}
    wrists = wrist_collision_points()
    wrist_points = np.empty((len(wrists.data.vertices), 3), dtype=np.float32)
    sections = [ElbowSection(side) for side in SIDES]
    contact = SkinContact()
    supine = spec.get("supine_support")
    shoulders = [ShoulderShape(side) for side in SIDES]
    pose_clavicles = any("clavicle" in key for key in keys)
    correctives = {}
    smooth = spec.get("shoulder_smoothing", {})
    onset, full = smooth.get("elevation_range", [-.22, .63])
    radius = smooth.get("radius", .27)
    if not -1 <= onset < full <= 1 or not .06 < radius <= .27:
        raise ValueError("Invalid shoulder smoothing range or radius")
    tracked = [f"{side}{bone}" for side in SIDES for bone in ("ForeArm", "Hand", "Leg", "Foot")]
    previous, first = {}, {}
    samples, closest = [], {"bar": math.inf, "bench": math.inf, "dumbbells": math.inf}
    if bench:
        samples.append(np.array([obj.matrix_world @ Vector(corner) for obj in scene.objects
                                 if obj.name.startswith("bench ") for corner in obj.bound_box]))
    ground_gait = spec.get("ground_gait")
    gait_contacts = {}
    waterline = spec.get("swimming")
    if waterline is not None:
        samples.extend(swim_surface(waterline))
    for frame in range(1, frames + 1):
        scene.frame_set(frame)
        for mod in correctives.values():
            mod.show_viewport = False
        phase = (frame - 1) / frames
        gait_phase = phase
        if ground_gait is not None:
            gait_phase = phase * ground_gait.get("cycles", 1) - ground_gait.get("surge", 0) * math.sin(math.tau * phase)
        span = PoseSpan(keys, gait_phase)
        a = span.keys[1]
        key = {field: span.sample(field) for field in ("pelvis", "lean", "spine", "head", "neck_retraction", "yaw", "roll", "side_bend", "torso_twist", "axial_twist") if field in a}
        if guided_squat:
            guided_squat.trunk(span, key, frame, problems)
        if core_bench:
            core_bench.trunk(key)
        pelvis = pose_trunk(key)
        if roman_chair:
            roman_chair.anchor(pelvis)
        if ab_wheel:
            ab_wheel.support(span, pelvis)
        if nordic:
            nordic.pose_legs(pelvis)
        if core_bench and core_bench.flag:
            core_bench.anchor_flag(contact)
        if "shoulder_y" not in a and "pelvis" not in key:
            raise ValueError("A pose needs a pelvis position or a suspended shoulder_y")
        if not pullup and "shoulder_y" in a:
            suspend_from_bar(span.sample("bar"), span.sample("grip_width", 0.25),
                             span.sample("shoulder_y"), pelvis)
        torso = Torso()
        if smith and isinstance(a.get("bar"), dict):
            target = span.sample("bar", resolve=lambda value: bar_centre(value, torso))
            hips = head("Hips")
            hips.y += smith.y - target[1]
            place("Hips", world_rotation("Hips"), hips)
            torso = Torso()
        # Set the shoulder girdle before solving hand contact. Retracting
        # the clavicles seats the upper back under a squat bar.
        if pose_clavicles:
            retract, elevate = np.radians(span.sample("clavicle", (0, 0)))
            for side, sign in SIDES.items():
                name = f"{side}Shoulder"
                direction = world_rotation(name).col[1]
                turn_back = Matrix.Rotation(sign * retract, 3, torso.up)
                turn_up = Matrix.Rotation(sign * elevate, 3, torso.forward)
                swing(name, turn_back @ turn_up @ direction)
        if pullup and not pullup.feet_supported:
            suspend_from_bar(pullup.centre, pullup.grip_width, span.sample("shoulder_y"), pelvis,
                             overhead=True, lift=span.sample("hang_lift", 0))
            torso = Torso()
        for field in ("foot_left", "foot_right", "supine_leg_left", "supine_leg_right", "free_leg_left", "free_leg_right", "knee_pole_left", "knee_pole_right"):
            if field in a:
                key[field] = span.sample(field)
        if sled:
            sled.pose(spec, span, key, frame, problems)
        activity_gaps = []
        if waterline is not None:
            pose_swim_stroke(keys, phase, torso, activity_gaps)
        if ground_gait is not None:
            pose_gait(keys, gait_phase, key, torso, activity_gaps, gait_contacts)
        if standing_cardio:
            standing_cardio.pose(spec, keys, phase, key, torso, frame, activity_gaps)
        if treadmill:
            treadmill.pose(spec, keys, phase, key, torso, frame, activity_gaps)
        if cycle:
            cycle.pose(spec, span, phase, key, torso, frame, activity_gaps)
        if assist:
            gaps = []
            assist.pose(span, torso, frame, gaps, problems)
        elif ab_wheel or nordic:
            gaps = []
        elif roman_chair:
            gaps = []
            roman_chair.pose_legs(gaps)
        elif spec.get("clamshell"):
            gaps = []
            pose_clamshell(pelvis, span.sample("opening"))
        elif spec.get("extended_legs"):
            gaps = []
            pose_extended_legs(pelvis, span.sample("abduction", 0))
        elif side_support:
            gaps = []
            pose_side_support(side_support, pelvis, torso, gaps)
        elif hip_machine:
            gaps = []
            hip_machine.pose(span, torso, frame, gaps, problems)
        elif roller:
            gaps = pose_legs(spec, {**a, **key}, pelvis, except_side=roller.side) if roller.side else []
            roller.pose_legs(span, frame, problems)
            roller.pose_grips(torso, gaps)
        else:
            gaps = pose_legs(spec, {**a, **key}, pelvis, support=core_bench if core_bench and not core_bench.flag else None)
        if core_bench:
            core_bench.pose(torso, gaps)
        gaps.extend(activity_gaps)
        if pullup:
            pullup.pose(span, torso, gaps)
        if dip_bars:
            dip_bars.pose(span, torso, gaps)
        if captains_chair:
            captains_chair.pose(torso, gaps)
        if rower:
            rower.pose(span, torso, frame, gaps)
        if belt_squat:
            belt_squat.pose(torso,frame,gaps)
        if rotary:
            rotary.pose(span,torso,frame,gaps,problems)
        if hip_thrust:
            hip_thrust.pose(span,torso,frame,gaps,problems)
        if lateral:
            lateral.pose(span, torso, frame, gaps, problems)
        if trunk_station:
            trunk_station.pose(span, torso, frame, gaps, problems)
        if guided_squat:
            guided_squat.pose(torso, frame, gaps)
        if calf:
            calf.pose(span, torso, frame, gaps, problems)
        if barbell:
            arc_pole = None
            if "arm_arc" in a:
                width = span.sample("grip_width", .25)
                elbow_x, upper_pitch = span.sample("arm_arc")
                frame_axes = planar_grip(span.sample("grip_pitch"))
                grip, arc_pole = arm_arc_target("Left", elbow_x, upper_pitch, width, frame_axes)
                centre = Vector((0, grip.y, grip.z))
            elif "wrist_rest" in a:
                target, _ = supported_wrist(a, span, "Left")
                centre = Vector((0,target.y,target.z))
            elif "overhead_y" in a:
                shoulder = head("LeftArm")
                y = span.sample("overhead_y")
                height = vertical_arm_reach(span.sample("grip_width") - shoulder.x, y - shoulder.y, .001)
                centre = Vector((0,y,shoulder.z + height))
            elif "upper_arm" in a:
                arms = {field: span.sample(field) for field in ("upper_arm", "curl")}
                if "flex_toward" in a:
                    arms["flex_toward"] = span.sample("flex_toward")
                _, target = held_point("Left", arms, torso)
                if a.get("fixed_upper_arm"):
                    # The bar fixes the lateral coordinate of the grip. Swivel the
                    # forearm about the stationary humerus to satisfy it at this bend.
                    pole = torso.direction(arms["upper_arm"])
                    upper, fore = segment("LeftArm", "LeftForeArm", "LeftHand")
                    elbow = head("LeftArm") + pole * upper
                    lower = (target - elbow).normalized()
                    if isinstance(barbell, BentBar):
                        offset, axis = barbell.grip("Left")
                        offset -= barbell.centre
                    else:
                        offset = Vector((span.sample("grip_width"), 0, 0))
                        axis = Vector((1, 0, 0))
                    lo, hi = -1.1, 1.1
                    for _ in range(24):
                        twist = (lo + hi) / 2
                        direction = Matrix.Rotation(twist, 3, pole) @ lower
                        along, palm = hand_on_bar(direction, palm_facing(a["grip"], direction, pole, torso, 1, axis), axis)
                        target = elbow + fore*direction + GRIP["Left"][0]*along + GRIP["Left"][1]*palm
                        if target.x > offset.x:
                            lo = twist
                        else:
                            hi = twist
                    target -= offset
                centre = Vector((0, target.y, target.z))
            else:
                centre = span.sample("bar", resolve=lambda target: bar_centre(target, torso))
            barbell.move(Vector(centre), frame)
            if smith:
                smith.move(barbell, frame, problems)
            width = a["wrist_rest"][0] if "wrist_rest" in a else span.sample("grip_width", 0.25)
            elbows = span.sample("elbows", [0.4, -0.6, -0.5])
            for side, sign in SIDES.items():
                if cradle:
                    wrist = barbell.centre + torso.point(cradle["wrist"], sign) - torso.origin
                    along = torso.direction(cradle["along"], sign)
                    palm = torso.direction(cradle["palm"], sign)
                    palm = (palm - along * palm.dot(along)).normalized()
                    target = wrist + along * GRIP[side][0] + palm * GRIP[side][1]
                    gap = pose_arm(side, target, torso.direction(elbows, sign), "neutral",
                                   torso, contact_frame=(along, palm))
                    gaps.append((side + " cradle wrist", gap))
                    continue
                if rack_contact:
                    pole = torso.direction(elbows, sign)
                    gap = barbell.pose_open_hand(side, rack_contact, pole, torso, grips[side], frame, problems)
                    gaps.append((f"{side} rack hand", gap))
                    tucked(side, torso, problems, frame)
                    continue
                grip_point = Vector(centre) + Vector((sign * width, 0, 0))
                axis = Vector((1, 0, 0))
                if isinstance(barbell, BentBar):
                    grip_point, axis = barbell.grip(side)
                hand_frame = supported_wrist(a, span, side)[1] if "wrist_rest" in a else None
                if "grip_pitch" in a:
                    hand_frame = planar_grip(span.sample("grip_pitch"))
                pole = torso.direction(elbows, sign)
                if arc_pole is not None:
                    pole = Vector((sign * arc_pole.x, arc_pole.y, arc_pole.z))
                gap = pose_arm(side, grip_point, pole, a.get("grip", "pronated"), torso, axis, hand_frame)
                gaps.append((f"{side} hand", gap))
                # The bar has to sit in the palm, where the fingers can close round it.
                hand = world_rotation(f"{side}Hand")
                held = head(f"{side}Hand") + hand.col[1] * GRIP[side][0] + hand @ palm_axis(side) * GRIP[side][1]
                miss = (held - grip_point).length
                if miss > 0.01:
                    problems.add(frame, f"{side} hand misses the bar", miss)
                grips[side].check(frame, grip_point, axis, barbell.SHAFT, problems)
                surface = grips[side]
                transform = surface.transform
                outer = abs(surface.points @ np.array(transform.to_3x3().row[0]) + transform.translation.x - centre[0]).max()
                if isinstance(barbell, BentBar):
                    # The wrist can clear the outer collar while the fist overlaps a bend.
                    handle = barbell.handles[side]
                    to_axis = np.array(transform.to_3x3().transposed() @ axis)
                    offset = (transform.translation - grip_point).dot(axis)
                    half_span = max(v.co.z for v in handle.data.vertices)
                    excess = np.abs(surface.points @ to_axis + offset).max() - half_span
                    if excess > 0:
                        problems.add(frame, f"{side} fist extends past the straight grip", excess)
                if outer > barbell.INNER:
                    problems.add(frame, f"{side} fist reaches the bar collar", outer - barbell.INNER)
                tucked(side, torso, problems, frame)
        if landmine:
            landmine.pose(span, frame)
            for side, sign in SIDES.items():
                pole = torso.direction(span.sample("elbows", [.3,-.4,-1]), sign)
                if side in landmine.handles:
                    part = landmine.handles[side]
                    centre = part.matrix_world.translation
                    axis = part.matrix_world.to_3x3().col[2].normalized()
                    gap = pose_arm(side, centre, pole, a.get("grip", "pronated"), torso, axis)
                    grips[side].check(frame, centre, axis, landmine.SHAFT, problems)
                    transform = grips[side].transform
                    axial = grips[side].points @ np.array(transform.to_3x3().transposed() @ axis)
                    axial += (transform.translation-centre).dot(axis)
                    excess = np.abs(axial).max() - max(v.co.z for v in part.data.vertices)
                    if excess > 0:
                        problems.add(frame, side+" fist extends past landmine grip", excess)
                else:
                    target = head(side+"Arm") + torso.direction(span.sample("free_arm", [.23,.17,-1]),sign)*.50
                    gap = pose_arm(side, target, pole, "neutral", torso)
                gaps.append((side+" hand", gap))
        if machine:
            machine.pose(span, torso, grips, frame, gaps, problems)
        if ab_wheel:
            ab_wheel.pose(span, torso, frame, gaps)
        if cables:
            cables.pose(span, torso, grips, frame, gaps, problems)
        if contact_load:
            contact_load.pose(spec,span,torso,grips,frame,gaps,problems)
        if "support" in spec:
            support = spec["support"]
            side = support["side"]
            along, palm = Vector((0,-1,0)), Vector((0,0,-1))
            target = Vector(support["wrist"]) + along*GRIP[side][0] + palm*GRIP[side][1]
            gap = pose_arm(side, target, torso.direction([.22,-.7,-1], SIDES[side]), "pronated",
                           torso, contact_frame=(along, palm))
            gaps.append((side + " support wrist", gap))
            surface = grips[side]
            posed = surface.points @ np.array(surface.transform.to_3x3()).T + np.array(surface.transform.translation)
            on_pad = ((np.abs(posed[:,0]-bench.top.x) <= .15) &
                      (np.abs(posed[:,1]-bench.top.y) <= bench.length/2))
            height = posed[:,2]-bench.top.z
            surface.record_contact(height[on_pad].min(initial=1))
            if height[on_pad].min(initial=1) < -.002 or np.count_nonzero(on_pad & (np.abs(height)<.004)) < 20:
                problems.add(frame, side + " open palm loses bench contact", abs(height[on_pad].min(initial=1)))
        if "paired_reach" in spec:
            for side, sign in SIDES.items():
                wrist = torso.point(spec["paired_reach"], sign)
                along = torso.direction([-.22, 1, .05], sign)
                inward = -torso.left * sign
                palm = (inward - along * along.dot(inward)).normalized()
                target = wrist + along * GRIP[side][0] + palm * GRIP[side][1]
                pole = torso.direction([.32, .62, -.70], sign)
                gap = pose_arm(side, target, pole, "neutral", torso, contact_frame=(along, palm))
                gaps.append((side + " paired hand", gap))
        if spec.get("temple_hands"):
            turn_head = world_rotation("Head") @ REST["Head"].transposed()
            for side, sign in SIDES.items():
                wrist = head("Head") + turn_head @ Vector((sign * .192, -.016, .03))
                along = (turn_head @ Vector((-sign * .66, 0, .75))).normalized()
                inward = turn_head @ Vector((-sign, 0, 0))
                palm = (inward - along * along.dot(inward)).normalized()
                target = wrist + along * GRIP[side][0] + palm * GRIP[side][1]
                pole = torso.direction([1, .27, -.10], sign)
                gap = pose_arm(side, target, pole, "neutral", torso, contact_frame=(along, palm))
                gaps.append((side + " temple hand", gap))
        if "thigh_reach" in a:
            skin, _ = evaluated_points(body)
            for side, sign in SIDES.items():
                hip, knee = head(side + "UpLeg"), head(side + "Leg")
                along = (knee - hip).normalized()
                normal = along.cross(Vector((1, 0, 0))).normalized()
                triangles = contact.vertices[contact.part == side + " thigh"]
                thigh = BVHTree.FromPolygons(skin.tolist(), triangles.tolist(), all_triangles=True)
                centre = hip.lerp(knee, span.sample("thigh_reach"))
                hit, outward, _, _ = thigh.ray_cast(centre + normal * .20, -normal, .20)
                if hit is None:
                    problems.add(frame, side + " palm misses thigh", .20)
                    continue
                along = (along - outward * along.dot(outward)).normalized()
                pole = torso.direction([1, .05, -1], sign)
                gap = pose_arm(side, hit, pole, "neutral", torso, contact_frame=(along, -outward))
                gaps.append((side + " resting thigh hand", gap))
                surface = grips[side]
                _, _, _, distance = surface.surface.find_nearest(surface.transform.inverted() @ hit)
                if distance > .010:
                    problems.add(frame, side + " palm loses thigh contact", distance)
        if "unloaded_arm" in a:
            curl = span.sample("unloaded_curl", 10)
            for side, sign in SIDES.items():
                upper = span.sample("unloaded_arm_" + side.lower(), span.sample("unloaded_arm"))
                arm = {"upper_arm": upper, "curl": curl}
                _, target = held_point(side, arm, torso)
                pole = torso.direction(upper, sign)
                elbow = head(side + "Arm") + pole * segment(side + "Arm", side + "ForeArm", side + "Hand")[0]
                along = (target - elbow).normalized()
                inward = torso.direction(spec["unloaded_palm"], sign) if "unloaded_palm" in spec else -torso.left * sign
                palm = (inward - along * along.dot(inward)).normalized()
                gap = pose_arm(side, target + palm * GRIP[side][1], pole, "neutral",
                               torso, contact_frame=(along, palm))
                gaps.append((side + " unloaded arm", gap))
        if floor_hands:
            palm = Vector((0, 0, -1))
            for side, sign in SIDES.items():
                palm_yaw = math.radians(spec.get("palm_toe_in", 0))
                along = Vector((-sign * math.sin(palm_yaw), -math.cos(palm_yaw), 0))
                radius, y, z = floor_hands
                wrist = Vector(span.sample("plant_" + side.lower(), (sign * radius, y, z)))
                target = wrist + along * GRIP[side][0] + palm * GRIP[side][1]
                planted = any(check.get("hand_mode") == "floor-plant" and check.get("side", side) == side
                              for check in checkpoints.get(frame, ()))
                if side in planted_sides:
                    out, back, up = span.sample("plant_elbow", spec.get("plant_elbow", (.65, .008, .28)))
                    pole = Vector((sign * out, back, up))
                else:
                    out, back, up = spec.get("plant_elbow", (.58, .14, -.45))
                    pole = Vector((sign * out, back, up))
                gap = pose_arm(side, target, pole, "pronated", torso, contact_frame=(along, palm))
                gaps.append((side + " floor wrist", gap))
                if side in planted_sides and not planted:
                    relaxation = relax_unsupported_hand(side, wrist, along, palm, torso)
                    if side in relaxing:
                        relaxing[side].value = relaxation
                        relaxing[side].keyframe_insert("value", frame=frame)
                    grips[side].check_wrist(frame, problems)
                    continue
                if side in relaxing:
                    relaxing[side].value = 0
                    relaxing[side].keyframe_insert("value", frame=frame)
                surface = grips[side]
                transform = surface.transform
                heights = surface.points @ np.array(transform.to_3x3().row[2]) + transform.translation.z
                on_surface = np.ones(len(heights), dtype=bool)
                if elevated_palms:
                    positions = surface.points @ np.array(transform.to_3x3()).T + np.array(transform.translation)
                    rel = positions - np.array(bench.top)
                    heights = rel[:, 2]
                    on_surface = (abs(rel[:, 0]) < bench.width / 2) & (abs(rel[:, 1]) < bench.length / 2)
                gap = heights[on_surface].min(initial=1)
                surface.record_contact(gap)
                near = on_surface & (np.abs(heights) < .004)
                if planted:
                    direction = transform.to_3x3().transposed() @ along
                    forward = surface.points @ np.array(direction) + (transform.translation - wrist).dot(along)
                    palm_supported = (np.count_nonzero(near & (forward > .017) & (forward < .085)) >= 20
                               and np.count_nonzero(near & (forward > .10)) >= 20)
                else:
                    palm_supported = np.count_nonzero(near) >= 20
                if gap < -.002 or not palm_supported:
                    problems.add(frame, side + " open palm loses floor contact", abs(gap))
                if not planted:
                    surface.check_wrist(frame, problems)
        if floor_hands and all(spec.get("hands", {}).get(side) == "diamond" for side in SIDES):
            for digit in ("thumb", "index"):
                tips = [surface.transform @ Vector(surface.skin["diamond_" + digit + "." + side])
                        for side, surface in grips.items()]
                gap = (tips[0] - tips[1]).xy.length
                if gap > .008:
                    problems.add(frame, "diamond " + digit + " tips lose contact", gap)
        if dumbbells:
            for side in dumbbells.roots:
                sign = SIDES[side]
                phase = spec.get("arm_phase", {}).get(side, 0)
                arm_span = PoseSpan(keys, (frame - 1) / frames + phase) if phase else span
                arm_key = arm_span.keys[1]
                elbows = arm_span.sample("elbows", [0.1, -0.3, -1])
                hand_frame = None
                if "wrist_rest" in arm_key:
                    grip_point, hand_frame = supported_wrist(arm_key, arm_span, side)
                    forward_axis = torso.forward
                elif "bar" in arm_key:
                    centre = arm_span.sample("bar", resolve=lambda target: bar_centre(target, torso))
                    grip_point = Vector(centre) + torso.left * sign * arm_span.sample("grip_width")
                    forward_axis = torso.forward
                else:
                    arms = {field: arm_span.sample(field) for field in ("upper_arm", "curl")}
                    if "flex_toward" in arm_key:
                        arms["flex_toward"] = arm_span.sample("flex_toward")
                    forward_axis, grip_point = held_point(side, arms, torso)
                axis = forward_axis if arm_key.get("grip") == "neutral" else torso.left
                if "handle_direction" in arm_key:
                    axis = torso.direction(arm_span.sample("handle_direction"), sign)
                grip = arm_key.get("grip", "supinated")
                orientation = "thumb-forward" if grip == "neutral" else grip
                pole = torso.direction(elbows, sign)
                if arm_key.get("fixed_upper_arm"):
                    # Construct the grip from the authored elbow and wrist, including the
                    # palm offset. The IK solution then recovers the same stationary elbow.
                    pole = torso.direction(arms["upper_arm"], sign)
                    upper, fore = segment(side + "Arm", side + "ForeArm", side + "Hand")
                    elbow = head(side + "Arm") + pole * upper
                    lower = (grip_point - elbow).normalized()
                    along, palm = hand_on_bar(lower, palm_facing(orientation, lower, pole, torso, sign, axis), axis)
                    if "grip_roll" in arm_key:
                        roll = Matrix.Rotation(sign * math.radians(arm_span.sample("grip_roll")), 3, lower)
                        along, palm, axis = roll @ along, roll @ palm, roll @ axis
                        hand_frame = (along, palm)
                    grip_point = elbow + lower * fore + along * GRIP[side][0] + palm * GRIP[side][1]
                gap = pose_arm(side, grip_point, pole, orientation, torso, axis, hand_frame)
                gaps.append((f"{side} hand", gap))
                grips[side].check(frame, grip_point, axis, Dumbbells.HANDLE, problems)
                # The handle's middle goes in the middle of the fist, so neither head touches the hand.
                surface = grips[side]
                local = surface.points
                transform = surface.transform
                to_axis = np.array(transform.to_3x3().transposed() @ axis)
                offset = (transform.translation - grip_point).dot(axis)
                across = local @ to_axis + offset
                middle = (across.min() + across.max()) / 2
                centre = grip_point + axis * middle
                if bell_spec and dumbbells.shared:
                    spacing = arm_span.sample("grip_width")
                    if side == "Left":
                        dumbbells.move(side, grip_point - axis * spacing, axis, frame, arm_span.sample("bell_roll", 0))
                    grip_extent = np.abs(across + sign * spacing).max()
                else:
                    if bell_spec:
                        dumbbells.move(side, centre, axis, frame, arm_span.sample("bell_roll", 0))
                    else:
                        dumbbells.move(side, centre, axis, frame)
                    grip_extent = (across.max() - across.min()) / 2
                if grip_extent > dumbbells.INNER:
                    problems.add(frame, f"{side} fist is wider than the dumbbell handle", (across.max() - across.min()) / 2 - dumbbells.INNER)
                tucked(side, torso, problems, frame)
        for side in SIDES:
            upper = (head(side + "ForeArm") - head(side + "Arm")).normalized()
            elevation = upper.dot(torso.up)
            # Ease the correction in as the upper arm approaches horizontal.
            strength = max(0, min(1, (elevation - onset) / (full - onset)))
            if strength or side in correctives:
                if side not in correctives:
                    mod = correctives[side] = shoulder_corrective(side, radius)
                    if frame > 1:
                        mod.iterations = 0
                        mod.keyframe_insert("iterations", frame=frame-1)
                mod = correctives[side]
                mod.show_viewport = True
                mod.iterations = round(85 * strength * strength)
                mod.keyframe_insert("iterations", frame=frame)
        for bone in bones:
            bone.keyframe_insert("rotation_quaternion", frame=frame)
            bone.keyframe_insert("location", frame=frame)
        update()

        check_movement(checkpoints.get(frame, ()), frame, barbell, dumbbells, problems, first, contact_load, landmine, handled_station)

        # Nothing should jump between frames: a joint that moves more than 4 cm in a 30th of a second
        # is flicking between two poses.
        for name in tracked:
            here = head(name)
            if name in previous and (here - previous[name]).length > 0.04:
                problems.add(frame, f"the {name} jumps between frames", (here - previous[name]).length)
            previous[name] = here
            first.setdefault(name, here)
        for what, gap in gaps:
            if gap > 0.003:
                problems.add(frame, f"{what} is out of reach", gap)
        everything, hands = evaluated_points(body)
        for section in [contact, *sections, *shoulders]:
            section.check(frame, everything, problems)
        if smith:
            smith.check(everything, contact.faces, hands, frame, problems, samples)
        if belt_squat:
            belt_squat.check(everything,contact,hands,grips,frame,problems,samples)
        if rotary:
            rotary.check(everything,contact,hands,grips,frame,problems,samples)
        if hip_thrust:
            hip_thrust.check(everything,contact.faces,hands,grips,frame,problems,samples)
        if roman_chair:
            roman_chair.check(everything, contact, hands, frame, problems, samples)
        if nordic:
            nordic.check(everything, contact, hands, frame, problems, samples)
        if captains_chair:
            captains_chair.check(everything, contact, hands, grips, frame, problems, samples)
        if treadmill:
            treadmill.check(everything, contact.faces, hands, frame, problems, samples)
        if wall:
            wall.check(everything, frame, problems)
            if wall_feet:
                for vertices in contact.foot_vertices.values():
                    wall.check(everything[vertices], frame, problems)
            samples.append(np.array([wall.face + Vector((sign * wall.width / 2, 0, z))
                                     for sign in (-1, 1) for z in (-wall.length / 2, wall.length / 2)]))
        if pullup:
            pullup.check(everything, contact, hands, grips, frame, problems, samples)
        if core_bench:
            core_bench.check(everything, contact, hands, grips, frame, phase, problems, samples, spec)
        if dip_bars:
            dip_bars.check(everything, contact.faces, hands, grips, frame, problems, samples)
        if standing_cardio:
            standing_cardio.check(everything, contact.faces, hands, grips, frame, problems, samples)
        if rower:
            rower.check(everything, contact.faces, hands, grips, frame, problems, samples)
        if cycle:
            cycle.check(everything, contact.faces, hands, grips, frame, problems, samples)
        if lateral:
            lateral.check(everything, contact.faces, hands, grips, frame, problems, samples)
        if trunk_station:
            trunk_station.check(everything, contact, hands, grips, frame, problems, samples)
        if assist:
            assist.check(everything, contact.faces, hands, grips, frame, problems, samples)
        if guided_squat:
            guided_squat.check(everything, contact.faces, hands, grips, frame, problems, samples)
        if hip_machine:
            hip_machine.check(everything, contact.faces, hands, grips, frame, problems, samples)
        if calf:
            calf.check(everything, contact.faces, hands, grips, frame, problems, samples)
        if sled:
            sled.check(everything, contact.faces, hands, frame, problems, samples)
        if roller:
            roller.check(everything, contact.faces, hands, grips, frame, problems, samples)
        if machine:
            check_rendered_grips(machine.handles, grips, frame, problems)
            machine.check(everything, contact.faces, hands, grips, frame, problems, samples)
        if cables:
            cables.check_grips(grips, frame, problems)
            cables.check(everything, contact.faces, frame, problems, samples)
        if thigh_band:
            thigh_band.pose(everything, contact, frame, problems, samples)
        if plyo_box:
            plyo_box.check(everything, contact, phase, frame, problems, samples)
        if ab_wheel:
            ab_wheel.check(everything, contact, hands, grips, frame, problems, samples)
        if ground_gait is not None or treadmill:
            check_gait(spec, gait_phase, everything, contact, frame, problems, treadmill)
        if ground_gait is not None:
            for side, planted in gait_contacts.items():
                clearance = everything[contact.foot_vertices[side], 2].min()
                if planted and not -.010 <= clearance <= .012:
                    problems.add(frame, side + " stance foot loses ground contact", abs(clearance))
        if waterline is not None:
            for side in SIDES:
                local = (phase + (0 if side == "Left" else .5)) % 1
                wrist = head(side + "Hand").z
                if .16 <= local <= .39 and wrist > waterline - .045:
                    problems.add(frame, side + " swimming pull leaves the water", wrist - waterline + .045)
                if .64 <= local <= .83 and wrist < waterline + .035:
                    problems.add(frame, side + " swimming recovery remains underwater", waterline + .035 - wrist)
        if spec.get("side_lying"):
            for label, vertices in (("lower hip", contact.pelvis_vertices),
                                    ("lower leg", contact.foot_vertices["Left"])):
                gap = everything[vertices, 2].min()
                if not -.009 <= gap <= .023:
                    problems.add(frame, label + " loses side-lying floor support", abs(gap))
        if spec.get("prone_support"):
            contact.check_prone_support(frame, everything, problems)
        if "unsupported_feet" in spec:
            contact.check_unsupported_feet(frame, everything, spec["unsupported_feet"], problems)
        if "grounded_heels" in spec:
            contact.check_grounded_heels(frame, everything, spec["grounded_heels"], problems)
        if "kneeling_support" in spec:
            contact.check_kneeling_support(frame, everything, spec["kneeling_support"], phase,
                                          checkpoints.get(frame, ()), problems)
        if side_support:
            contact.check_side_support(frame, everything, grips["Left"], problems,
                                       bench if side_support.get("bench_foot") else None)
        if supine is not None:
            contact.check_supine_support(frame, everything, supine, phase, problems)
        if spec.get("forearm_support") == "thighs":
            contact.check_resting_forearms(frame, everything, problems)
        samples.append(everything[::50])
        posed_wrists = wrists.evaluated_get(bpy.context.evaluated_depsgraph_get())
        posed_wrists.data.vertices.foreach_get("co", wrist_points.ravel())
        everything = np.vstack((everything, wrist_points))
        hands = np.concatenate((hands, np.zeros(len(wrist_points), dtype=bool)))
        if station:
            station.check(everything, barbell, frame, problems)
        if preacher:
            preacher.check(everything, frame, problems)
        if landmine:
            landmine.check(everything, frame, problems, samples, grips)
        if contact_load:
            contact_load.check_body(everything,frame,problems,samples,spec.get("follow",{}).get("bone"))
        low = everything[:, 2].min()
        if low < -0.012:
            problems.add(frame, "the body goes through the floor", -low)
        if barbell:
            bottom = barbell.centre.z - barbell.PLATE
            if bottom < -.002:
                problems.add(frame, "a barbell plate crosses the floor", -bottom)
            samples.append(np.array([barbell.centre + Vector((s * 1.1, 0, z)) for s in (-1, 1) for z in (-barbell.PLATE-.005, barbell.PLATE+.005)]))
            if cradle:
                for side, sign in SIDES.items():
                    elbow = head(side + "ForeArm")
                    near = np.linalg.norm(everything - np.array(elbow), axis=1) < .105
                    near &= np.abs(everything[:, 0] - elbow.x) < .052
                    radial = np.linalg.norm(everything[near, 1:] - np.array(barbell.centre)[1:], axis=1)
                    contact_gap = radial.min(initial=1) - barbell.SHAFT
                    if contact_gap > .012:
                        problems.add(frame, side + " elbow loses shaft contact", contact_gap)
            shaft, plate, gap = barbell.intrusions(everything, hands if not cradle else np.zeros_like(hands))
            closest["bar"] = min(closest["bar"], gap)
            if shaft or plate:
                problems.add(frame, f"the bar passes through the body ({'plate' if plate else 'shaft'})", -gap)
        if dumbbells:
            corners = np.array(dumbbells.corners())
            samples.append(corners)
            if not bell_spec:
                for side, centre in dumbbells.centres.items():
                    vertical = abs(dumbbells.axes[side].z)
                    bottom = centre.z - (dumbbells.INNER + dumbbells.DEPTH) * vertical
                    bottom -= dumbbells.HEAD * math.sqrt(max(0, 1 - vertical ** 2))
                    if bottom < -.002:
                        problems.add(frame, "a dumbbell crosses the floor", -bottom)
            elif corners[:, 2].min() < -.002:
                problems.add(frame, "a kettlebell crosses the floor", -corners[:, 2].min())
            inside, gap = dumbbells.intrusions(everything)
            closest["dumbbells"] = min(closest["dumbbells"], gap)
            if inside:
                problems.add(frame, "a dumbbell passes through the body", max(-gap, 0.001))
        if bench:
            if bench.surfaces:
                bench.check_apparatus([barbell.root] if barbell else dumbbells.roots.values() if dumbbells else
                                      contact_load.roots.values() if contact_load else [],
                                      frame, problems)
            if bench.chest_support:
                # Sample the front midline between spine and shoulders, excluding the arms.
                spine, shoulder = head("Spine2"), head("LeftArm")
                chest = everything[(np.abs(everything[:, 0]) < .095) &
                                   (everything[:, 1] < spine.y) & (everything[:, 1] > shoulder.y)]
                contact_gap = bench.gap(chest)
                if contact_gap > .02:
                    problems.add(frame, "chest loses the supporting pad", contact_gap)
            if spec.get("bench_upper_back"):
                behind = (everything[:, 1] >= head("Spine2").y - .02) & (
                    everything[:, 1] <= head("LeftArm").y + .08)
                shoulder_gap = bench.gap(everything[behind])
                if shoulder_gap > .016:
                    problems.add(frame, "upper back loses bench contact", shoulder_gap)
            gap = bench.gap(everything)
            closest["bench"] = min(closest["bench"], gap)
            if gap < -0.025:
                problems.add(frame, "the body sinks into the bench pad", -gap)
    for name in tracked:  # the loop's last frame has to lead smoothly back into its first
        if (first[name] - previous[name]).length > 0.04:
            problems.add(frames, f"the {name} jumps where the loop restarts", (first[name] - previous[name]).length)
    for section in sections:
        print(f"ELBOW CHECKS {section.side}: {section.minimum:.1%}–{section.maximum:.1%} of rest area")
    for patch in shoulders:
        print("SHOULDER CHECKS", patch.side, {k: round(float(v), 3) for k, v in patch.worst.items()})
    for side, surface in grips.items():
        if (landmine and side not in landmine.handles) or (cables and side not in cables.handles):
            continue
        print("GRIP CHECKS", side, json.dumps({k: round(v, 2) for k, v in getattr(surface, "contact_metrics", surface.metrics).items()}))
    bpy.data.objects.remove(wrists, do_unlink=True)
    scene.frame_start, scene.frame_end = 1, frames
    return problems, np.vstack(samples), closest


def main():
    spec_path, out, muscles, view, angle, focus, sheet = parse_args()
    focus_distance = float(sys.argv[sys.argv.index("--focus-distance")+1]) if "--focus-distance" in sys.argv else .45
    if focus_distance <= 0:
        raise ValueError("--focus-distance must be positive (metres)")
    with open(spec_path) as file:
        spec = json.load(file)
    keys = load_keys(spec)
    light_up(muscles)
    problems, samples, closest = bake(spec, keys)
    for check in spec.get("touching", []):
        if closest.get(check, math.inf) > 0.02:
            problems.add(0, f"the {check} never comes within 2 cm of the body (closest)", closest[check])
    if problems.found:
        for line in problems.lines():
            print("CHECK FAILED:", line)
        sys.exit(1)
    print("CHECKS PASSED", json.dumps({k: round(v * 100, 1) for k, v in closest.items() if v != math.inf}), "(closest cm)")
    if "--check-only" in sys.argv:
        return
    frame_camera(spec, view, angle, samples)
    bpy.data.objects["skin"].hide_set(False)
    detail(True)
    scene.eevee.taa_render_samples = 24
    if focus:
        # Bone positions are already baked. Key only the camera translation so a
        # close-up keeps its viewing direction throughout a sheet or motion review.
        camera = scene.camera
        back = camera.rotation_euler.to_matrix() @ Vector((0, 0, 1))
        for frame in range(scene.frame_start, scene.frame_end + 1):
            scene.frame_set(frame)
            target = head(focus)
            if "--focus-distance" in sys.argv and focus.endswith("Hand"):
                target = target.lerp(bones[focus].tail, .5)
            camera.location = target + back * focus_distance
            camera.keyframe_insert("location", frame=frame)
    palette = "--palette" in sys.argv
    if sheet or palette:
        scene.render.resolution_percentage = 100 if focus or palette else 50
        scene.eevee.taa_render_samples = 48 if focus or palette else 24
        frames = spec.get("frames", 96)
        silver = body.data.materials[0]
        pigments = list(silver["pigments"]) if palette else [None] * 4
        for index, pigment in enumerate(pigments):
            at = 0.25 if palette else index / 4
            scene.frame_set(min(frames, 1 + round(at * frames)))
            if palette:
                silver.node_tree.nodes["Muscle pigment"].outputs[0].default_value = (*silver["pigments"][pigment], 1)
                print("PIGMENT", pigment)
            scene.render.filepath = f"{out}/sheet-{index}.png"
            bpy.ops.render.render(write_still=True)
    else:
        scene.render.filepath = f"{out}/frame-"
        scene.render.image_settings.file_format = "PNG"
        bpy.ops.render.render(animation=True)


if __name__ == "__main__":
    main()
