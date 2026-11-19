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
    pelvis = yaw @ lean
    place("Hips", pelvis @ REST["Hips"], Vector(key.get("pelvis", (0, 0, 0))))
    left = pelvis @ Vector((1, 0, 0))
    forward = pelvis @ Vector((0, -1, 0))
    for name in ("Spine", "Spine1", "Spine2"):
        turn(name, left, key.get("spine", 0) / 3)
        if "side_bend" in key:
            turn(name, forward, key["side_bend"] / 3)
    for name in ("Neck", "Head"):
        turn(name, left, key.get("head", 0) / 2)
    return pelvis


def vertical_arm_reach(lateral, forward, slack=.0003):
    upper, fore = segment("LeftArm", "LeftForeArm", "LeftHand")
    hand, palm = GRIP["Left"]
    # Project the two arm segments into the sagittal plane. The grip lies
    # along the hand and a little way out from its palm. Keep the IK hinge
    # just off full extension, where its bending plane would be singular.
    reach = math.sqrt((upper + fore - slack) ** 2 - lateral ** 2) + hand
    return math.sqrt(reach ** 2 + palm ** 2 - forward ** 2)


def suspend_from_bar(centre, width, shoulder_y, pelvis_rotation):
    """Set trunk height from the bar and the length of a hanging, nearly straight arm."""
    shoulder = (head("LeftArm") + head("RightArm")) / 2
    lateral = width - (head("LeftArm").x - shoulder.x)
    height = vertical_arm_reach(lateral, shoulder_y - centre[1])
    target = Vector((centre[0], shoulder_y, centre[2] + height))
    place("Hips", pelvis_rotation @ REST["Hips"], head("Hips") + target - shoulder)


def ankles(spec, key):
    stance = {**spec.get("stance", {}), **key.get("stance", {})}
    width, y, toe_out = stance.get("width", 0.3), stance.get("y", 0.0), stance.get("toe_out", 10)
    height = next((e["height"] for e in spec.get("equipment", []) if e["type"] == "platform"), 0)
    return {side: (Vector((sign * width / 2, y, FLOOR_ANKLE + height)), sign * toe_out)
            for side, sign in SIDES.items()}


def pose_legs(spec, key, pelvis):
    gaps = []
    # Knees point where the toes do: forward along the floor, whatever the hips are doing.
    # (The pelvis's own forward tips towards the floor in a deep hinge, and the knee would flip.)
    forward = Matrix.Rotation(math.radians(key.get("yaw", 0)), 3, "Z") @ Vector((0, -1, 0))
    for side, (ankle, yaw) in ankles(spec, key).items():
        turned = Matrix.Rotation(math.radians(yaw), 3, "Z")
        pitch = Matrix.Identity(3)
        stride = key.get("foot_" + side.lower())
        if stride is not None:
            y, clearance, heel, *lateral = stride
            pitch = Matrix.Rotation(math.radians(heel), 3, "X")
            pivot = rig.data.bones[side + "Foot"].head_local - rig.data.bones[side + "ToeBase"].head_local
            ankle += Vector((lateral[0] if lateral else 0, y, clearance)) + turned @ (pitch @ pivot - pivot)
        thigh, shin = segment(f"{side}UpLeg", f"{side}Leg", f"{side}Foot")
        hip = head(f"{side}UpLeg")
        knee_pole = spec.get("stance", {}).get("knee_direction", {}).get(side)
        knee, gap = bend(hip, ankle, thigh, shin, turned @ Vector(knee_pole) if knee_pole else turned @ forward)
        swing(f"{side}UpLeg", knee - hip)
        swing(f"{side}Leg", ankle - head(f"{side}Leg"))
        place(f"{side}Foot", turned @ pitch @ REST[f"{side}Foot"])
        if stride is not None:
            place(side + "ToeBase", turned @ REST[side + "ToeBase"])
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
    TRAVEL = (.10, 3.05)

    def __init__(self, config):
        self.attachment = config["attachment"]
        self.half = self.GRIP_HALF[self.attachment]
        dual = self.attachment == "d-handle"
        self.stations = {}
        self.handles = {}
        self.lines = []
        self.bounds = []
        self.steel = material("cable hardware", STEEL, .8, .33)
        self.rubber = material("cable and rope", (.072, .078, .085), .24, .62)
        frame_finish = material("cable frame", (.085, .095, .11), .65, .43)
        columns = config["columns"]
        if not columns or not set(columns) <= (set(SIDES) if dual else {"Both"}):
            raise ValueError("D-handles need side-specific columns; other attachments need one Both column")
        for key, column in columns.items():
            x, y = column["at"]
            facing = Vector((*column.get("exit", [0, 1]), 0)).normalized()
            if not facing.length:
                raise ValueError("Pulley exit direction must be nonzero")
            height = self.HEIGHTS[column["height"]]
            origin = Vector((x, y, height))
            anchor = origin + facing * .15
            box("cable column", (.16, .18, 2.06), (x, y, 1.03), frame_finish)
            box("cable base", (.43, .38, .045), (x, y, .0225), frame_finish)
            box("pulley carriage", (.19, .19, .13), origin + facing * .065, frame_finish)
            pulley = cylinder("pulley wheel", .047, .036, 0, self.steel, None)
            pulley.location = anchor - facing * .038
            axle = facing.cross(Vector((0, 0, 1)))
            pulley.rotation_euler = axle.to_track_quat("Z", "Y").to_euler()
            stack_at = Vector((x, y, 0)) - facing * .19
            for plate in range(10):
                box("stack plate", (.27, .16, .025), stack_at + Vector((0, 0, .105 + .033 * plate)), frame_finish)
            for side in (-1, 1):
                self.bounds.append(Vector((x + side * .22, y, 0)))
                self.bounds.append(Vector((x + side * .09, y, 2.06)))
            grip_sides = (key,) if dual else SIDES
            for side in grip_sides:
                self.handles[side] = self.part("attachment grip", Barbell.SHAFT, self.steel)
            count = {"straight-bar": 1, "rope": 2, "v-bar": 2, "d-handle": 3}[self.attachment]
            links = [self.part("attachment link", .012 if self.attachment == "rope" else .008, self.rubber if self.attachment == "rope" else self.steel) for _ in range(count)]
            self.stations[key] = (anchor, self.part("taut cable", self.RADIUS, self.rubber), links)
        if self.attachment == "straight-bar":
            bpy.data.objects.remove(self.handles["Right"], do_unlink=True)
            self.handles["Right"] = self.handles["Left"]

    @staticmethod
    def part(name, radius, finish):
        part = cylinder(name, radius, 1, 0, finish, None)
        part.rotation_mode = "XYZ"
        return part

    def pose(self, span, torso, grips, frame, gaps, problems):
        targets, axes = {}, {}
        self.lines.clear()
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
            surface.check(frame, target, axis, Barbell.SHAFT, problems)
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
                    endpoint = targets[side] + axis * self.half * (1 if axis.dot(eye - targets[side]) > 0 else -1)
                    set_segment(link, eye, endpoint, frame)
            else:
                axis = axes[key]
                # Construct a triangular D-handle in the plane of the grip and cable.
                outward = (direction - axis * axis.dot(direction)).normalized()
                if outward.length < .5:
                    outward = axis.orthogonal().normalized()
                eye = middle + outward * .105
                endpoints = [middle + axis * self.half * sign for sign in (-1, 1)]
                for link, endpoint in zip(links[:2], endpoints):
                    set_segment(link, endpoint, eye, frame)
                set_segment(links[2], eye, eye + (anchor - eye).normalized() * .025, frame)
                eye += (anchor - eye).normalized() * .025
            length = (eye - anchor).length
            minimum, maximum = self.TRAVEL
            if not minimum <= length <= maximum:
                problems.add(frame, "cable outside its travel", max(minimum - length, length - maximum))
            if length >= .001:
                set_segment(cable, anchor, eye, frame)
            self.lines.append((anchor, eye))

    def check(self, points, faces, frame, problems, samples):
        # Cast the centreline and its surrounding cable surface through the posed skin.
        skin = BVHTree.FromPolygons(points, faces, all_triangles=True)
        for anchor, eye in self.lines:
            delta = eye - anchor
            if delta.length < .001:
                continue
            direction = delta.normalized()
            first = direction.orthogonal().normalized()
            second = direction.cross(first)
            for offset in (Vector(), first, -first, second, -second):
                hit, _, _, distance = skin.ray_cast(anchor + offset * self.RADIUS, direction, delta.length)
                if hit is not None:
                    problems.add(frame, "cable line crosses the body", delta.length - distance)
                    break
        samples.append(np.array(self.bounds + [eye for _, eye in self.lines]))


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
    def __init__(self, at, length=1.2, angle=None, support="back"):
        self.top, self.length = Vector(at), length
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
        flat_pad = box("bench pad", (0.3, length, 0.08), (x, y, z - 0.04), pad)
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
        over = (np.abs(rel[:, 0]) < 0.15) & (np.abs(rel[:, 1]) < self.length / 2) & (rel[:, 2] > -0.08)
        return float(rel[over, 2].min()) if over.any() else math.inf


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
    camera.location = centre + (Vector(location) - centre) * 1.12
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
        height = vertical_arm_reach(target["grip_width"] - shoulder.x, y - shoulder.y, .0003)
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
        unknown = set(check) - {"at", "side", "elbow", "position", "handle_axis", "palm", "upper_arm_to_torso", "fixed_elbow_m", "head_pitch", "surface_gap", "hand_pitch", "wrist_bend", "knee", "shin_vertical"}
        if unknown or not set(check) & {"elbow", "position", "handle_axis", "palm", "upper_arm_to_torso", "fixed_elbow_m", "head_pitch", "surface_gap", "hand_pitch", "wrist_bend", "knee", "shin_vertical"}:
            raise ValueError(f"Invalid movement checkpoint: {check}")
        if check.get("side", "Left") not in SIDES:
            raise ValueError(f"Unknown checkpoint side: {check['side']}")
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
    unknown = set(equipment) - {"barbell", "trap-bar", "ez-bar", "kettlebells", "dumbbells", "plate", "vertical-dumbbell", "landmine", "bench", "rack-pins", "platform", "cable"}
    if unknown or len(equipment) != len(set(equipment)) or len(set(equipment) - {"bench","platform","rack-pins"}) > 1:
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
    bench = next((Bench(e["at"], e.get("length", 1.2), e.get("angle"), e.get("support", "back")) for e in spec.get("equipment", []) if e["type"] == "bench"), None)
    preacher = next((PreacherPad(e["arm_pad"]) for e in spec.get("equipment", []) if "arm_pad" in e), None)
    if preacher:
        bench.surfaces.extend(preacher.surfaces)
    contact_load = next((ContactLoad(e) for e in spec.get("equipment", []) if e["type"] in ("plate","vertical-dumbbell")),None)
    landmine = next((Landmine(e) for e in spec.get("equipment", []) if e["type"] == "landmine"), None)
    cables = next((CableStation(e) for e in spec.get("equipment", []) if e["type"] == "cable"), None)
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
    for side in SIDES:
        shape = spec.get("hands", {}).get(side, "fist")
        if (side == support_side or floor_hands) and shape != "support":
            raise ValueError("Bench contact needs the open support hand")
        if rack_contact and shape == "fist":
            raise ValueError("Rack contact requires open hands")
        holds_handle = (barbell and not (rack_contact or cradle) or dumbbells and side in dumbbells.roots
                        or landmine and side in landmine.handles or cables and side in cables.handles)
        if holds_handle and shape != "fist":
            raise ValueError("A handle needs a closed fist")
        if contact_load and shape == "fist":
            raise ValueError("Face contact needs a pinch, cup or open hand")
        if rig.get("hand_shape." + side, "fist") != shape:
            raise ValueError("Scene hand shape does not match the spec")
    problems = Problems()
    grips = {side: GripSurface(side) for side in SIDES} if barbell or dumbbells or contact_load or landmine or floor_hands or cables else {}
    wrists = wrist_collision_points()
    wrist_points = np.empty((len(wrists.data.vertices), 3), dtype=np.float32)
    sections = [ElbowSection(side) for side in SIDES]
    contact = SkinContact()
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
    for frame in range(1, frames + 1):
        scene.frame_set(frame)
        for mod in correctives.values():
            mod.show_viewport = False
        span = PoseSpan(keys, (frame - 1) / frames)
        a = span.keys[1]
        key = {field: span.sample(field) for field in ("pelvis", "lean", "spine", "head", "yaw", "side_bend") if field in a}
        pelvis = pose_trunk(key)
        if "shoulder_y" in a:
            suspend_from_bar(span.sample("bar"), span.sample("grip_width", 0.25),
                             span.sample("shoulder_y"), pelvis)
        elif "pelvis" not in a:
            raise ValueError("A pose needs a pelvis position or a suspended shoulder_y")
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
        for field in ("foot_left", "foot_right"):
            if field in a:
                key[field] = span.sample(field)
        gaps = pose_legs(spec, {**a, **key}, pelvis)
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
        if floor_hands:
            along, palm = Vector((0, -1, 0)), Vector((0, 0, -1))
            for side, sign in SIDES.items():
                radius, y, z = floor_hands
                wrist = Vector((sign * radius, y, z))
                target = wrist + along * GRIP[side][0] + palm * GRIP[side][1]
                pole = Vector((sign * .58, .14, -.45))
                gap = pose_arm(side, target, pole, "pronated", torso, contact_frame=(along, palm))
                gaps.append((side + " floor wrist", gap))
                surface = grips[side]
                transform = surface.transform
                heights = surface.points @ np.array(transform.to_3x3().row[2]) + transform.translation.z
                gap = heights.min(initial=1)
                surface.record_contact(gap)
                if gap < -.002 or np.count_nonzero(np.abs(heights) < .004) < 20:
                    problems.add(frame, side + " open palm loses floor contact", abs(gap))
                surface.check_wrist(frame, problems)
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

        check_movement(checkpoints.get(frame, ()), frame, barbell, dumbbells, problems, first, contact_load, landmine, cables)

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
        if cables:
            cables.check(everything, contact.faces, frame, problems, samples)
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
