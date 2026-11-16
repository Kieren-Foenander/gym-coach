"""
Renders exercise demonstrations: a mannequin performing a movement, with the
working muscles lit up.

Run with Blender, which needs the MPFB extension (the human generator) and
the MakeHuman base assets (skin, eyes, hair, shoes) in MPFB's user data
folder. tools/blender/README.md says how to get both.

    blender -b --python tools/blender/trainer.py -- <exercise> <output-dir> [--still] [--muscles]

The trainer has two layers: his skin, and under it the muscles, tendons and
bones from the Z-Anatomy atlas (see atlas.py). Normally the skin is opened
only over the muscles an exercise works. With --muscles it is taken off
everywhere the anatomy reaches.

Each exercise produces a folder of PNG frames. tools/blender/render.sh turns
those into the looping video the app plays.
"""

import math
import os
import sys

import bpy
import numpy
from mathutils import Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import atlas  # noqa: E402  (needs the path line above)

FPS = 30
WIDTH, HEIGHT = 720, 900

# Colours are linear RGB. The background matches the app's ink colour (#08090b).
INK = (0.0024, 0.0027, 0.0033)
SHORTS = (0.012, 0.013, 0.016)
VOLT = (0.68, 1.0, 0.047)
STEEL = (0.07, 0.075, 0.085)
# Anatomy further than this from the nearest skin vertex is too deep to poke through the skin.
DEEP = 0.02


# --------------------------------------------------------------------------- the trainer


# Extra muscle on top of the generator's general "muscular" setting, from 0 to 1.
PHYSIQUE = {
    "l-upperarm-muscle-incr": 1.0,
    "r-upperarm-muscle-incr": 1.0,
    "l-upperarm-shoulder-muscle-incr": 1.0,
    "r-upperarm-shoulder-muscle-incr": 1.0,
    "l-lowerarm-muscle-incr": 0.8,
    "r-lowerarm-muscle-incr": 0.8,
    "torso-muscle-pectoral-incr": 1.0,
    "torso-muscle-dorsi-incr": 0.8,
    "torso-vshape-incr": 0.6,
    "stomach-tone-incr": 1.0,
    "l-upperleg-muscle-incr": 0.8,
    "r-upperleg-muscle-incr": 0.8,
    "l-lowerleg-muscle-incr": 0.7,
    "r-lowerleg-muscle-incr": 0.7,
}

# What the trainer wears, as (kind, file under MPFB's user data folder).
OUTFIT = [
    ("Eyes", "eyes/high-poly/high-poly.mhclo"),
    ("Eyebrows", "eyebrows/eyebrow001/eyebrow001.mhclo"),
    ("Eyelashes", "eyelashes/eyelashes01/eyelashes01.mhclo"),
    ("Hair", "hair/short02/short02.mhclo"),
    ("Clothes", "clothes/shoes05/shoes05.mhclo"),
]
SKIN = "skins/young_caucasian_male/young_caucasian_male.mhmat"


def assets_folder():
    return os.path.join(bpy.utils.user_resource("EXTENSIONS"), ".user", "blender_org", "mpfb", "data")


def build_trainer():
    """A muscular man with skin, hair and trainers on, and a skeleton, standing in his rest pose."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.preferences.addon_enable(module="bl_ext.blender_org.mpfb")

    from bl_ext.blender_org.mpfb.services.humanservice import HumanService
    from bl_ext.blender_org.mpfb.services.targetservice import TargetService

    shape = TargetService.get_default_macro_info_dict()
    shape.update(gender=1.0, age=0.5, muscle=1.0, weight=0.6, proportions=1.0, height=0.6)
    shape["race"] = {"asian": 0.0, "caucasian": 1.0, "african": 0.0}

    body = HumanService.create_human(macro_detail_dict=shape, scale=0.1)

    for target, weight in PHYSIQUE.items():
        TargetService.load_target(body, TargetService.target_full_path(target), weight=weight, name=target)

    # The body shape is held as shape keys. Baking writes it into the vertices, so their positions can be measured.
    TargetService.bake_targets(body)
    rig = HumanService.add_builtin_rig(body, "default")

    folder = assets_folder()
    HumanService.set_character_skin(os.path.join(folder, SKIN), body, skin_type="MAKESKIN", material_instances=False)

    for kind, file in OUTFIT:
        HumanService.add_mhclo_asset(os.path.join(folder, file), body, asset_type=kind, subdiv_levels=1)

    for polygon in body.data.polygons:
        polygon.use_smooth = True

    smooth = body.modifiers.new("Smooth", "SUBSURF")
    smooth.levels = smooth.render_levels = 1

    return body, rig


def joint(rig, bone):
    """Where a bone starts, in world space, in the rest pose."""
    return rig.matrix_world @ rig.data.bones[bone].head_local


# --------------------------------------------------------------------------- muscles

def skin_weights(body, bones):
    """How strongly each vertex follows any of the given bones, from 0 to 1."""
    wanted = {group.index for group in body.vertex_groups if group.name in bones}

    return [
        sum(link.weight for link in vertex.groups if link.group in wanted)
        for vertex in body.data.vertices
    ]


def measure(thing):
    """World positions and outward directions of a mesh's vertices, as arrays."""
    count = len(thing.data.vertices)
    positions, normals = numpy.zeros(count * 3), numpy.zeros(count * 3)
    thing.data.vertices.foreach_get("co", positions)
    thing.data.vertices.foreach_get("normal", normals)
    turn = numpy.array(thing.matrix_world.to_3x3())

    return positions.reshape(-1, 3) @ turn.T + numpy.array(thing.matrix_world.translation), normals.reshape(-1, 3) @ turn.T


def store(thing, name, values):
    """Saves one number per vertex on a mesh, where a material can read it."""
    layer = thing.data.color_attributes.get(name) or thing.data.color_attributes.new(name, "FLOAT_COLOR", "POINT")
    layer.data.foreach_set("color", numpy.repeat(numpy.asarray(values, dtype=float), 4))


def smoothed_copy(body):
    """The skin as it is rendered: subdivided and smoothed, with the generator's hidden fitting aids removed."""
    import bmesh

    copy = body.copy()
    copy.data = body.data.copy()
    bpy.context.scene.collection.objects.link(copy)
    real = skin_weights(copy, ["body"])
    mesh = bmesh.new()
    mesh.from_mesh(copy.data)
    bmesh.ops.delete(mesh, geom=[vertex for vertex in mesh.verts if real[vertex.index] <= 0], context="VERTS")
    mesh.to_mesh(copy.data)
    mesh.free()

    for modifier in list(copy.modifiers):
        copy.modifiers.remove(modifier)

    finer = copy.modifiers.new("Finer", "SUBSURF")
    finer.levels = 1
    bpy.ops.object.select_all(action="DESELECT")
    copy.select_set(True)
    bpy.context.view_layer.objects.active = copy
    bpy.ops.object.modifier_apply(modifier="Finer")

    return copy


def skin_arrays(body, rig):
    """The skin as numbers: rest positions, faces, and how much each vertex follows each bone."""
    positions, _ = measure(body)
    real = skin_weights(body, ["body"])
    names = [bone.name for bone in rig.data.bones if bone.use_deform and bone.name in body.vertex_groups]
    column = {body.vertex_groups[name].index: index for index, name in enumerate(names)}
    weights = numpy.zeros((len(positions), len(names)))

    for vertex in body.data.vertices:
        for link in vertex.groups:
            if link.group in column:
                weights[vertex.index, column[link.group]] = link.weight

    weights /= numpy.maximum(weights.sum(1, keepdims=True), 1e-9)

    faces = [
        tuple(polygon.vertices) for polygon in body.data.polygons if all(real[index] > 0 for index in polygon.vertices)
    ]

    if not faces:
        # A copy with the fitting aids already removed has lost the group that marked them.
        faces = [tuple(polygon.vertices) for polygon in body.data.polygons]

    edges = numpy.zeros(len(body.data.edges) * 2, dtype=int)
    body.data.edges.foreach_get("vertices", edges)

    return {"rest": positions, "faces": faces, "weights": weights, "bones": names, "edges": edges.reshape(-1, 2)}


def anatomy_materials():
    """Muscle with fibres that glow when it works, pale tendon, and bone."""
    muscle = bpy.data.materials.new("Muscle")
    muscle.use_nodes = True
    nodes, links = muscle.node_tree.nodes, muscle.node_tree.links
    shader = nodes["Principled BSDF"]
    shader.inputs["Roughness"].default_value = 0.45
    shader.inputs["Subsurface Weight"].default_value = 0.04

    def attribute(name, output="Fac"):
        node = nodes.new("ShaderNodeAttribute")
        node.attribute_name = name

        return node.outputs[output]

    def calc(operation, first, second=None, clamp=False):
        node = nodes.new("ShaderNodeMath")
        node.operation = operation
        node.use_clamp = clamp

        for socket, value in zip(node.inputs, (first, second)):
            if value is None:
                continue

            if isinstance(value, (int, float)):
                socket.default_value = value
            else:
                links.new(value, socket)

        return node.outputs[0]

    def mix(factor, first, second):
        node = nodes.new("ShaderNodeMix")
        node.data_type = "RGBA"

        if isinstance(factor, (int, float)):
            node.inputs["Factor"].default_value = factor
        else:
            links.new(factor, node.inputs["Factor"])

        for socket, value in ((node.inputs["A"], first), (node.inputs["B"], second)):
            if isinstance(value, tuple):
                socket.default_value = (*value, 1.0)
            else:
                links.new(value, socket)

        return node.outputs["Result"]

    def streaks(across_scale, along_scale):
        """A pattern squeezed across the fibres and stretched along them, which reads as fibres."""
        squeeze = nodes.new("ShaderNodeVectorMath")
        squeeze.operation = "SCALE"
        links.new(attribute("across", "Vector"), squeeze.inputs[0])
        squeeze.inputs["Scale"].default_value = across_scale
        noise = nodes.new("ShaderNodeTexNoise")
        noise.noise_dimensions = "4D"
        noise.inputs["Scale"].default_value = 1.0
        noise.inputs["Detail"].default_value = 2.0
        links.new(squeeze.outputs["Vector"], noise.inputs["Vector"])
        links.new(calc("MULTIPLY", attribute("along"), along_scale), noise.inputs["W"])

        return noise.outputs["Fac"]

    fine, bundles = streaks(900.0, 16.0), streaks(260.0, 7.0)
    lines = calc("ADD", calc("MULTIPLY", fine, 0.65), calc("MULTIPLY", bundles, 0.35))
    contrast = nodes.new("ShaderNodeMapRange")
    contrast.inputs["From Min"].default_value, contrast.inputs["From Max"].default_value = 0.34, 0.66
    links.new(lines, contrast.inputs["Value"])
    flesh = mix(contrast.outputs["Result"], (0.13, 0.01, 0.012), (0.5, 0.05, 0.04))

    # Working muscles keep their colour and glow. The rest are drained towards grey so the eye goes to the work.
    work = attribute("work")
    grey = nodes.new("ShaderNodeRGBToBW")
    links.new(flesh, grey.inputs["Color"])
    quiet = mix(0.6, flesh, mix(1.0, flesh, grey.outputs["Val"]))
    links.new(mix(calc("SUBTRACT", 1.0, work, clamp=True), flesh, quiet), shader.inputs["Base Color"])

    glow = nodes.new("ShaderNodeValue")
    glow.name = glow.label = "Glow"
    glow.outputs[0].default_value = 1.0
    links.new(mix(0.35, flesh, (1.0, 0.25, 0.1)), shader.inputs["Emission Color"])
    links.new(calc("MULTIPLY", work, glow.outputs[0]), shader.inputs["Emission Strength"])

    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.4
    bump.inputs["Distance"].default_value = 0.0015
    links.new(contrast.outputs["Result"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])

    def plain(name, colour, roughness):
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        plain_shader = material.node_tree.nodes["Principled BSDF"]
        plain_shader.inputs["Base Color"].default_value = (*colour, 1.0)
        plain_shader.inputs["Roughness"].default_value = roughness

        return material

    return {
        atlas.MUSCLE: muscle,
        atlas.TENDON: plain("Tendon", (0.47, 0.38, 0.3), 0.5),
        atlas.BONE: plain("Bone", (0.6, 0.54, 0.44), 0.6),
    }


def anatomical_pose(rig, joints, palms):
    """Stands the trainer as the atlas figure stands: arms hanging, palms forward, legs as the atlas has them."""
    def way(upper, lower, mirror):
        return (joints[lower] - joints[upper]) * numpy.array([mirror, 1.0, 1.0])

    for side, mirror in ((".L", 1.0), (".R", -1.0)):
        foot = rig.matrix_world.to_quaternion() @ rig.data.bones[f"foot{side}"].matrix_local.to_quaternion()
        ahead, across = foot @ Y(), foot @ Vector((1, 0, 0))

        pose_arm(
            rig, side,
            upper=way("shoulder", "elbow", mirror),
            fore=way("elbow", "wrist", mirror),
            palm_local=palms[side],
            palm_faces=(0, -1, 0),
        )
        orient(rig, f"upperleg01{side}", way("hip", "knee", mirror), tip=f"lowerleg01{side}")
        orient(rig, f"lowerleg01{side}", way("knee", "ankle", mirror), tip=f"foot{side}")
        # Keep the feet as they were, flat on the floor.
        orient(rig, f"foot{side}", ahead, (1, 0, 0), across)


def clear_pose(rig):
    for bone in rig.pose.bones:
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = Quaternion()
        bone.location = (0, 0, 0)

    refresh()


def posed_points(arrays, rig):
    """Where a mesh's vertices are with the skeleton in its current pose. Vertices that follow no bone stay put."""
    moves = numpy.array([
        numpy.array(rig.pose.bones[name].matrix @ rig.data.bones[name].matrix_local.inverted()) for name in arrays["bones"]
    ])
    blend = (arrays["weights"] @ moves.reshape(len(moves), 16)).reshape(-1, 4, 4)
    posed = numpy.einsum("nij,nj->ni", blend[:, :3, :3], arrays["rest"]) + blend[:, :3, 3]
    loose = arrays["weights"].sum(1) < 0.5
    posed[loose] = arrays["rest"][loose]

    return posed


def move_vertices(thing, positions):
    """Sets a mesh's vertices from world positions."""
    back = numpy.array(thing.matrix_world.inverted())
    thing.data.vertices.foreach_set("co", (positions @ back[:3, :3].T + back[:3, 3]).ravel())
    thing.data.update()


def rebuild_skeleton(rig, warp):
    """Makes the skeleton's current pose, carried through the warp, its new rest pose."""
    bones = {
        bone.name: tuple(numpy.array(rig.matrix_world @ point) for point in (bone.head, bone.tail, bone.head + bone.z_axis * 0.02))
        for bone in rig.pose.bones
    }
    moved = {name: warp(numpy.array(points)) for name, points in bones.items()}

    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")

    for bone in rig.data.edit_bones:
        # Connected bones drag each other's ends about as they are edited.
        bone.use_connect = False

    for bone in rig.data.edit_bones:
        head, tail, side = moved[bone.name]
        bone.head, bone.tail = head, tail
        bone.align_roll(Vector(side - head))

    bpy.ops.object.mode_set(mode="OBJECT")
    clear_pose(rig)


def hold_shape(points, pivot, onto, scale, turn=None, count=60):
    """
    Pairs of points that keep a part of the body rigid through the warp: a
    spread of its own points, and where each lands when the part is scaled
    about `pivot`, optionally turned, and moved so the pivot sits at `onto`.
    """
    picked = points[:: max(1, len(points) // count)]
    offset = picked - pivot

    if turn is not None:
        offset = offset @ numpy.array(turn.to_matrix()).T

    return picked, onto + scale * offset


def add_anatomy(body, rig, palms):
    """
    Brings in the atlas's muscles, tendons and bones, reshapes the trainer to
    wrap round them, and binds them to his skeleton so both layers move together.
    """
    anatomy, parts, joints = atlas.load(anatomy_materials())
    _, part, trees = atlas.survey(anatomy, parts)
    # Measure against the smoothed skin that gets rendered, which sits a little inside the coarse one.
    smooth = smoothed_copy(body)
    skin = skin_arrays(smooth, rig)
    bpy.data.objects.remove(smooth)
    clothes = [
        thing for thing in bpy.context.scene.objects
        if thing.type == "MESH" and thing is not anatomy and any(modifier.type == "ARMATURE" and modifier.object == rig for modifier in thing.modifiers)
    ]

    anatomical_pose(rig, joints, palms)
    place = lambda name: numpy.array(rig.matrix_world @ rig.pose.bones[name].head)
    posed = posed_points(skin, rig)

    trainer_joints = {
        "shoulder": place("upperarm01.L"), "elbow": place("lowerarm01.L"), "wrist": place("wrist.L"),
        "hip": place("upperleg01.L"), "knee": place("lowerleg01.L"), "ankle": place("foot.L"),
        "skull": place("head"),
    }

    # The anatomy stops at the neck, wrists and ankles. Beyond them the trainer keeps his own shape, scaled to match.
    def follows(roots):
        chosen = [bone.name for bone in rig.data.bones if any(root in [bone.name, *(parent.name for parent in bone.parent_recursive)] for root in roots)]

        return skin["weights"][:, [name in chosen for name in skin["bones"]]].sum(1)

    size = (joints["shoulder"][2] - joints["ankle"][2]) / (trainer_joints["shoulder"][2] - trainer_joints["ankle"][2])
    head = posed[follows(["head"]) > 0.9]
    # The chin is the lowest point of the front of the head. Its skin is shared with the neck, hence the looser test.
    jaw = posed[follows(["head"]) > 0.5]
    front = jaw[jaw[:, 1] < numpy.percentile(jaw[:, 1], 30)]
    chin = front[numpy.argmin(front[:, 2])] * numpy.array([0.0, 1.0, 1.0])
    hand = posed[(follows(["wrist.L"]) > 0.9)]
    knuckle = place("finger3-1.L")
    hand_way, atlas_way = knuckle - trainer_joints["wrist"], joints["hand"] - joints["wrist"]
    foot = posed[follows(["foot.L"]) > 0.9]

    held = [
        hold_shape(head, chin, joints["chin"] * numpy.array([0.0, 1.0, 1.0]) + numpy.array([0.0, -0.007, -0.007]), size * 1.02, count=120),
        hold_shape(
            hand, trainer_joints["wrist"], joints["wrist"], numpy.linalg.norm(atlas_way) / numpy.linalg.norm(hand_way),
            turn=Vector(hand_way).rotation_difference(Vector(atlas_way)),
        ),
        hold_shape(foot, trainer_joints["ankle"], joints["ankle"], size),
    ]
    extra = (numpy.vstack([pair[0] for pair in held]), numpy.vstack([pair[1] for pair in held]))
    print(f"FIT trainer is scaled by {size:.2f} to the atlas's height")

    warp = atlas.skin_warp(trees, joints, posed, skin["faces"], trainer_joints, extra)

    # Everything the trainer is made of goes through the same warp, in the pose it was measured in.
    for thing in clothes:
        move_vertices(thing, warp(posed_points(skin_arrays(thing, rig), rig)))

    rebuild_skeleton(rig, warp)

    # Draw the skin in onto the muscles, so their shapes show through it.
    coarse = skin_arrays(body, rig)
    closed = numpy.clip(follows_on(coarse, rig, ["head", "wrist.L", "wrist.R", "foot.L", "foot.R"]) * 2.5, 0.0, 1.0)
    _, normals = measure(body)
    move_vertices(body, atlas.snug(coarse["rest"], normals, trees["all"], closed, coarse["edges"]))
    coarse = skin_arrays(body, rig)

    # Bind to the skin as it now is, smoothed the way it will be rendered.
    smooth = smoothed_copy(body)
    final = skin_arrays(smooth, rig)
    bpy.data.objects.remove(smooth)
    atlas.bind(anatomy, parts, part, final["rest"], final["faces"], final["weights"], final["bones"], rig)

    return {
        "body": body,
        "anatomy": anatomy,
        "parts": parts,
        "part": part,
        "beneath": atlas.under_skin(anatomy, part, coarse["rest"]),
        "cover": covering_skin(anatomy, body),
        # The head, hands and feet always keep their skin.
        "closed": closed,
        "edges": coarse["edges"],
        "palms": palms,
        "bare": False,
    }


def covering_skin(anatomy, body):
    """For each anatomy vertex, the skin vertex nearest to it and how far away that is."""
    from mathutils.kdtree import KDTree

    points, _ = measure(anatomy)
    skin, _ = measure(body)
    real = numpy.flatnonzero(numpy.array(skin_weights(body, ["body"])) > 0)
    tree = KDTree(len(real))

    for index in real.tolist():
        tree.insert(skin[index], index)

    tree.balance()
    found = [tree.find(point)[1:] for point in points.tolist()]

    return numpy.array([index for index, _ in found]), numpy.array([distance for _, distance in found])


def follows_on(arrays, rig, roots):
    """How much each vertex follows the named bones or any bone that hangs off them."""
    chosen = [bone.name for bone in rig.data.bones if any(root in [bone.name, *(parent.name for parent in bone.parent_recursive)] for root in roots)]

    return arrays["weights"][:, [name in chosen for name in arrays["bones"]]].sum(1)


def paint(model, primary, secondary):
    """
    Marks the muscle groups an exercise works. Those muscles glow, the primary
    ones more, and the skin opens over them so they can be seen.
    """
    groups = numpy.array([part.group for part in model["parts"]] + ["none"])
    flesh = numpy.array([part.kind == atlas.MUSCLE for part in model["parts"]] + [False])
    effort = numpy.where(numpy.isin(groups, primary), 1.0, numpy.where(numpy.isin(groups, secondary), 0.35, 0.0)) * flesh

    anatomy = model["anatomy"]
    layer = anatomy.data.attributes.get("work") or anatomy.data.attributes.new("work", "FLOAT", "POINT")
    layer.data.foreach_set("value", effort[model["part"]])

    beneath = model["beneath"]
    opened = (beneath >= 0).astype(float) if model["bare"] else (effort[beneath] > 0).astype(float)
    first, second = model["edges"][:, 0], model["edges"][:, 1]
    degree = numpy.maximum(numpy.bincount(numpy.concatenate([first, second]), minlength=len(opened)), 1)

    def around(values):
        """The average of each vertex's neighbours."""
        total = numpy.bincount(first, weights=values[second], minlength=len(values))
        total += numpy.bincount(second, weights=values[first], minlength=len(values))

        return total / degree

    # Tidy up first: a speck of opening with closed skin all round it closes, and a speck of skin left in an opening goes.
    for _ in range(2):
        share = around(opened)
        opened = numpy.where(share < 0.34, 0.0, numpy.where(share > 0.66, 1.0, opened))

    # Soften the edge of each opening by averaging with neighbouring vertices.
    for _ in range(2):
        opened = 0.5 * opened + 0.5 * around(opened)

    opened *= 1.0 - model["closed"]
    store(model["body"], "reveal", opened)

    # Resting muscle just under closed skin is taken out. The skin hides it anyway, and where
    # a joint bends the two layers move a little differently, which would let it show through.
    # (Removing it is far quicker to render than making it transparent.)
    near, distance = model["cover"]
    wide = (opened > 0.05).astype(float)

    for _ in range(2):
        wide = numpy.maximum(wide, (around(wide) > 0).astype(float))

    hidden = ~(model["bare"] | (effort[model["part"]] > 0) | (distance > DEEP) | (wide[near] > 0))
    atlas.remove_vertices(anatomy, hidden)
    model["part"], model["cover"] = model["part"][~hidden], (near[~hidden], distance[~hidden])
    print(f"FIT removed {int(hidden.sum())} of {len(hidden)} anatomy points lying under closed skin")

    if "shorts" in model:
        shorts, source, thigh = model["shorts"]
        cloth = opened[source]

        # Leg work leaves the shorts in tatters down the thighs, so there they come off whole and a neat brief stays.
        if cloth[thigh > 0.5].mean() > 0.4:
            cloth = numpy.maximum(cloth, numpy.clip((thigh - 0.35) / 0.3, 0.0, 1.0))

        store(shorts, "reveal", cloth)


def add_reveal(material, rim=(0.1, 0.015, 0.012)):
    """Lets a surface open wherever its `reveal` value is high, with a rim of the given colour round each opening."""
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")

    reveal = nodes.new("ShaderNodeAttribute")
    reveal.attribute_name = "reveal"

    def ramp(low, high):
        node = nodes.new("ShaderNodeMapRange")
        node.interpolation_type = "SMOOTHSTEP"
        node.inputs["From Min"].default_value, node.inputs["From Max"].default_value = low, high
        links.new(reveal.outputs["Fac"], node.inputs["Value"])

        return node.outputs["Result"]

    solid = nodes.new("ShaderNodeMath")
    solid.operation = "SUBTRACT"
    solid.inputs[0].default_value = 1.0
    links.new(ramp(0.42, 0.58), solid.inputs[1])
    links.new(solid.outputs[0], shader.inputs["Alpha"])

    colour = shader.inputs["Base Color"]

    if rim is not None and colour.links:
        edge = nodes.new("ShaderNodeMix")
        edge.data_type = "RGBA"
        links.new(ramp(0.15, 0.42), edge.inputs["Factor"])
        links.new(colour.links[0].from_socket, edge.inputs["A"])
        edge.inputs["B"].default_value = (*rim, 1.0)
        links.new(edge.outputs["Result"], colour)

    material.surface_render_method = "DITHERED"


def fabric(name, colour):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = (*colour, 1.0)
    shader.inputs["Roughness"].default_value = 0.85
    shader.inputs["Sheen Weight"].default_value = 0.1

    return material


def add_shorts(body, rig):
    """Makes a pair of fitted shorts from the skin of the hips and upper thighs, pushed out a little."""
    hip = joint(rig, "upperleg01.L").z
    knee = joint(rig, "lowerleg01.L").z
    waist, hem = hip + 0.1, hip + (knee - hip) * 0.55
    legs = skin_weights(body, [f"{bone}{side}" for bone in ("upperleg01", "upperleg02", "pelvis") for side in (".L", ".R")])
    trunk = skin_weights(body, ["root", "spine05", "spine04"])
    # The generator keeps fitting aids in the same mesh, hidden. Only real skin belongs in the shorts.
    real = skin_weights(body, ["body"])

    def covered(vertex):
        height = (body.matrix_world @ vertex.co).z
        index = vertex.index

        # Arms hang past the hips in some poses, so only skin on the legs and trunk counts.
        return real[index] > 0 and hem < height < waist and legs[index] + trunk[index] > 0.5

    keep = {vertex.index for vertex in body.data.vertices if covered(vertex)}

    # Remember which skin vertex each vertex of the shorts came from, so the shorts can open where the skin does.
    numbered = body.data.attributes.get("source") or body.data.attributes.new("source", "INT", "POINT")
    numbered.data.foreach_set("value", numpy.arange(len(body.data.vertices), dtype=numpy.int32))

    shorts = body.copy()
    shorts.data = body.data.copy()
    shorts.name = "Shorts"
    bpy.context.scene.collection.objects.link(shorts)

    import bmesh

    mesh = bmesh.new()
    mesh.from_mesh(shorts.data)
    bmesh.ops.delete(
        mesh, geom=[face for face in mesh.faces if not all(vertex.index in keep for vertex in face.verts)], context="FACES"
    )
    mesh.to_mesh(shorts.data)
    mesh.free()

    for modifier in list(shorts.modifiers):
        if modifier.type == "MASK":
            shorts.modifiers.remove(modifier)

    puff = shorts.modifiers.new("Puff", "DISPLACE")
    puff.strength = 0.012
    puff.mid_level = 0.0
    bpy.context.view_layer.objects.active = shorts
    bpy.ops.object.modifier_move_to_index(modifier="Puff", index=0)

    cloth = fabric("Shorts", SHORTS)
    add_reveal(cloth, rim=None)
    shorts.data.materials.clear()
    shorts.data.materials.append(cloth)
    source = numpy.zeros(len(shorts.data.vertices), dtype=numpy.int32)
    shorts.data.attributes["source"].data.foreach_get("value", source)

    thigh = numpy.array(skin_weights(body, [f"{bone}{side}" for bone in ("upperleg01", "upperleg02") for side in (".L", ".R")]))

    return shorts, source, thigh[source]


# --------------------------------------------------------------------------- posing


def refresh():
    bpy.context.view_layer.update()


def world_rotation(rig, bone):
    return (rig.matrix_world @ bone.matrix).to_quaternion()


def Y():
    return Vector((0, 1, 0))


def orient(rig, name, direction, local_side=None, world_side=None, tip=None):
    """
    Turns a bone to point along a world direction. Given a second pair of
    vectors, it also rolls the bone about its length so that `local_side`
    (in the bone's own axes) faces as close to `world_side` as it can.

    A limb is a chain of bones that is not quite straight. Naming the bone at
    its far joint as `tip` points the line between the two joints, rather
    than this one bone, along the direction.
    """
    bone = rig.pose.bones[name]
    bone.rotation_mode = "QUATERNION"
    bone.rotation_quaternion = Quaternion()
    refresh()

    direction = Vector(direction).normalized()
    frame = world_rotation(rig, bone)
    current = frame @ Y() if tip is None else rig.matrix_world.to_3x3() @ (rig.pose.bones[tip].head - bone.head)
    posed = current.normalized().rotation_difference(direction) @ frame

    if local_side is not None:
        # Compare the two side vectors flattened onto the plane the bone points out of.
        flat = lambda vector: (vector - vector.dot(direction) * direction).normalized()
        current, wanted = flat(posed @ Vector(local_side)), flat(Vector(world_side))
        angle = math.atan2(current.cross(wanted).dot(direction), current.dot(wanted))
        posed = Quaternion(direction, angle) @ posed

    bone.rotation_quaternion = frame.inverted() @ posed
    refresh()


def twist_of(bone):
    """How far a bone is rolled about its own length, in radians."""
    rotation = bone.rotation_quaternion

    return 2 * math.atan2(rotation.y, rotation.w)


def rest_palm(rig, side):
    """The direction a palm faces, in the wrist bone's own axes. Call before posing: at rest the palms face the floor."""
    index, little = joint(rig, f"finger2-1{side}"), joint(rig, f"finger5-1{side}")
    normal = (little - index).cross((index + little) / 2 - joint(rig, f"wrist{side}")).normalized()

    if normal.z > 0:
        normal.negate()

    wrist = rig.data.bones[f"wrist{side}"]

    return (rig.matrix_world.to_quaternion() @ wrist.matrix_local.to_quaternion()).inverted() @ normal


def pose_arm(rig, side, upper, fore, palm_local, palm_faces):
    """Points the upper arm and forearm, and turns the hand so its palm faces `palm_faces`."""
    orient(rig, f"upperarm01{side}", upper, tip=f"lowerarm01{side}")
    orient(rig, f"lowerarm01{side}", fore, tip=f"wrist{side}")

    twister = rig.pose.bones[f"lowerarm02{side}"]
    twister.rotation_mode = "QUATERNION"
    twister.rotation_quaternion = Quaternion()
    orient(rig, f"wrist{side}", fore, palm_local, palm_faces)

    # Real forearms twist along their length. Giving most of the hand's roll
    # to the lower forearm bone stops the wrist looking wrung out.
    twister.rotation_quaternion = Quaternion(Y(), twist_of(rig.pose.bones[f"wrist{side}"]) * 0.7)
    orient(rig, f"wrist{side}", fore, palm_local, palm_faces)


def bend_point(start, end, first, second, pole):
    """
    Where the middle joint of a two-part limb goes (the knee or elbow) when
    the limb runs from `start` to `end`. `first` and `second` are the lengths
    of its two parts, and `pole` is roughly the way the joint should point.
    """
    start, end = Vector(start), Vector(end)
    span = end - start
    # A limb cannot reach further than its own length, nor fold shorter than the difference of its parts.
    length = max(abs(first - second) + 1e-4, min(span.length, (first + second) * 0.999))
    way = span.normalized()
    along = (first * first - second * second + length * length) / (2 * length)
    out = Vector(pole) - Vector(pole).dot(way) * way

    return start + way * along + out.normalized() * math.sqrt(max(first * first - along * along, 0.0))


def reach_arm(rig, side, wrist, pole, palm_local, palm_faces):
    """Puts a hand at a point, bending the elbow towards `pole`."""
    refresh()
    shoulder = rig.matrix_world @ rig.pose.bones[f"upperarm01{side}"].head
    upper = (joint(rig, f"lowerarm01{side}") - joint(rig, f"upperarm01{side}")).length
    fore = (joint(rig, f"wrist{side}") - joint(rig, f"lowerarm01{side}")).length
    elbow = bend_point(shoulder, wrist, upper, fore, pole)
    pose_arm(rig, side, elbow - shoulder, Vector(wrist) - elbow, palm_local, palm_faces)


def reach_leg(rig, side, ankle, pole, ahead, across):
    """Puts a foot at a point, flat and pointing `ahead`, bending the knee towards `pole`."""
    refresh()
    hip = rig.matrix_world @ rig.pose.bones[f"upperleg01{side}"].head
    thigh = (joint(rig, f"lowerleg01{side}") - joint(rig, f"upperleg01{side}")).length
    shin = (joint(rig, f"foot{side}") - joint(rig, f"lowerleg01{side}")).length
    knee = bend_point(hip, ankle, thigh, shin, pole)
    orient(rig, f"upperleg01{side}", knee - hip, tip=f"lowerleg01{side}")
    orient(rig, f"lowerleg01{side}", Vector(ankle) - knee, tip=f"foot{side}")
    orient(rig, f"foot{side}", ahead, (1, 0, 0), across)


def place_hips(rig, hip, lean):
    """Leans the whole trunk forward by `lean` radians and moves it so the left hip joint sits at `hip`."""
    root = rig.pose.bones["root"]
    root.rotation_mode = "QUATERNION"
    root.rotation_quaternion = Quaternion()
    root.location = (0, 0, 0)
    turn(rig, "root", (1, 0, 0), lean)
    shift = Vector(hip) - rig.matrix_world @ rig.pose.bones["upperleg01.L"].head
    # A bone's location is measured along its own rest axes.
    root.location = (rig.matrix_world.to_3x3() @ rig.data.bones["root"].matrix_local.to_3x3()).inverted() @ shift
    refresh()


def turn(rig, name, axis, angle):
    """Rotates a bone about a world axis, on top of however it is already posed."""
    bone = rig.pose.bones[name]
    bone.rotation_mode = "QUATERNION"
    refresh()

    frame = world_rotation(rig, bone)
    local = frame.inverted() @ Quaternion(Vector(axis).normalized(), angle) @ frame
    bone.rotation_quaternion = bone.rotation_quaternion @ local
    refresh()


def hand_axes(rig, side, palm_local):
    """Three world directions for a posed hand: across the knuckles, along the hand, and out of the palm."""
    bones = rig.pose.bones
    place = lambda name: rig.matrix_world @ bones[name].head
    index, little, wrist = place(f"finger2-1{side}"), place(f"finger5-1{side}"), place(f"wrist{side}")
    palm = world_rotation(rig, bones[f"wrist{side}"]) @ Vector(palm_local)

    return (little - index).normalized(), ((index + little) / 2 - wrist).normalized(), palm


def grip(rig, side, palm_local, curl=1.0):
    """Closes the fingers of one hand around a handle."""
    refresh()
    across, along, palm = hand_axes(rig, side, palm_local)
    # Curl whichever way carries the fingertips towards the palm.
    direction = 1 if across.cross(along).dot(palm) > 0 else -1

    for finger in (2, 3, 4, 5):
        for segment in (1, 2, 3):
            turn(rig, f"finger{finger}-{segment}{side}", across, direction * curl)


def keyframe(rig, frame):
    for bone in rig.pose.bones:
        bone.keyframe_insert("rotation_quaternion", frame=frame)
        bone.keyframe_insert("location", frame=frame)


def ease(value):
    """Smooth start and stop for a value running from 0 to 1."""
    return value * value * (3 - 2 * value)


# --------------------------------------------------------------------------- equipment


def metal(name, colour, roughness):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = (*colour, 1.0)
    shader.inputs["Metallic"].default_value = 1.0
    shader.inputs["Roughness"].default_value = roughness

    return material


def dumbbell():
    """A dumbbell lying along its local X axis, centred on the handle."""
    parts = []

    def cylinder(radius, depth, x, sides=24):
        bpy.ops.mesh.primitive_cylinder_add(
            radius=radius, depth=depth, vertices=sides, location=(x, 0, 0), rotation=(0, math.pi / 2, 0)
        )
        parts.append(bpy.context.object)

    cylinder(0.014, 0.16, 0)

    for direction in (-1, 1):
        cylinder(0.052, 0.05, direction * 0.092, sides=6)
        cylinder(0.046, 0.012, direction * 0.062)

    bpy.ops.object.select_all(action="DESELECT")

    for part in parts:
        part.select_set(True)

    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    # Each part was made turned on its side. Applying that leaves the handle along the joined object's own X axis.
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    weight = bpy.context.object
    weight.name = "Dumbbell"
    weight.data.materials.append(metal("Steel", STEEL, 0.5))

    bevel = weight.modifiers.new("Bevel", "BEVEL")
    bevel.width = 0.004
    bevel.segments = 2

    return weight


def barbell(plate_radius=0.2):
    """An Olympic bar with a plate on each end, lying along its local X axis."""
    parts = []

    def cylinder(radius, depth, x, sides=32):
        bpy.ops.mesh.primitive_cylinder_add(
            radius=radius, depth=depth, vertices=sides, location=(x, 0, 0), rotation=(0, math.pi / 2, 0)
        )
        parts.append(bpy.context.object)

    cylinder(0.014, 2.0, 0)

    for direction in (-1, 1):
        cylinder(0.025, 0.36, direction * 0.84)
        cylinder(plate_radius, 0.05, direction * 0.7)
        cylinder(0.035, 0.03, direction * 0.74)

    bpy.ops.object.select_all(action="DESELECT")

    for part in parts:
        part.select_set(True)

    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bar = bpy.context.object
    bar.name = "Barbell"
    # Dark and rough, like rubber-coated plates, so the big discs do not flare under the lights.
    bar.data.materials.append(metal("Bar steel", (0.02, 0.021, 0.024), 0.75))

    bevel = bar.modifiers.new("Bevel", "BEVEL")
    bevel.width = 0.004
    bevel.segments = 2

    return bar


def attach(rig, item, bone):
    """Makes an item follow a bone from where it currently is."""
    refresh()
    placed = item.matrix_world.copy()
    item.parent = rig
    item.parent_type = "BONE"
    item.parent_bone = bone
    refresh()
    item.matrix_world = placed
    refresh()


def hold(rig, item, side, palm_local):
    """Puts an item in a hand, lying across the palm, and makes it follow that hand."""
    refresh()
    bones = rig.pose.bones
    across, along, palm = hand_axes(rig, side, palm_local)
    knuckles = rig.matrix_world @ ((bones[f"finger2-1{side}"].head + bones[f"finger5-1{side}"].head) / 2)

    item.rotation_mode = "QUATERNION"
    item.rotation_quaternion = Vector((1, 0, 0)).rotation_difference(across)
    item.location = knuckles + along * 0.005 + palm * 0.032
    refresh()

    # Parent to the hand without moving the item from where it was just placed.
    placed = item.matrix_world.copy()
    item.parent = rig
    item.parent_type = "BONE"
    item.parent_bone = f"wrist{side}"
    refresh()
    item.matrix_world = placed


# --------------------------------------------------------------------------- the stage


def stage(target, distance, height, angle):
    """Background, lights and a camera looking at `target` from `angle` degrees round to the side."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = WIDTH, HEIGHT
    scene.render.fps = FPS
    scene.view_settings.view_transform = "Standard"
    scene.render.image_settings.file_format = "PNG"

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (*INK, 1.0)
    scene.world = world

    def aim(thing, position):
        thing.location = position
        thing.rotation_euler = (Vector(target) - Vector(position)).to_track_quat("-Z", "Y").to_euler()

    def light(name, position, power, colour, size):
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.color, data.size = power, colour, size
        lamp = bpy.data.objects.new(name, data)
        scene.collection.objects.link(lamp)
        # Rear inspection needs its key light behind the figure too. Otherwise
        # the rim lights face the camera and wash out the glute/hamstring detail.
        lighting_turn = math.pi if math.cos(math.radians(angle)) < 0 else 0.0
        aim(lamp, Quaternion((0, 0, 1), lighting_turn) @ Vector(position))

    light("Key", (1.8, -3.0, 2.6), 160, (1.0, 0.96, 0.9), 2.5)
    light("Fill", (-2.4, -2.2, 1.0), 45, (0.8, 0.86, 1.0), 3.0)
    light("Rim left", (-2.0, 2.2, 2.4), 360, (0.84, 1.0, 0.45), 1.5)
    light("Rim right", (2.4, 2.0, 1.8), 300, (0.75, 0.84, 1.0), 1.5)

    camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    camera.data.lens = 70
    scene.collection.objects.link(camera)
    scene.camera = camera
    turn_angle = math.radians(angle)
    aim(camera, (math.sin(turn_angle) * distance, -math.cos(turn_angle) * distance, height))


def set_glow(amount, frame=None):
    """Sets how brightly the working muscles glow, on every material that has a glow, optionally as a keyframe."""
    for material in bpy.data.materials:
        node = material.node_tree.nodes.get("Glow") if material.node_tree else None

        if node:
            node.outputs[0].default_value = amount

            if frame is not None:
                node.outputs[0].keyframe_insert("default_value", frame=frame)


# --------------------------------------------------------------------------- exercises


def dumbbell_curl(rig, model):
    """Standing dumbbell curl: both arms together, palms turning up as they rise."""
    paint(model, primary=["biceps"], secondary=["forearms"])

    frames = 72
    palms = model["palms"]
    weights = {side: dumbbell() for side in (".L", ".R")}

    for frame in range(frames + 1):
        # Up for the first 40%, a short squeeze at the top, then a slower way down.
        beat = frame / frames
        lift = ease(min(1.0, beat / 0.4)) if beat < 0.5 else 1.0 - ease(min(1.0, (beat - 0.5) / 0.5))
        bend = math.radians(8 + 122 * lift)

        for side, out in ((".L", 1), (".R", -1)):
            # Palms face forward at the bottom and the shoulders at the top.
            pose_arm(
                rig, side,
                upper=(out * 0.1, 0.03, -1),
                fore=(out * 0.07, -math.sin(bend), -math.cos(bend)),
                palm_local=palms[side],
                palm_faces=(0, -math.cos(bend), math.sin(bend)),
            )

            if frame == 0:
                grip(rig, side, palms[side])
                hold(rig, weights[side], side, palms[side])

        keyframe(rig, frame + 1)
        set_glow(0.9 + 2.2 * lift, frame=frame + 1)

    stage(target=(0, 0, 0.85), distance=3.6, height=1.05, angle=float(os.environ.get("TRAINER_ANGLE", "32")))

    return frames


def squat(rig, model):
    """Barbell back squat: bar across the upper back, hips down and back until the thighs are level."""
    paint(model, primary=["quads", "glutes"], secondary=["hamstrings", "adductors", "lower back"])

    frames = 96
    palms = model["palms"]
    hip, knee, ankle = (joint(rig, f"{bone}.L") for bone in ("upperleg01", "lowerleg01", "foot"))
    shoulder = joint(rig, "upperarm01.L")
    thigh, shin = (knee - hip).length, (ankle - knee).length
    toe_out = math.radians(22)
    feet = {}

    for side, mirror in ((".L", 1), (".R", -1)):
        frame = rig.matrix_world.to_quaternion() @ rig.data.bones[f"foot{side}"].matrix_local.to_quaternion()
        splay = Quaternion((0, 0, 1), mirror * toe_out)
        feet[side] = (
            Vector((mirror * (hip.x + 0.075), ankle.y, ankle.z)),
            splay @ (frame @ Y()),
            splay @ (frame @ Vector((1, 0, 0))),
            Vector((mirror * math.sin(toe_out), -math.cos(toe_out), 0)),
        )

    # Standing: legs all but straight over the feet. Bottom: hips back and down to knee height.
    spread = feet[".L"][0].x - hip.x
    standing = Vector((hip.x, ankle.y, ankle.z + math.sqrt(((thigh + shin) * 0.995) ** 2 - spread ** 2)))
    bottom = Vector((hip.x, ankle.y - 0.42 * shin + 0.9 * thigh, ankle.z + 0.92 * shin))

    # The bar rests on the muscle across the top of the back, just below the neck.
    bar = barbell()
    height = shoulder.z + 0.035
    skin, _ = measure(model["body"])
    behind = skin[(numpy.abs(skin[:, 0] - 0.06) < 0.03) & (numpy.abs(skin[:, 2] - height) < 0.02) & (numpy.arange(len(skin)) < len(model["closed"]))]
    bar.location = (0, behind[:, 1].max() + 0.016, height)
    attach(rig, bar, "spine01")

    for frame in range(frames + 1):
        beat = frame / frames
        depth = ease(min(1.0, beat / 0.45)) if beat < 0.5 else 1.0 - ease(min(1.0, (beat - 0.5) / 0.45))
        lean = math.radians(4 + 36 * depth)
        place_hips(rig, standing.lerp(bottom, depth), lean)
        tilt = Quaternion((1, 0, 0), lean)

        # Keep the head up as the trunk leans.
        neck = rig.pose.bones["neck01"]
        neck.rotation_mode = "QUATERNION"
        neck.rotation_quaternion = Quaternion()
        turn(rig, "neck01", (1, 0, 0), -0.6 * lean)

        for side, mirror in ((".L", 1), (".R", -1)):
            foot, ahead, across, knee_way = feet[side]
            reach_leg(rig, side, foot, knee_way, ahead, across)

            grip_point = bar.matrix_world.translation + Vector((mirror * 0.3, 0, 0))
            reach_arm(
                rig, side,
                wrist=grip_point + tilt @ Vector((0, 0.03, -0.075)),
                pole=tilt @ Vector((mirror * 0.25, 0.5, -1)),
                palm_local=palms[side],
                palm_faces=tilt @ Vector((0, -1, 0.2)),
            )

            if frame == 0:
                grip(rig, side, palms[side], curl=0.9)

        keyframe(rig, frame + 1)
        set_glow(0.9 + 2.2 * depth, frame=frame + 1)

    stage(target=(0, 0.08, 0.78), distance=4.3, height=0.95, angle=float(os.environ.get("TRAINER_ANGLE", "50")))

    return frames


def bar_grip(rig, side, palm_local):
    """The centre of a bar held across the fingers, using the same placement as hold()."""
    _, along, palm = hand_axes(rig, side, palm_local)
    bones = rig.pose.bones
    knuckles = rig.matrix_world @ ((bones[f"finger2-1{side}"].head + bones[f"finger5-1{side}"].head) / 2)

    return knuckles + along * 0.005 + palm * 0.032


def deadlift(rig, model):
    """Conventional deadlift: straight arms, planted feet and a vertical bar path."""
    paint(model, primary=["glutes", "hamstrings"], secondary=["quads", "adductors", "lower back", "lats", "traps", "forearms"])
    frames = 120
    palms = model["palms"]
    hip, knee, ankle = (joint(rig, f"{bone}.L") for bone in ("upperleg01", "lowerleg01", "foot"))
    thigh, shin = (knee - hip).length, (ankle - knee).length
    spread = 0.025
    standing = Vector((hip.x, ankle.y, ankle.z + math.sqrt(((thigh + shin) * 0.995) ** 2 - spread ** 2)))
    feet = {}

    for side, mirror in ((".L", 1), (".R", -1)):
        foot_frame = rig.matrix_world.to_quaternion() @ rig.data.bones[f"foot{side}"].matrix_local.to_quaternion()
        splay = Quaternion((0, 0, 1), mirror * math.radians(8))
        feet[side] = (
            Vector((mirror * (hip.x + spread), ankle.y, ankle.z)),
            splay @ (foot_frame @ Y()),
            splay @ (foot_frame @ Vector((1, 0, 0))),
            Vector((mirror * 0.12, -1, 0)),
        )

    def arms(lift):
        for side, mirror in ((".L", 1), (".R", -1)):
            direction = Vector((mirror * 0.10, 0.06 - 0.30 * lift, -1))
            pose_arm(rig, side, direction, direction, palms[side], (0, 1, 0))

    # Measure lockout with this trainer's actual arm/hand lengths. This makes
    # the bar meet the hands without bending the elbows to chase a guessed path.
    place_hips(rig, standing, 0)
    arms(1)
    for side in (".L", ".R"):
        grip(rig, side, palms[side], curl=1.15)
        rig[f"grip_palm{side}"] = list(palms[side])
    lockout = bar_grip(rig, ".L", palms[".L"])
    shoes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and "shoes" in obj.name.lower()]
    floor = min(measure(obj)[0][:, 2].min() for obj in shoes)
    plate_radius = 0.225
    bar = barbell(plate_radius=plate_radius)
    bottom = floor + plate_radius

    for frame in range(frames + 1):
        beat = frame / frames
        if beat < 0.38:
            lift = ease(beat / 0.38)
        elif beat < 0.48:
            lift = 1.0
        else:
            lift = 1.0 - ease(min(1.0, (beat - 0.48) / 0.44))

        lean = math.radians(66) * (1.0 - lift ** 1.5)
        place_hips(rig, standing, lean)
        arms(lift)
        contact = bar_grip(rig, ".L", palms[".L"])
        bar.location = (0, lockout.y, bottom + (lockout.z - bottom) * lift)
        # Move the trunk so its straight-arm grip meets the bar. The legs then
        # solve back to the fixed ankles, giving coordinated hip/knee extension.
        shift = Vector((0, bar.location.y - contact.y, bar.location.z - contact.z))
        place_hips(rig, standing + shift, lean)
        arms(lift)

        neck = rig.pose.bones["neck01"]
        neck.rotation_mode = "QUATERNION"
        neck.rotation_quaternion = Quaternion()
        turn(rig, "neck01", (1, 0, 0), -0.15 * lean)

        for side in (".L", ".R"):
            foot, ahead, across, knee_way = feet[side]
            reach_leg(rig, side, foot, knee_way, ahead, across)

        keyframe(rig, frame + 1)
        bar.keyframe_insert("location", frame=frame + 1)
        set_glow(1.0 + 1.8 * math.sin(math.pi * lift), frame=frame + 1)

    bar["floor_height"] = float(floor)
    bar["plate_radius"] = plate_radius
    angle = float(os.environ.get("TRAINER_ANGLE", "50"))
    stage(target=(0, 0.06, 0.79), distance=4.6 if math.cos(math.radians(angle)) < 0 else 4.3, height=1.0, angle=angle)

    return frames


def rest(rig, model):
    """No movement: the trainer as generated, for checking the model itself."""
    paint(model, primary=sorted({part.group for part in model["parts"]}), secondary=[])
    set_glow(0.0)
    stage(target=(0, 0, 0.86), distance=4.3, height=1.0, angle=float(os.environ.get("TRAINER_ANGLE", "25")))

    return 1


EXERCISES = {"dumbbell-curl": dumbbell_curl, "squat": squat, "deadlift": deadlift, "rest": rest}


def main():
    arguments = sys.argv[sys.argv.index("--") + 1 :]
    name, output = arguments[0], arguments[1]
    still = "--still" in arguments

    body, rig = build_trainer()
    palms = {side: rest_palm(rig, side) for side in (".L", ".R")}
    model = add_anatomy(body, rig, palms)
    model["shorts"] = add_shorts(body, rig)
    model["bare"] = "--muscles" in arguments
    skin = body.data.materials[0]
    skin.name = "Skin"
    skin_shader = next(node for node in skin.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    skin_shader.inputs["Subsurface Weight"].default_value = 0.06
    skin_shader.inputs["Roughness"].default_value = 0.55
    add_reveal(skin)

    frames = EXERCISES[name](rig, model)
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 1, frames

    if still:
        for label, frame in (("bottom", 1), ("mid", round(frames * 0.2)), ("top", round(frames * 0.45))):
            scene.frame_set(frame)
            scene.render.filepath = f"{output}/{name}-{label}.png"
            bpy.ops.render.render(write_still=True)
    else:
        scene.render.filepath = f"{output}/frame-"
        bpy.ops.render.render(animation=True)

    bpy.ops.wm.save_as_mainfile(filepath=f"{output}/{name}.blend")


if __name__ == "__main__":
    main()
