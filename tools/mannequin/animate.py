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
    for name in ("Spine", "Spine1", "Spine2"):
        turn(name, left, key.get("spine", 0) / 3)
    for name in ("Neck", "Head"):
        turn(name, left, key.get("head", 0) / 2)
    return pelvis


def suspend_from_bar(centre, width, shoulder_y, pelvis_rotation):
    """Set trunk height from the bar and the length of a hanging, nearly straight arm."""
    shoulder = (head("LeftArm") + head("RightArm")) / 2
    upper, fore = segment("LeftArm", "LeftForeArm", "LeftHand")
    lateral = width - (head("LeftArm").x - shoulder.x)
    hand, palm = GRIP["Left"]
    # Project the two arm segments into the sagittal plane. The grip lies
    # along the hand and a little way out from its palm. Keep the IK hinge
    # just off full extension, where its bending plane would be singular.
    reach = math.sqrt((upper + fore - .0003) ** 2 - lateral ** 2) + hand
    height = math.sqrt(reach ** 2 + palm ** 2 - (shoulder_y - centre[1]) ** 2)
    target = Vector((centre[0], shoulder_y, centre[2] + height))
    place("Hips", pelvis_rotation @ REST["Hips"], head("Hips") + target - shoulder)


def ankles(spec, key):
    stance = {**spec.get("stance", {}), **key.get("stance", {})}
    width, y, toe_out = stance.get("width", 0.3), stance.get("y", 0.0), stance.get("toe_out", 10)
    return {side: (Vector((sign * width / 2, y, FLOOR_ANKLE)), sign * toe_out) for side, sign in SIDES.items()}


def pose_legs(spec, key, pelvis):
    gaps = []
    # Knees point where the toes do: forward along the floor, whatever the hips are doing.
    # (The pelvis's own forward tips towards the floor in a deep hinge, and the knee would flip.)
    forward = Matrix.Rotation(math.radians(key.get("yaw", 0)), 3, "Z") @ Vector((0, -1, 0))
    for side, (ankle, yaw) in ankles(spec, key).items():
        turned = Matrix.Rotation(math.radians(yaw), 3, "Z")
        thigh, shin = segment(f"{side}UpLeg", f"{side}Leg", f"{side}Foot")
        hip = head(f"{side}UpLeg")
        knee, gap = bend(hip, ankle, thigh, shin, turned @ forward)
        swing(f"{side}UpLeg", knee - hip)
        swing(f"{side}Leg", ankle - head(f"{side}Leg"))
        place(f"{side}Foot", turned @ REST[f"{side}Foot"])
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


def pose_arm(side, grip_point, pole, grip, torso, bar=Vector((1, 0, 0))):
    sign = SIDES[side]
    upper, fore = segment(f"{side}Arm", f"{side}ForeArm", f"{side}Hand")
    shoulder = head(f"{side}Arm")
    forearm = FOREARM.get(side, (grip_point - shoulder).normalized())
    along, palm = hand_on_bar(forearm, palm_facing(grip, forearm, pole, torso, sign, bar), bar)
    # The wrist sits back from the grip along the hand, and the forearm's angle depends on where
    # the wrist is, so go round until they agree. There can be two answers (elbow in front or behind),
    # so start from the frame before: the arm then stays on one answer instead of flicking between them.
    for _ in range(200):
        wrist = grip_point - along * GRIP[side][0] - palm * GRIP[side][1]
        elbow, gap = bend(shoulder, wrist, upper, fore, pole)
        turned = (wrist - elbow).normalized()
        settled = (turned - forearm).length < 1e-5
        forearm = forearm.lerp(turned, 0.5).normalized()
        along, palm = hand_on_bar(forearm, palm_facing(grip, forearm, pole, torso, sign, bar), bar)
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

    def __init__(self):
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

    def intrusions(self, points, hand_mask):
        """Body points inside the shaft (hands excluded: they wrap it) or inside a plate."""
        rel = points - np.array(self.centre)
        radial = np.hypot(rel[:, 1], rel[:, 2])
        x = np.abs(rel[:, 0])
        in_shaft = (radial < self.SHAFT - 0.002) & (x < self.INNER) & ~hand_mask
        in_plate = (radial < self.PLATE) & (x > self.INNER + 0.05) & (x < self.INNER + 0.11)
        return int(in_shaft.sum()), int(in_plate.sum()), float((radial[~hand_mask & (x < self.INNER)] - self.SHAFT).min())


class Dumbbells:
    """A dumbbell in each hand, with independently oriented shafts and collision volumes."""

    HANDLE = Barbell.SHAFT  # the fists' grip cavity is sized for the barbell's shaft
    INNER = 0.065  # half the handle's length between the heads
    HEAD, DEPTH = 0.062, 0.06

    def __init__(self):
        steel = material("steel", STEEL, 0.9, 0.3)
        iron = material("iron", IRON, 0.3, 0.55)
        self.roots, self.centres, self.axes = {}, {}, {}
        for side in SIDES:
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


class Bench:
    def __init__(self, at, length=1.2):
        self.top, self.length = Vector(at), length
        pad = material("pad", PAD, 0.0, 0.7)
        frame = material("frame", IRON, 0.6, 0.4)
        x, y, z = self.top
        box("bench pad", (0.3, length, 0.08), (x, y, z - 0.04), pad)
        box("bench spine", (0.08, length * 0.9, 0.06), (x, y, z - 0.11), frame)
        for end in (-1, 1):
            leg_y = y + end * length * 0.4
            box("bench leg", (0.06, 0.06, z - 0.14), (x, leg_y, (z - 0.14) / 2), frame)
            box("bench foot", (0.42, 0.07, 0.04), (x, leg_y, 0.02), frame)

    def gap(self, points):
        """The smallest height of the body above the pad's top; below 0 means it sinks into the pad."""
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
    ahead = (torso.forward - down * torso.forward.dot(down)).normalized()
    curl = math.radians(key["curl"])
    axis = ahead * math.cos(curl) - down * math.sin(curl)
    return axis, elbow + (down * math.cos(curl) + ahead * math.sin(curl)) * (fore + GRIP[side][0])


def bar_centre(target, torso):
    if isinstance(target, list):
        return Vector(target)
    return torso.point(LANDMARKS[target["at"]]) + torso.point(target.get("offset", (0, 0, 0))) - torso.origin


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
        forearm = world_rotation(f"{self.side}ForeArm").col[1]
        hand = world_rotation(f"{self.side}Hand").col[1]
        angle = math.degrees(forearm.angle(hand))
        self.metrics["wrist_degrees"] = max(self.metrics["wrist_degrees"], angle)
        if angle > 40:
            problems.add(frame, f"{self.side} wrist bend exceeds 40 degrees", angle, "degrees")

    def geometry(self, centre, axis, radius, problems):
        frame = 0
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
        minimum = 0 if enclosed.any() else np.min(distances)
        penetration = radius - minimum
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


def shoulder_corrective(side):
    """Spread high-elevation deltoid and armpit strain over the shoulder girdle."""
    joint = rig.data.bones[side + "Arm"].head_local
    group = body.vertex_groups.new(name=side + " shoulder corrective")
    for vertex in body.data.vertices:
        distance = (vertex.co - joint).length
        if distance < .27:
            group.add([vertex.index], min(1, (.27-distance)/.06), "REPLACE")
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
        unknown = set(check) - {"at", "side", "elbow", "position", "handle_axis", "palm", "upper_arm_to_torso", "fixed_elbow_m"}
        if unknown or not set(check) & {"elbow", "position", "handle_axis", "palm", "upper_arm_to_torso", "fixed_elbow_m"}:
            raise ValueError(f"Invalid movement checkpoint: {check}")
        if check.get("side", "Left") not in SIDES:
            raise ValueError(f"Unknown checkpoint side: {check['side']}")
        times = range(1, frames + 1) if phase is None else [min(frames, 1 + round(phase * frames))]
        for frame in times:
            scheduled.setdefault(frame, []).append(check)
    return scheduled


def check_movement(checks, frame, barbell, dumbbells, problems, initial=None):
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

            tool = barbell.root if barbell else dumbbells.roots[side] if dumbbells else None
            if "elbow" in check:
                upper = joint("ForeArm") - joint("Arm")
                fore = joint("Hand") - joint("ForeArm")
                bounds("elbow flexion", math.degrees(upper.angle(fore)), check["elbow"], "degrees")
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
                    cosine = abs(actual.dot(direction))
                angle = math.degrees(math.acos(max(-1, min(1, cosine))))
                bounds(field + " deviation", angle, [0, target["degrees"]], "degrees")


def bake(spec, keys):
    frames = spec.get("frames", 96)
    checkpoints = movement_checkpoints(spec, frames)
    FOREARM.clear()
    detail(False)
    equipment = [e["type"] for e in spec.get("equipment", [])]
    unknown = set(equipment) - {"barbell", "dumbbells", "bench"}
    if unknown or len(equipment) != len(set(equipment)) or {"barbell", "dumbbells"} <= set(equipment):
        raise ValueError(f"Unsupported equipment combination: {equipment}")
    barbell = Barbell() if "barbell" in equipment else None
    dumbbells = Dumbbells() if "dumbbells" in equipment else None
    bench = next((Bench(e["at"], e.get("length", 1.2)) for e in spec.get("equipment", []) if e["type"] == "bench"), None)
    problems = Problems()
    grips = {side: GripSurface(side) for side in SIDES} if barbell or dumbbells else {}
    wrists = wrist_collision_points()
    wrist_points = np.empty((len(wrists.data.vertices), 3), dtype=np.float32)
    sections = [ElbowSection(side) for side in SIDES]
    contact = SkinContact()
    shoulders = [ShoulderShape(side) for side in SIDES]
    pose_clavicles = any("clavicle" in key for key in keys)
    correctives = {}
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
        key = {field: span.sample(field) for field in ("pelvis", "lean", "spine", "head", "yaw") if field in a}
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
        gaps = pose_legs(spec, {**a, **key}, pelvis)
        if barbell:
            if "upper_arm" in a:
                arms = {field: span.sample(field) for field in ("upper_arm", "curl")}
                _, target = held_point("Left", arms, torso)
                centre = Vector((0, target.y, target.z))
            else:
                centre = span.sample("bar", resolve=lambda target: bar_centre(target, torso))
            barbell.move(Vector(centre), frame)
            width = span.sample("grip_width", 0.25)
            elbows = span.sample("elbows", [0.4, -0.6, -0.5])
            for side, sign in SIDES.items():
                grip_point = Vector(centre) + Vector((sign * width, 0, 0))
                gap = pose_arm(side, grip_point, torso.direction(elbows, sign), a.get("grip", "pronated"), torso)
                gaps.append((f"{side} hand", gap))
                # The bar has to sit in the palm, where the fingers can close round it.
                hand = world_rotation(f"{side}Hand")
                held = head(f"{side}Hand") + hand.col[1] * GRIP[side][0] + hand @ palm_axis(side) * GRIP[side][1]
                miss = (held - grip_point).length
                if miss > 0.01:
                    problems.add(frame, f"{side} hand misses the bar", miss)
                grips[side].check(frame, grip_point, Vector((1, 0, 0)), barbell.SHAFT, problems)
                surface = grips[side]
                transform = surface.transform
                outer = abs(surface.points @ np.array(transform.to_3x3().row[0]) + transform.translation.x - centre[0]).max()
                if outer > barbell.INNER:
                    problems.add(frame, f"{side} fist reaches the bar collar", outer - barbell.INNER)
                tucked(side, torso, problems, frame)
        if dumbbells:
            for side, sign in SIDES.items():
                phase = spec.get("arm_phase", {}).get(side, 0)
                arm_span = PoseSpan(keys, (frame - 1) / frames + phase) if phase else span
                arm_key = arm_span.keys[1]
                elbows = arm_span.sample("elbows", [0.1, -0.3, -1])
                if "bar" in arm_key:
                    centre = arm_span.sample("bar", resolve=lambda target: bar_centre(target, torso))
                    grip_point = Vector(centre) + torso.left * sign * arm_span.sample("grip_width")
                    forward_axis = torso.forward
                else:
                    arms = {field: arm_span.sample(field) for field in ("upper_arm", "curl")}
                    forward_axis, grip_point = held_point(side, arms, torso)
                axis = forward_axis if arm_key.get("grip") == "neutral" else torso.left
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
                    grip_point = elbow + lower * fore + along * GRIP[side][0] + palm * GRIP[side][1]
                gap = pose_arm(side, grip_point, pole, orientation, torso, axis)
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
                dumbbells.move(side, grip_point + axis * middle, axis, frame)
                if (across.max() - across.min()) / 2 > Dumbbells.INNER:
                    problems.add(frame, f"{side} fist is wider than the dumbbell handle", (across.max() - across.min()) / 2 - Dumbbells.INNER)
                tucked(side, torso, problems, frame)
        for side in SIDES:
            upper = (head(side + "ForeArm") - head(side + "Arm")).normalized()
            elevation = upper.dot(torso.up)
            # Ease the correction in as the upper arm approaches horizontal.
            strength = max(0, min(1, (elevation + .22) / .85))
            if strength or side in correctives:
                if side not in correctives:
                    mod = correctives[side] = shoulder_corrective(side)
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

        check_movement(checkpoints.get(frame, ()), frame, barbell, dumbbells, problems, first)

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
        samples.append(everything[::50])
        posed_wrists = wrists.evaluated_get(bpy.context.evaluated_depsgraph_get())
        posed_wrists.data.vertices.foreach_get("co", wrist_points.ravel())
        everything = np.vstack((everything, wrist_points))
        hands = np.concatenate((hands, np.zeros(len(wrist_points), dtype=bool)))
        low = everything[:, 2].min()
        if low < -0.012:
            problems.add(frame, "the body goes through the floor", -low)
        if barbell:
            samples.append(np.array([barbell.centre + Vector((s * 1.1, 0, z)) for s in (-1, 1) for z in (-0.23, 0.23)]))
            shaft, plate, gap = barbell.intrusions(everything, hands)
            closest["bar"] = min(closest["bar"], gap)
            if shaft or plate:
                problems.add(frame, f"the bar passes through the body ({'plate' if plate else 'shaft'})", -gap)
        if dumbbells:
            samples.append(np.array(dumbbells.corners()))
            inside, gap = dumbbells.intrusions(everything)
            closest["dumbbells"] = min(closest["dumbbells"], gap)
            if inside:
                problems.add(frame, "a dumbbell passes through the body", max(-gap, 0.001))
        if bench:
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
        print("GRIP CHECKS", side, json.dumps({k: round(v, 2) for k, v in surface.metrics.items()}))
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
