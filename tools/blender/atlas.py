"""
The trainer's anatomy layer: real muscle, tendon and bone meshes from the
Z-Anatomy atlas, reshaped to sit just under the trainer's skin and bound to
his skeleton so they move with him.

Z-Anatomy is licensed CC BY-SA 4.0 (and its source, BodyParts3D, CC BY-SA 2.1
Japan). Renders made from it must carry that credit and the same licence.

How the fit works. The anatomy is left exactly as the atlas has it. The
trainer, who starts with a different build and stance, is reshaped to wrap
round it. He is first posed as the atlas figure stands. Then matching points
are found on both: on his skin, and just outside the outermost surface of the
anatomy, sampled at the same stations along each limb and round the trunk. A
smooth warp carries every point of him (skin, hair, clothes and the joints of
his skeleton) from the first set to the second. Last, the anatomy takes its
skinning from the skin lying over it, so both layers move together.

Positions are in metres: +X is the figure's left, -Y is in front, +Z is up.
"""

import json
import math
import os
import subprocess
import sys

import bmesh
import bpy
import numpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

SOURCE = os.path.expanduser("~/.local/share/gym-trainer/z-anatomy/Startup.blend")
INDEX = os.path.join(os.path.dirname(SOURCE), "index.json")

# The atlas colours muscles by what they do, so these material names mark a mesh as a muscle.
MUSCLE_MATERIALS = {
    "Abductor", "Adductor", "Biarticular", "Depressor", "Extension", "Extension hand/foot",
    "Extensor extremities", "External rotation", "Flexion", "Flexion fingers", "Flexion hand/foot",
    "Internal rotator", "Levator", "Masticator", "Orbicularis/Constrictor", "Superficial", "Trapezius",
}

MUSCLE, TENDON, BONE = 0, 1, 2

# Which training muscle group an atlas muscle belongs to, by words in its name. First match wins.
GROUP_RULES = [
    (("deltoid",), "shoulders"),
    (("biceps brachii", "brachialis", "coracobrachialis"), "biceps"),
    (("triceps brachii", "anconeus"), "triceps"),
    (("pectoralis", "subclavius"), "chest"),
    (("serratus anterior",), "serratus"),
    (("rectus abdominis", "pyramidalis"), "abs"),
    (("abdominal oblique", "transversus abdominis"), "obliques"),
    (("trapezius",), "traps"),
    (("latissimus", "teres major"), "lats"),
    (
        ("rhomboid", "infraspinatus", "supraspinatus", "teres minor", "subscapularis", "levator scapulae",
         "serratus posterior"),
        "upper back",
    ),
    (
        ("iliocostalis", "longissimus", "spinalis", "multifid", "quadratus lumborum", "erector", "rotatores",
         "intertransvers", "interspinal"),
        "lower back",
    ),
    (("gluteus", "tensor fasciae", "piriformis", "obturator", "gemellus", "quadratus femoris"), "glutes"),
    (("rectus femoris", "vastus", "iliotibial", "articularis genus"), "quads"),
    (("biceps femoris", "semitendinosus", "semimembranosus"), "hamstrings"),
    (("adductor", "gracilis", "pectineus"), "adductors"),
    (("sartorius", "iliacus", "psoas"), "hip flexors"),
    (
        ("gastrocnemius", "soleus", "plantaris", "popliteus", "tibialis posterior", "flexor digitorum longus",
         "flexor hallucis longus"),
        "calves",
    ),
    (("tibialis anterior", "fibularis", "peroneus", "extensor digitorum longus", "extensor hallucis longus"), "shins"),
    (("sternocleidomastoid", "scalen", "hyoid", "longus colli", "longus capitis", "semispinalis", "splenius"), "neck"),
]

ARM_GROUPS = {"shoulders", "biceps", "triceps", "forearms"}
LEG_GROUPS = {"quads", "hamstrings", "adductors", "calves", "shins"}
ARM_BONES = ("humerus", "radius", "ulna")
LEG_BONES = ("femur", "tibia", "fibula", "patella")

# Trainer bones a limb's anatomy may follow. Without this, muscle beside the armpit could latch onto the ribs.
ARM_RIG = ("clavicle", "shoulder01", "upperarm", "lowerarm", "wrist", "finger", "metacarpal")
LEG_RIG = ("pelvis", "upperleg", "lowerleg", "foot", "toe")

# How far the skin sits off the anatomy, standing in for the fat and fascia between them.
SKIN_GAP = 0.004


def build_index():
    """Lists every mesh in the atlas with its materials. Slow, so it runs once in its own Blender and is kept."""
    subprocess.run([bpy.app.binary_path, "-b", "--python", os.path.abspath(__file__), "--", "--index"], check=True)


def write_index():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    with bpy.data.libraries.load(SOURCE) as (source, wanted):
        wanted.objects = list(source.objects)

    listing = {
        thing.name: [material.name for material in thing.data.materials if material]
        for thing in wanted.objects
        if thing is not None and thing.type == "MESH"
    }

    with open(INDEX, "w") as file:
        json.dump(listing, file)


def group_of(name, centre):
    lowered = name.lower()

    for words, group in GROUP_RULES:
        if any(word in lowered for word in words):
            return group

    # Forearm muscles have many names. Anything else hanging beside the hips is one of them.
    if abs(centre[0]) > 0.19 and 0.8 < centre[2] < 1.13:
        return "forearms"

    return "other"


class Part:
    """One atlas mesh: a muscle with its tendons, or a bone."""

    def __init__(self, name, kind, group, limb, left):
        self.name, self.kind, self.group, self.limb, self.left = name, kind, group, limb, left


def world_points(thing):
    count = len(thing.data.vertices)
    flat = numpy.zeros(count * 3)
    thing.data.vertices.foreach_get("co", flat)
    matrix = numpy.array(thing.matrix_world)

    return flat.reshape(-1, 3) @ matrix[:3, :3].T + matrix[:3, 3]


def end_means(points):
    """The middle of the top and of the bottom of a long bone standing upright."""
    low, high = points[:, 2].min(), points[:, 2].max()
    band = 0.08 * (high - low)

    return points[points[:, 2] > high - band].mean(0), points[points[:, 2] < low + band].mean(0)


def fibre_coordinates(name, points):
    """
    Where each vertex sits relative to its muscle's fibres: `across` changes
    from fibre to fibre and `along` runs down their length. A material
    stretches a pattern along the second to draw the fibres.
    """
    lowered = name.lower()
    centre = points.mean(0)
    side = 1.0 if centre[0] >= 0 else -1.0
    tip = None

    # These muscles fan out from a narrow attachment, so their fibres radiate from that point.
    if "pectoralis major" in lowered or "trapezius" in lowered:
        tip = points[numpy.argmax(numpy.abs(points[:, 0]))]
    elif "latissimus" in lowered:
        tip = points[numpy.argmax(numpy.abs(points[:, 0]) + 0.6 * points[:, 2])]
    elif "deltoid" in lowered or "gluteus medius" in lowered or "gluteus minimus" in lowered:
        tip = points[numpy.argmin(points[:, 2])]

    if tip is not None:
        out = points - tip
        reach = numpy.maximum(numpy.linalg.norm(out, axis=1), 1e-6)

        return out / reach[:, None] * reach.mean(), reach

    if "abdominal oblique" in lowered:
        # Flat sheets wrapped round the waist: their longest dimension is not the way the fibres run.
        axis = numpy.array([-0.5 * side, -0.3, 0.8 if "internal" in lowered else -0.8])
        axis /= numpy.linalg.norm(axis)
    else:
        axis = numpy.linalg.svd(points - centre, full_matrices=False)[2][0]

    along = (points - centre) @ axis

    return (points - centre) - along[:, None] * axis, along


def remove_vertices(thing, doomed):
    mesh = bmesh.new()
    mesh.from_mesh(thing.data)
    mesh.verts.ensure_lookup_table()
    bmesh.ops.delete(mesh, geom=[mesh.verts[index] for index in numpy.flatnonzero(doomed)], context="VERTS")
    mesh.to_mesh(thing.data)
    mesh.free()


def set_points(thing, name, kind, field, values):
    layer = thing.data.attributes.new(name, kind, "POINT")
    layer.data.foreach_set(field, numpy.asarray(values).ravel())


def load(materials):
    """
    Brings the muscles and bones of the trunk and limbs in from the atlas as
    one mesh, still in the atlas's own shape and position. Returns that mesh,
    the list of parts it is made of, and the atlas's joint positions.
    """
    if not os.path.exists(INDEX):
        build_index()

    with open(INDEX) as file:
        listing = json.load(file)

    def kind_of(names):
        if any(name in MUSCLE_MATERIALS for name in names):
            return MUSCLE

        return BONE if any(name.startswith("Bone") for name in names) else None

    chosen = [name for name, names in listing.items() if kind_of(names) is not None]

    with bpy.data.libraries.load(SOURCE) as (_source, wanted):
        wanted.objects = chosen

    scene = bpy.context.scene
    loaded = [thing for thing in wanted.objects if thing is not None and thing.type == "MESH"]

    for thing in loaded:
        scene.collection.objects.link(thing)

    bpy.context.view_layer.update()
    points = {thing.name: world_points(thing) for thing in loaded}

    def ends(name):
        return end_means(points[name])

    humerus, radius, ulna, femur, tibia = (ends(f"{bone}.l") for bone in ("Humerus", "Radius", "Ulna", "Femur", "Tibia"))
    knuckle = ends("Third metacarpal bone.l")

    joints = {
        "shoulder": humerus[0],
        "elbow": (humerus[1] + radius[0] + ulna[0]) / 3,
        "wrist": (radius[1] + ulna[1]) / 2,
        "hand": knuckle[1],
        "hip": femur[0],
        "knee": (femur[1] + tibia[0]) / 2,
        "ankle": tibia[1],
        "skull": points["Atlas (C1)"].mean(0),
    }

    jaw = points["Mandible"]
    front = jaw[jaw[:, 1] < numpy.median(jaw[:, 1])]
    joints["chin"] = front[numpy.argmin(front[:, 2])]

    hand_way = joints["hand"] - joints["wrist"]
    hand_way /= numpy.linalg.norm(hand_way)
    parts, kept = [], []

    for thing in loaded:
        own = points[thing.name]
        centre = own.mean(0)
        kind = kind_of(listing[thing.name])
        in_hand = abs(centre[0]) > 0.2 and centre[2] < 0.85
        lowered = thing.name.lower()

        group = "bone" if kind == BONE else group_of(thing.name, centre)
        # Muscles that match no training group are mostly organs, throat and face. Only those between the ribs are kept.
        stray = group == "other" and not any(word in lowered for word in ("intercostal", "costarum", "subcostal"))
        # The thin strap muscles of the throat sit where the trainer's jaw meets his neck, and show through there.
        under_jaw = any(word in lowered for word in ("hyoid", "platysma"))

        # Only the trunk and limbs. The head, hands and feet keep their skin, so nothing under it is needed.
        if in_hand or stray or under_jaw or not 0.085 < centre[2] < 1.52:
            bpy.data.objects.remove(thing)
            continue

        if kind == BONE:
            limb = "arm" if lowered.startswith(ARM_BONES) else "leg" if lowered.startswith(LEG_BONES) else "body"
        else:
            limb = "arm" if group in ARM_GROUPS else "leg" if group in LEG_GROUPS else "body"

        # The atlas mirrors one side to make the other. Bake that in, and turn the faces back the right way out.
        matrix = thing.matrix_world.copy()
        thing.data = thing.data.copy()
        thing.animation_data_clear()
        thing.parent = None
        thing.data.transform(matrix)

        if matrix.determinant() < 0:
            thing.data.flip_normals()

        thing.matrix_world.identity()

        for constraint in list(thing.constraints):
            thing.constraints.remove(constraint)

        for modifier in list(thing.modifiers):
            thing.modifiers.remove(modifier)

        # Nothing below the ankle, or in the upper neck where the trainer's own jaw takes over.
        top = joints["shoulder"][2] + 0.62 * (joints["skull"][2] - joints["shoulder"][2])
        doomed = (own[:, 2] < 0.07) | (own[:, 2] > top)

        if limb == "arm":
            # Tendons run on into the fingers. Stop them just past the wrist.
            wrist = joints["wrist"] * numpy.array([1.0 if centre[0] >= 0 else -1.0, 1.0, 1.0])
            way = hand_way * numpy.array([1.0 if centre[0] >= 0 else -1.0, 1.0, 1.0])
            doomed |= (own - wrist) @ way > 0.02

        if "abdominal oblique" in lowered or "transversus abdominis" in lowered:
            # These end in a sheet of tendon that wraps over the abdominals. Cut it away so they show.
            doomed |= (numpy.abs(own[:, 0]) < 0.077) & (own[:, 1] < -0.025)

        if doomed.all():
            bpy.data.objects.remove(thing)
            continue

        if doomed.any():
            remove_vertices(thing, doomed)
            own = own[~doomed]

        for slot, material in enumerate(thing.data.materials):
            name = material.name if material else ""
            flesh = kind == MUSCLE and name in MUSCLE_MATERIALS and "iliotibial" not in lowered
            thing.data.materials[slot] = materials[MUSCLE if flesh else BONE if name.startswith(("Bone", "Suture")) else TENDON]

        across, along = fibre_coordinates(thing.name, own) if kind == MUSCLE else (numpy.zeros_like(own), numpy.zeros(len(own)))
        set_points(thing, "across", "FLOAT_VECTOR", "vector", across)
        set_points(thing, "along", "FLOAT", "value", along)
        set_points(thing, "part", "INT", "value", numpy.full(len(own), len(parts)))

        for polygon in thing.data.polygons:
            polygon.use_smooth = True

        parts.append(Part(thing.name, kind, group, limb, centre[0] >= 0))
        kept.append(thing)

    bpy.ops.object.select_all(action="DESELECT")

    for thing in kept:
        thing.select_set(True)

    bpy.context.view_layer.objects.active = kept[0]
    bpy.ops.object.join()
    anatomy = bpy.context.object
    anatomy.name = "Anatomy"

    return anatomy, parts, joints


def read_parts(thing):
    """Which part each vertex of the joined anatomy came from."""
    layer = thing.data.attributes["part"]
    numbers = numpy.zeros(len(layer.data), dtype=numpy.int32)
    layer.data.foreach_get("value", numbers)

    return numbers.astype(int)


def faces_of(thing):
    """Every face as a tuple of vertex numbers."""
    count = len(thing.data.polygons)
    start, size = numpy.zeros(count, dtype=int), numpy.zeros(count, dtype=int)
    thing.data.polygons.foreach_get("loop_start", start)
    thing.data.polygons.foreach_get("loop_total", size)
    corners = numpy.zeros(len(thing.data.loops), dtype=int)
    thing.data.loops.foreach_get("vertex_index", corners)

    return start, size, corners


def tree_of(points, start, size, corners, keep):
    faces = [tuple(corners[first:first + count]) for first, count in zip(start[keep].tolist(), size[keep].tolist())]

    return BVHTree.FromPolygons(points.tolist(), faces)


def limb_frame(upper, lower):
    """Directions for stepping round a limb: along it, towards the front of the body, and towards its inner side."""
    axis = (lower - upper) / numpy.linalg.norm(lower - upper)
    front = numpy.array([0.0, -1.0, 0.0])
    front = front - front.dot(axis) * axis
    front /= numpy.linalg.norm(front)

    return axis, front, numpy.cross(axis, front)


def hit_inwards(tree, centre, outward, reach):
    """The first surface met coming in towards `centre` from `reach` away."""
    found = tree.ray_cast(Vector(centre + outward * reach), Vector(-outward), reach)

    return None if found[0] is None else numpy.array(found[0])


def hit_outwards(tree, centre, outward, reach=0.6):
    found = tree.ray_cast(Vector(centre), Vector(outward), reach)

    return None if found[0] is None else numpy.array(found[0])


def matching_points(atlas, trainer):
    """
    Pairs of points: where the trainer's skin is, and where it should go to
    lie just outside the atlas anatomy. `atlas` and `trainer` each give
    `joints`, and trees to cast rays against. Only the left side is sampled.
    The right is its mirror image.
    """
    pairs = []

    def add(source, target, centre, outward):
        pairs.append((target, source + outward * SKIN_GAP, numpy.linalg.norm(source - centre[0]), numpy.linalg.norm(target - centre[1])))

    def flush(label):
        # A ray that slips through a gap in the anatomy lands far too deep. Those stand out by their size ratio.
        nonlocal pairs
        ratios = numpy.array([inner / max(outer, 1e-6) for _, _, inner, outer in pairs])
        usual = numpy.median(ratios) if len(ratios) else 1.0
        good = [pair[:2] for pair, ratio in zip(pairs, ratios) if 0.62 * usual < ratio < 1.5 * usual]
        print(f"FIT {label}: kept {len(good)} of {len(pairs)}, atlas/trainer size {usual:.2f}")
        pairs = []

        return good

    matched = []

    for label, upper, lower, tree, reach, stations in (
        ("upper arm", "shoulder", "elbow", atlas["arm"], 0.11, (0.15, 0.28, 0.42, 0.56, 0.7, 0.84, 0.95)),
        ("forearm", "elbow", "wrist", atlas["arm"], 0.1, (0.06, 0.18, 0.32, 0.46, 0.6, 0.75, 0.9)),
        ("thigh", "hip", "knee", atlas["body"], 0.22, (0.1, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.92)),
        ("shin", "knee", "ankle", atlas["body"], 0.16, (0.06, 0.18, 0.32, 0.46, 0.6, 0.75, 0.9)),
    ):
        source_frame = limb_frame(atlas["joints"][upper], atlas["joints"][lower])
        target_frame = limb_frame(trainer["joints"][upper], trainer["joints"][lower])

        for along in stations:
            source_centre = atlas["joints"][upper] + (atlas["joints"][lower] - atlas["joints"][upper]) * along
            target_centre = trainer["joints"][upper] + (trainer["joints"][lower] - trainer["joints"][upper]) * along

            for step in range(12):
                turn = math.radians(step * 30)
                source_out = math.cos(turn) * source_frame[1] + math.sin(turn) * source_frame[2]
                target_out = math.cos(turn) * target_frame[1] + math.sin(turn) * target_frame[2]
                # Start no further out than the body's midline, or the ray begins inside the other leg.
                room = reach if source_out[0] >= 0 else min(reach, (source_centre[0] - 0.004) / -source_out[0])
                source = hit_inwards(tree, source_centre, source_out, room) if room > 0.03 else None
                target = hit_outwards(trainer["skin"], target_centre, target_out)

                if source is not None and target is not None and source[0] > 0.004 and target[0] > 0.004:
                    add(source, target, (source_centre, target_centre), source_out)

        matched += flush(label)
        matched.append((trainer["joints"][upper], atlas["joints"][upper]))
        matched.append((trainer["joints"][lower], atlas["joints"][lower]))

    def trunk_centre(tree, height):
        front = tree.ray_cast(Vector((0.012, -1.0, height)), Vector((0, 1, 0)), 2.0)[0]
        back = tree.ray_cast(Vector((0.012, 1.0, height)), Vector((0, -1, 0)), 2.0)[0]

        return None if front is None or back is None else numpy.array([0.0, (front.y + back.y) / 2, height])

    def ring(label, heights, turns, limit):
        for source_height, target_height in heights:
            source_centre = trunk_centre(atlas["body"], source_height)
            target_centre = trunk_centre(trainer["skin"], target_height)

            if source_centre is None or target_centre is None:
                continue

            matched.append((target_centre, source_centre))

            for degrees in turns:
                turn = math.radians(degrees)
                outward = numpy.array([math.sin(turn), -math.cos(turn), 0.0])
                source = hit_inwards(atlas["body"], source_centre, outward, 0.45)
                target = hit_outwards(trainer["skin"], target_centre, outward)

                if source is None or target is None:
                    continue

                # Out at the shoulder the trainer's skin is his arm, which the arm's own stations cover.
                if limit and (source[0] > atlas["joints"]["shoulder"][0] - 0.035 or target[0] > trainer["joints"]["shoulder"][0] - 0.045):
                    continue

                add(source, target, (source_centre, target_centre), outward)

        return flush(label)

    def heights(lower, upper, fractions):
        return [
            (
                atlas["joints"][lower][2] + (atlas["joints"][upper][2] - atlas["joints"][lower][2]) * fraction,
                trainer["joints"][lower][2] + (trainer["joints"][upper][2] - trainer["joints"][lower][2]) * fraction,
            )
            for fraction in fractions
        ]

    matched += ring("trunk", heights("hip", "shoulder", (0.0, 0.1, 0.2, 0.32, 0.45, 0.58, 0.7, 0.8, 0.9, 0.98)), range(0, 181, 15), True)
    # The front of the neck is windpipe, not muscle, so only its sides and back are matched.
    matched += ring("neck", heights("shoulder", "skull", (0.3, 0.5, 0.68)), (60, 90, 120, 150, 180), False)

    for rise in (20, 50, 80):
        for sweep in range(-90, 91, 30):
            up, round_ = math.radians(rise), math.radians(sweep)
            outward = numpy.array([math.cos(up) * math.cos(round_), -math.cos(up) * math.sin(round_), math.sin(up)])
            source = hit_inwards(atlas["all"], atlas["joints"]["shoulder"], outward, 0.2)
            target = hit_outwards(trainer["skin"], trainer["joints"]["shoulder"], outward)

            if source is not None and target is not None:
                add(source, target, (atlas["joints"]["shoulder"], trainer["joints"]["shoulder"]), outward)

    matched += flush("shoulder")
    return numpy.array([pair[0] for pair in matched]), numpy.array([pair[1] for pair in matched])


def both_sides(here, there):
    """Adds the mirror image of every pair of points that is not on the body's midline."""
    twin = here[:, 0] > 0.002
    flip = numpy.array([-1.0, 1.0, 1.0])

    return numpy.vstack([here, here[twin] * flip]), numpy.vstack([there, there[twin] * flip])


class Warp:
    """A smooth bend of space that carries each `source` point onto its `target`."""

    def __init__(self, source, target, give=4e-4):
        count = len(source)
        system = numpy.zeros((count + 4, count + 4))
        system[:count, :count] = numpy.linalg.norm(source[:, None] - source[None], axis=2) + give * numpy.eye(count)
        system[:count, count:] = numpy.hstack([source, numpy.ones((count, 1))])
        system[count:, :count] = system[:count, count:].T
        answer = numpy.vstack([target, numpy.zeros((4, 3))])
        self.source = source
        self.weights = numpy.linalg.solve(system, answer)

    def __call__(self, points):
        moved = numpy.zeros_like(points)
        count = len(self.source)

        for first in range(0, len(points), 4000):
            batch = points[first:first + 4000]
            distance = numpy.linalg.norm(batch[:, None] - self.source[None], axis=2)
            moved[first:first + 4000] = distance @ self.weights[:count] + numpy.hstack([batch, numpy.ones((len(batch), 1))]) @ self.weights[count:]

        return moved


def survey(anatomy, parts):
    """Which part each vertex belongs to, and trees for casting rays at the arm, at everything else, and at it all."""
    count = len(anatomy.data.vertices)
    flat = numpy.zeros(count * 3)
    anatomy.data.vertices.foreach_get("co", flat)
    points = flat.reshape(-1, 3)
    part = read_parts(anatomy)
    start, size, corners = faces_of(anatomy)
    face_part = part[corners[start]]
    limb = numpy.array([{"arm": 0, "leg": 1, "body": 2}[item.limb] for item in parts])
    left = numpy.array([item.left for item in parts])

    return points, part, {
        "arm": tree_of(points, start, size, corners, (limb[face_part] == 0) & left[face_part]),
        "body": tree_of(points, start, size, corners, limb[face_part] != 0),
        "all": tree_of(points, start, size, corners, numpy.ones(len(start), dtype=bool)),
    }


def skin_warp(trees, atlas_joints, skin_points, skin_faces, trainer_joints, extra):
    """
    The bend of space that wraps the posed trainer round the anatomy. `extra`
    is more pairs of points (left side only), used to hold the shape of the
    parts the anatomy does not reach: head, hands and feet.
    """
    skin_tree = BVHTree.FromPolygons(skin_points.tolist(), skin_faces)
    here, there = matching_points({**trees, "joints": atlas_joints}, {"joints": trainer_joints, "skin": skin_tree})
    here, there = both_sides(numpy.vstack([here, extra[0]]), numpy.vstack([there, extra[1]]))
    warp = Warp(here, there)
    print(f"FIT warp: {len(here)} matched points, worst miss {numpy.abs(warp(here) - there).max() * 1000:.1f} mm")

    return warp


def snug(points, normals, tree, hold, edges):
    """
    Draws the skin in (or lets it out) along its own normals until it lies
    SKIN_GAP off the anatomy beneath, so the muscles' shapes show through it.
    `hold` is 1 where the skin must stay as it is.
    """
    shift = numpy.full(len(points), numpy.nan)

    for index, (point, normal) in enumerate(zip(points.tolist(), normals.tolist())):
        if hold[index] > 0.5:
            continue

        start = Vector(point) + Vector(normal) * 0.02
        found = tree.ray_cast(start, -Vector(normal), 0.045)

        if found[0] is not None:
            shift[index] = 0.02 - found[3] + SKIN_GAP

    known = numpy.isfinite(shift)
    print(f"FIT snug: {int(known.sum())} of {len(points)} skin points sit over anatomy, median move {numpy.nanmedian(shift) * 1000:.1f} mm")
    first, second = edges[:, 0], edges[:, 1]

    # Even the moves out between neighbours, which also fills in the points that found nothing beneath them.
    for _ in range(4):
        value, weight = numpy.where(known, shift, 0.0), known.astype(float)
        total = numpy.bincount(first, weights=value[second], minlength=len(shift)) + numpy.bincount(second, weights=value[first], minlength=len(shift))
        near = numpy.bincount(first, weights=weight[second], minlength=len(shift)) + numpy.bincount(second, weights=weight[first], minlength=len(shift))
        average = total / numpy.maximum(near, 1e-9)
        shift = numpy.where(known, 0.5 * shift + 0.5 * numpy.where(near > 0, average, shift), numpy.where(near > 0, average, numpy.nan))
        known = numpy.isfinite(shift)

    shift = numpy.where(known, shift, 0.0) * (1.0 - hold)

    return points + normals * shift[:, None]


def bind(anatomy, parts, part, skin_points, skin_faces, skin_weights, bones, rig):
    """Transfers skinning from the nearest compatible skin on the same side and limb."""
    count = len(anatomy.data.vertices)
    flat = numpy.zeros(count * 3)
    anatomy.data.vertices.foreach_get("co", flat)
    points = flat.reshape(-1, 3)
    limb = numpy.array([{"arm": 0, "leg": 1, "body": 2}[item.limb] for item in parts])
    left = numpy.array([item.left for item in parts])
    corners_of_skin = numpy.array([(list(face) + [face[-1]] * 4)[:4] for face in skin_faces])
    nearest = numpy.zeros((count, 3))
    facing = numpy.zeros((count, 3))
    face = numpy.zeros(count, dtype=int)

    arm_bone = numpy.array([name.startswith(ARM_RIG) for name in bones])
    leg_bone = numpy.array([name.startswith(LEG_RIG) or name == "root" for name in bones])
    left_bone = numpy.array([not name.endswith(".R") for name in bones])
    right_bone = numpy.array([not name.endswith(".L") for name in bones])
    allowed = numpy.where(left[:, None], left_bone[None], right_bone[None])
    allowed &= numpy.where((limb == 0)[:, None], arm_bone[None], True)
    allowed &= numpy.where((limb == 1)[:, None], leg_bone[None], True)

    # Inner thighs nearly touch at rest. A global nearest-surface query can
    # find the opposite leg. Filter the search itself, rather than transferring
    # forbidden weights when the nearest surface has no compatible influences.
    for region, side in sorted(set(zip(limb.tolist(), left.tolist()))):
        members = (limb == region) & (left == side)
        permitted = allowed[numpy.flatnonzero(members)[0]]
        compatible = skin_weights[:, permitted].sum(1)[corners_of_skin]
        candidates = numpy.flatnonzero((compatible.mean(1) > 0.5) & (compatible.min(1) > 0.05))

        if not len(candidates):
            raise ValueError(f"No compatible skin for anatomy region {region}, left={side}")

        tree = BVHTree.FromPolygons(skin_points.tolist(), [skin_faces[index] for index in candidates])

        for index in numpy.flatnonzero(members[part]):
            nearest[index], facing[index], hit, _ = tree.find_nearest(points[index])
            face[index] = candidates[hit]

    # In tight folds the skin cannot be drawn clear of the anatomy, so the few points left outside it are tucked under.
    depth = numpy.einsum("ij,ij->i", nearest - points, facing)
    proud = depth < 0.0015
    points[proud] = nearest[proud] - facing[proud] * 0.0015
    anatomy.data.vertices.foreach_set("co", points.ravel())
    anatomy.data.update()
    print(f"FIT tucked {int(proud.sum())} of {count} anatomy points under the skin")

    quad = corners_of_skin[face]
    closeness = 1.0 / (numpy.linalg.norm(skin_points[quad] - nearest[:, None], axis=2) + 1e-4)
    closeness /= closeness.sum(1, keepdims=True)

    groups = [anatomy.vertex_groups.new(name=name) for name in bones]

    for first in range(0, count, 20000):
        chunk = slice(first, min(first + 20000, count))
        weight = numpy.einsum("ik,ikb->ib", closeness[chunk], skin_weights[quad[chunk]])
        weight *= allowed[part[chunk]]
        level = numpy.round(weight / numpy.maximum(weight.sum(1, keepdims=True), 1e-9) * 40).astype(int)

        for bone in numpy.flatnonzero(level.any(0)):
            for step in numpy.unique(level[:, bone]):
                if step > 0:
                    groups[bone].add((numpy.flatnonzero(level[:, bone] == step) + first).tolist(), step / 40, "REPLACE")

    binding = anatomy.modifiers.new("Skeleton", "ARMATURE")
    binding.object = rig
    anatomy.parent = rig


def under_skin(anatomy, part, skin_points, reach=0.035):
    """For each skin vertex, which part of the anatomy lies directly beneath it (-1 for none)."""
    count = len(anatomy.data.vertices)
    flat = numpy.zeros(count * 3)
    anatomy.data.vertices.foreach_get("co", flat)
    start, size, corners = faces_of(anatomy)
    tree = tree_of(flat.reshape(-1, 3), start, size, corners, numpy.ones(len(start), dtype=bool))
    face_part = part[corners[start]]
    found = numpy.full(len(skin_points), -1)

    for index, point in enumerate(skin_points.tolist()):
        hit = tree.find_nearest(point, reach)

        if hit[0] is not None:
            found[index] = face_part[hit[2]]

    return found


if __name__ == "__main__" and "--index" in sys.argv:
    write_index()
