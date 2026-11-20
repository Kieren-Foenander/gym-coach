# Mannequin demonstrations

A satin silver figure performs each exercise. Worked muscles take on a muted rose colour;
primary muscles receive the full pigment and secondary muscles a lighter tint. Each movement
is a JSON spec and uses the same cached rig, shaders, equipment and frame checks.

```sh
tools/mannequin/render.sh dumbbell-curl --check-only
OUT=/tmp/mannequin-review tools/mannequin/render.sh squat --sheet
OUT=/tmp/mannequin-review tools/mannequin/render.sh squat --sheet --angle 90
OUT=/tmp/mannequin-review tools/mannequin/render.sh squat --sheet --focus LeftHand
tools/mannequin/render.sh squat
tools/mannequin/render.sh squat --view back
tools/mannequin/render.sh --library             # render every shipped slug and view, including posters
tools/mannequin/render.sh --verify-rig          # shoulder, elbow, grip and deadlift regressions
tools/mannequin/publish.sh squat                # upload squat's reviewed videos and posters to R2
```

Videos and posters are written to `tools/mannequin/renders/`, which git ignores. They are
never committed and never go under `public/`. The app streams them from the R2 bucket
`gym-exercise-media` (see `src/server/media.ts`), and `publish.sh` uploads them there once
they have been reviewed. Previews and prod read the same bucket.

Run on Linux with Blender 5.2, the MPFB extension (MakeHuman, for the body and the fists),
ffmpeg with libx264, libwebp and drawtext, bun and flock. Nothing needs downloading: MPFB
makes the figure. Built scenes live in `$XDG_DATA_HOME/gym-trainer` (default
`~/.local/share/gym-trainer`), and building one takes about a minute. Scene cache keys include
the build script and Blender version. Concurrent jobs share the completed scene. If you change the installed
MPFB assets, remove the corresponding directory under `gym-trainer/scenes` to rebuild.

## Adding an exercise

1. Find the slug in `src/domain/catalog.ts`. The renderer reads the primary and secondary muscles there.
2. Copy the closest spec in `exercises/`. Express movement in terms of the body or apparatus.
   The bar position can follow a torso landmark, and a curl interpolates a bend about the elbow.
   Place keys at extrema and pauses. Intermediate keys are only needed to control a distinct part of the path.
3. Run `render.sh <slug> --check-only`. Review the reported worst frame ranges before rendering.
4. Render a sheet with `OUT=/tmp/mannequin-review`. Inspect the range of motion, each hand,
   moving joints and equipment contacts from both sides. For instance, for the left elbow use
   `--sheet --focus LeftForeArm --focus-distance 0.68 --angle 270`. A bone's head is the camera
   target (the forearm starts at the elbow). Changing the distance on a hand frames the middle of the fist.
5. Render the loop and poster, inspect the motion through its restart, and register the slug,
   shipped views and three cues in `src/domain/demos.ts`. That registry also drives
   `render.sh --library`. Set `OUT` on the library command to stage a complete media refresh.
6. After review, run `publish.sh <slug>` to upload the files to R2. The app shows a demo once
   its entry in `demos.ts` is deployed and its files are in the bucket.

### Extending equipment

The supported equipment includes `barbell`, `dumbbells`, `bench`, `ez-bar`, `trap-bar`, `kettlebells` and `cable`. Unsupported types fail
before rendering. Keep exercise JSON focused on the setup and movement. Put geometry, handle
axes, travel limits and contact checks in the shared equipment implementation. Existing bar
and dumbbell classes provide examples of grip targets and collision measurements.

A `cable` uses `columns` keyed by hand (`Left` or `Right`) with a `d-handle`, or
by `Both` with a `rope`, `straight-bar` or `v-bar`. Each column takes `at: [x, y]`,
`height: "high" | "mid" | "low"`, and an optional horizontal exit direction
`exit: [x, y]` (default `[0, 1]`). The cable runs straight from that exit to
the attachment eye. The bake checks travel, cable clearance against the posed skin,
and contact and wrist alignment at each 28 mm grip. The rope has molded end grips.

Use `cable_target` for a left grip position in world metres, mirrored for the right
hand, and `handle_direction` for the grip shaft direction in torso coordinates.
For an elbow-driven arc, use `upper_arm`, `curl`, and `flex_toward`. The geometry
follows the hand targets in either mode.

For a machine, define its hinge or slide, limits, pads and handle in the apparatus's
local coordinates. Drive the handle from the mechanism and solve the body to that
handle. Add a known-good motion and a deliberately bad travel or contact case when
introducing each apparatus.

### Choosing a colour

```sh
OUT=/tmp/mannequin-review tools/mannequin/render.sh dumbbell-curl --palette \
  --angle 24 --focus Spine2 --focus-distance 1.95
```

This renders all four pigments on the same quarter-cycle frame, with fixed camera, lighting,
exposure and muscle weights. The comparison uses brick, coral,
rose and peony. Set `DEFAULT_PIGMENT` in `build.py` to choose another for the whole library.
The shader mixes pigment into the base colour and adds a small emission component so surface
shading stays visible. Broad area lights, jittered soft shadows, a low-contrast reflection
environment and the AgX view transform provide the studio finish.

## Coordinates

Metres. The floor is z = 0. The figure faces -Y, so +Y is behind it, and its left is +X.
The figure is 1.62 tall. Standing straight, the pelvis (`Hips`) is at z ≈ 0.925 and the hip
joints at 0.87, the shoulder joints at 1.29. Thigh 0.39, shin 0.42, upper arm 0.24, forearm 0.25. Lying on a bench whose pad
top is at z, the pelvis goes at about z + 0.145.

## The spec

```jsonc
{
  "equipment": [{ "type": "barbell" }, { "type": "bench", "at": [0, 0.35, 0.45] }],   // bench "at" = middle of the pad's top; or { "type": "dumbbells" }
  "stance": { "width": 0.34, "y": 0, "toe_out": 20 },  // ankles' spacing, how far forward, toe angle in degrees
  "camera": { "angle": 35, "elevation": 12 },          // degrees round from the front, and above the horizon
  "touching": ["bar", "bench"],                        // fail unless these come within 2 cm of the body
  "frames": 96,
  "keys": [ ... ]                                      // see below
}
```

Each key is a pose at a point through the loop (`at`, 0 to 1). A key keeps everything it leaves out
from the key before, so `{ "at": 0.52 }` holds the previous pose. After the last key the
motion returns to the first. Numeric channels use periodic, shape-preserving cubic Hermite
interpolation. Each component carries velocity through travel keys, goes to zero at a
reversal, and stays exactly constant through a hold. Tangent lengths account for unequal
key spacing. Landmark positions are resolved in the current torso frame before blending.

| field | meaning |
| --- | --- |
| `pelvis` | `[x, y, z]` of the pelvis |
| `shoulder_y` | alternative to `pelvis` for a square, suspended barbell pull. Set the world Y coordinate between the shoulders and give `bar` in world coordinates. The rig derives pelvis height from bar height, grip width and arm length, keeping the arms long |
| `clavicle` | optional pair of angles in degrees, retraction and elevation, applied on each side before hand IK |
| `lean` | degrees the body pitches forward from the hips. -90 lies on the back with the head towards +Y |
| `spine` | extra forward bend of the spine, degrees (negative arches) |
| `head` | nod, degrees (negative looks up) |
| `yaw` | turns the whole body about the vertical |
| `bar` | where the bar's middle is: `[x, y, z]`, or `{ "at": landmark, "offset": [side, forward, up] }` measured on the torso |
| `grip_width` | from the bar's middle to each hand |
| `grip` | `pronated` (overhand), `supinated` (underhand) or `neutral`. A hand on a bar always turns so the bar runs straight through its fist |
| `elbows` | which way the elbows point, `[out, forward, up]` on the torso. Default `[0.4, -0.6, -0.5]`: out, back and down (`[0.1, -0.3, -1]` with dumbbells) |
| `upper_arm` | with dumbbells: which way the upper arm points, `[out, forward, up]` on the torso |
| `curl` | with dumbbells: how far the elbow is bent, in degrees from straight. The hand travels round the elbow between keys, so a curl needs only a bottom and a top key |

With a barbell, each key places the bar (`bar`, `grip_width`) and the arms reach for it. With
`dumbbells`, each key sets the arms (`upper_arm`, `curl`) and a dumbbell goes in each fist, its
handle running across the body for overhand or underhand grips. A neutral dumbbell starts with its handle pointing forward and turns with the elbow flexion plane during a curl. `exercises/deadlift.json` holds a bar on the floor with `bar` given
as `[x, y, z]`; `exercises/dumbbell-curl.json` shows the dumbbell fields.

Landmarks move with the torso, so a bar `{ "at": "chest" }` stays on the chest when the body
lies down or leans: `upper back` (where a squat bar sits), `chest` (where a bench bar touches),
`shoulders` (between the shoulder joints). The knees always point the way the toes do.

## Checks

These run on every frame before anything renders:

- a hand or ankle can't reach its target
- posed skin triangles cross on non-adjacent faces. The check ignores face pairs already crossing at rest and reports the smaller of the two inward plane depths in centimetres. The allowance is 1 cm between regions separated by at least 15 cm at rest and 2 cm for local folds
- the body or a moving weight goes through the floor
- the bar's shaft or a plate passes through the body (hands are allowed round the shaft)
- a hand misses the bar: the bar must run through the middle of the fist
- any **finished fist triangle**, including its edges and interior, penetrates the shaft by
  more than 0.2 mm (not just a bone or base-mesh vertex test)
- the actual fist cavity is skew to the shaft, or a wide grip reaches a collar
- at any of the four digits, fewer than 24 of 32 radial probes hit skin within 1 cm of the
  shaft surface, or its nearest contact patch is more than 3 mm away
- the wrist bends more than 40 degrees from the forearm (reported in degrees)
- an elbow's tracked skin cross-section falls below 75% or exceeds 135% of its rest area.
  The check intersects the rest cage's edges with a plane through the hinge and measures the
  same ordered points on each deformed frame. It measures the loop's projected area, a proxy
  for pinching or swelling at the joint
- pec, deltoid or armpit skin stretches excessively. The check follows rest-cage edges on
  each side of the body, in patches measured from the shoulder joint. It bounds the 95th
  percentile of local edge-length ratios at 1.55× rest length on the pec and 2.1× at the armpit,
  and the 99th percentile on the deltoid at 2.9×. MakeHuman's long shoulder edges stretch that
  far in a bench press without the surface distorting, so the pec patch is the one that catches
  a twisted upper arm
- skin passes through skin. Triangles that cross on a posed frame but not at rest are measured
  by depth: up to 1 cm between distant parts, 2 cm within a local fold, and 3 cm across a bent
  hip, knee or elbow, where real flesh presses together inside a closed crease (belly against
  thigh, calf against hamstring, forearm against biceps)
- an elbow tucks in behind the back (the arm would pass through the body)
- an elbow, wrist, knee or ankle jumps more than 4 cm between frames, or where the loop restarts
  (the arm solver flicking between two answers looks like this)
- the body sinks more than 2.5 cm into a bench pad
- a dumbbell's handle or head passes through the body, or a fist is wider than the handle
- anything in `touching` never comes within 2 cm of the body

The camera frames the whole movement automatically. With `--focus`, both sheets and videos
track the bone through the baked movement with a fixed viewing direction. Focused sheets
render at full resolution with 48 samples. Ordinary sheets stay small. `--focus-distance 0.3` moves the close-up
camera nearer (metres), useful when the opposite shoulder or a plate blocks the hand.
For an outside side view use `--angle 270 --focus LeftHand --focus-distance 0.3`, or
`--angle 90 --focus RightHand --focus-distance 0.3`. `GRIP CHECKS` reports worst penetration, contact
gap, wrist angle, and minimum angular coverage over the whole movement. Geometry is checked
in the actual fist object's frame, independently of the IK target, on **every** animation frame.
For speed, identical rigid contact relationships reuse the triangle/ray result, keyed to one
micrometre; changes in attachment or orientation invalidate it. The wrist angle is always
measured afresh.

`render.sh --verify-rig` exercises moving grip widths with all three grips and checks that
displaced grips fail. It also compares every rigid grip vertex with the evaluated render
mesh at a bent wrist and checks the actual handle and palm orientations of a hammer curl. The elbow test reintroduces linear skinning and wrist roll at peak curl
flexion. The shoulder test bakes the original narrow-grip squat, then puts full humeral twist
back onto the deltoid at standing and depth. It requires the pec check to fail on both sides.
The deadlift regression measures the baked bar speed through knee height on both passes, floor and lockout holds, bar drift, clearance to the leg surface, elbow angle and the
relative rise of the hips and shoulders off the floor.

The rigid grips fit a **28 mm shaft**. Changing the equipment diameter requires rebuilding the grip geometry. Unreachable
poses and unnatural wrist angles are rejected rather than stretching the hand or forearm.
The straight shaft constrains the palm rotation: `neutral` selects the nearest compatible roll;
true palms-facing grips need parallel handles, which this barbell model does not yet provide.

## How it is made

The figure is a MakeHuman man (CC0), made by `build.py` through the MPFB extension and scaled
so his hip joints are at 0.87 m. MakeHuman bodies come with a skeleton and skin weights made to
bend, so nothing guesses where the joints are or how the skin follows them. `build.py` puts a
smaller skeleton with Mixamo's bone names on MakeHuman's joints, and each of its bones takes
over the skin of the MakeHuman bones it stands for. MakeHuman's two-part upper arm and forearm
become `ArmSwing` and `Arm` (the upper arm's swing, then its twist) and `ForeArm` and
`ForeArmRoll` (the forearm, then its twist towards the wrist). The skin deforms with
volume-preserving skinning. Renders smooth it with two levels of subdivision; the checks use
the plain surface. MakeHuman's helper geometry (teeth, tongue, clothes-fitting shells) is
removed; the eyes stay.

The build then paints each muscle group from `catalog.ts` as a soft region on the surface,
measures the torso landmarks, palms and ankle height onto the rig, and saves the lit stage.
Muscle regions were first drawn on a figure with different proportions; each point's height
is mapped onto that figure between the knees, hip joints, neck and crown before they are
applied.

Each closed fist comes from the same MakeHuman man. Individual phalanx targets close
the fingers around a 28 mm shaft. The build freezes and remeshes this surface at 0.8 mm,
relaxes the skin and cuts a cylindrical cavity with 0.15 mm nominal clearance.
It opens a loop proximal to the palm and stitches it into the subdivided forearm,
sampling each transition loop from the original wrist surface. The transition
retains the proximal forearm, forearm roll and hand weights and blends to the rigid palm. The fingers and palm
are fully weighted to the hand bone. The result is one continuous rendering mesh.
The grip checker extracts its marked triangles and verifies their rigid weights.
Floor, bench and equipment clearance checks include the skinned wrist transition.
The rest of the render surface follows the posed, subdivided collision cage by vertex index.
As the humerus rises, a local corrective smoothing modifier distributes shoulder
strain across the surrounding skin before the deformation checks and subdivision.

The solver aligns the elbow hinge to the flexion plane and limits upper-arm twist to 35
degrees relative to swing, with the same excess-twist correction around the proximal forearm.
The warm-started wrist/elbow iteration and the 4 cm joint-jump checks are retained. All
fitting is shared, with no exercise-specific hand offsets or poses. Overhand and underhand
orientation follow the handle and wrist axes.

`animate.py` poses the skeleton directly with two-bone solving for the arms and legs, keys every
frame, runs the checks, and renders with Eevee.

MakeHuman's assets are CC0, so the renders need no credit.

### Movement checkpoints

A spec can declare independent expectations for the baked joints and rendered equipment.
For example, a standing press can check the rack, lockout and horizontal shaft:

```json
"checkpoints": [
  {"at": 0, "elbow": [140, 165]},
  {"at": 0.48, "elbow": [0, 6], "position": {"point": "handle", "relative_to": "Arm", "z": [0.53, 0.65]}},
  {"handle_axis": {"direction": [1, 0, 0], "degrees": 5}}
]
```

Omit `at` to measure every frame. Otherwise it is a loop fraction from 0 up to 1,
measured on the nearest frame. Each check applies to both sides unless `side` is
`Left` or `Right`. Elbow flexion is zero when straight. A position can bound any
combination of world x, y and z in metres, using the root of the apparatus (`handle`)
or a joint name (`Hand`, `ForeArm`, `Hips`, etc.). The optional reference joint
is subtracted before measuring. A handle axis is undirected. A `palm` direction
uses the same format, is directed, and mirrors its x component for the right hand.

For matched dumbbell presses and suspended pulls, `bar` and `grip_width` give
the midpoint and spacing of the two separate grips. A barbell can also use
`upper_arm` and `curl` for an elbow-driven or shoulder-driven arc with a fixed
grip width. For alternating dumbbell work, `arm_phase` maps a side to a fraction
of a cycle to add when sampling that arm's movement.

EZ bars and trap bars use the equipment types `ez-bar` and `trap-bar`.
Their modeled straight grip sections determine the hand positions and shaft axes.
The `kettlebells` type uses level handles. Set `side` on the equipment
for a single bell and use `bell_roll` in the keys to rotate the bell around its handle.
For dumbbell arcs, `fixed_upper_arm` preserves the authored elbow position and
`flex_toward` chooses the torso-relative direction of elbow flexion.
Continuous checkpoints can limit `upper_arm_to_torso` in degrees and
`fixed_elbow_m` in metres. For stepping movements, each key can specify
`foot_left` or `foot_right` as forward/back displacement in world Y,
vertical clearance in metres and heel lift in degrees about the toe joint. A fourth
value optionally gives the lateral displacement in world X.

For an adjustable bench, set `angle` in degrees and place `at` at the hinge
between the seat and backrest. Zero is flat, positive angles incline the back,
and negative angles decline it. Use `support: "chest"` for a prone setup with
the backrest rising toward the front of the figure. The checks measure depth
normal to each pad, equipment intersections and chest contact on prone setups.
For a rear foot raised on a bench, the stance can also specify a world-space
`knee_direction` for either side to select the downward-bending knee solution.

### Face grips and the support hand

Set `hands.Left` and `hands.Right` independently to `pinch`, `cup`, `support`
or `fist` (the default). The scene cache includes both shapes. All four poses
use the mannequin's own skin and the same wrist blend.

For a `plate` or `vertical-dumbbell`, each key supplies a load centre in
metres and an optional pitch in degrees around world X. A shared `contact`
specifies the left wrist offset and the hand's longitudinal and palmar
directions in load coordinates. The right socket mirrors across X. Paired
plates also use a lateral `spacing` per side. The checks measure the rigid
skin against the weight every frame, including both faces for a pinch. A
`follow.bone` carries the load with that joint and checks skin contact there.

For a bench-supported row, set the dumbbell's `side` and give the opposite
side a `support.wrist` in world coordinates. At least 20 open-hand vertices
must stay within 4 mm of the flat pad and none may sink deeper than 2 mm.

For a pull with high elbows, `shoulder_smoothing.elevation_range` sets the
start and end of the shoulder correction ramp. Values measure the upper arm
against the torso's upward axis, from −1 hanging down to +1 overhead.
`radius` limits the correction around the shoulder in metres. The overhead
extension uses a smaller radius to preserve the flexing elbow's cross section.
Both the elbow-section and shoulder-stretch checks still run on every frame.

### Anchors and supports

A `landmine` takes a fixed world-space `pivot` and a grip attachment.
`cross` supplies a press handle, `parallel` supplies the T-bar row handles,
and `end` exposes one end grip. Keys animate pitch and yaw with
`landmine_angles` and can roll the bar about its shaft with `landmine_roll`.
The grip checks use each rendered handle's transform. The shaft, plate,
handles and anchor have separate collision tests.

A bench can carry an `arm_pad` with a centre and an angle. The two cushions
support the upper arms during preacher curls. Each frame checks skin contact
on both cushions, pad penetration and collisions between the weight and pads.
`rack-pins` and `platform` use a height in metres. The rack pull starts with
the shaft resting on both pins. For a deficit pull, each foot must stay on top
of the platform.

A `surface_gap` checkpoint measures from a torso landmark to the weight
surface. A vertical dumbbell supports `upper_head: true` for a goblet hold.
With `directed: true`, a handle-axis check also detects a reversed face normal.

For a seated wrist curl, `wrist_rest` fixes the left wrist centre and mirrors
it on the right. `hand_pitch` raises or lowers the knuckles around the shaft.
`forearm_support: "thighs"` checks both forearms against the posed thigh
surfaces. An overhead squat can specify `overhead_y` and `grip_width` to
maintain lockout as shoulder height changes. Both forms use independent angle
checkpoints on the baked pose.

A straight barbell rack can use `rack_contact` with an open hand shape on both
sides. It takes the same `wrist`, `along` and `palm` fields as a face grip, in
torso coordinates relative to the shaft centre. The closest point on the hand
surface must stay within 2.5 mm of the shaft. The triangles may penetrate by
at most 0.2 mm. Wrist and
collar clearance checks still apply.

A dumbbell spec can key `handle_direction` in torso coordinates. With
`grip: "neutral"` this is the directed shaft toward the thumb end, mirrored
for the opposite hand. Use an intermediate direction for a half-turn so
the interpolated shaft never goes through a zero vector.


### Elbow cradles and floor contact

Use `elbow_cradle` on a straight barbell when the load rests in the elbow
creases. Its `wrist` offset is measured from the shaft in torso coordinates.
Use `along` and `palm` to orient the hands. The solver mirrors the left
socket to the right and checks contact at each elbow and shaft clearance
against the full skin surface.

For bodyweight moves with both palms flat, use the `support` hand shape
on both sides. Set `floor_hands` to the left wrist's world coordinates.
The right wrist mirrors across X. The palms are checked against the floor
on every frame.

For weight-bearing palms, add a checkpoint with
`"hand_mode": "floor-plant"`. Omit `at` to check the whole rep, or use
`at` and `side` to check a selected hand at contact. The open `support`
mesh already extends and spreads the fingers and flattens the palm.
Floor-plant checks require both the palm and finger pads to approach the
ground plane and measure signed wrist extension toward the palm normal
in a 75–100° range. The 40° grip limit still applies to implement grips
and the existing support-hand checks.

For elevated palms, set `palm_support: "bench"` and give the flat bench
enough `width` to fit both hands. Contact is measured against the pad's
top, within its edges. For moving hands, key `plant_left` and
`plant_right` as world-space wrist positions, and use `during: [start, end]`
on each side's floor-plant checkpoints. Intervals include the start and
exclude the end, and all phases use the normalized loop time. The wrist
can travel off the support between those intervals.

### Bar turnover

A straight-bar spec may key `grip_pitch` to control hand rotation around the
shaft. Zero points the hand forward, −90° points it down, and 90° points it up.
With `arm_arc: [elbow_x, upper_pitch]`, the solver derives the bar position
from the mirrored elbow targets and the limb lengths. The upper-arm pitch
uses the same world-space convention as the grip pitch. The regular grip,
wrist, skin and equipment checks still run on every frame.

### Selectorized press stations

Combine `selector-machine` with a flat `bench` for the seat. Set the
left bearing's world `pivot` and the `grip_offset` from the bearing to
the left grip at zero rotation. The right bearing and grip mirror across X.
Key `lever_angle` in degrees around the axle and give the permitted
`travel` as two angles. A `back_pad` specifies the front face's bottom
edge as `[y, z, incline]`. The lever carries its grips through the arc,
and the arms solve against those moving grips. Levers stay in the plane
of each outer bearing and turn inward at the grip. The bake checks lever
travel, overlaps between the rendered moving hardware and the posed skin,
grip enclosure, and contact with the back pad.

### Leg machines and Smith guides

- A `leg-roller` keeps the thigh at `thigh_pitch` and rotates the lower leg
  and roller together around the knee-height axle. The `roller_offset` is
  measured from the knee at zero `lever_angle`. Both rollers are checked
  on every frame against the lower calf for contact and against the skin for
  penetration. Optional `pads` give a contact face, width and length, and pitch
  around X. Use `split` to require contact on both thighs.
- A `leg-sled` uses an inclined foot plate on fixed guides. Set its plate
  `origin`, optional `pitch`, and travel limits in metres. The `sled` key
  sets displacement along the guide. Set `side` for single-leg work. The
  plate must stay against the working soles. The rendered carriage, fixed
  rails, and supports must clear skin.
- Setting `motion: "fly"` on a selectorized station uses overhead vertical
  bearings and a suspended grip on each arm.
- Add `smith-rails` to a straight bar with fixed world `y` and vertical
  `travel`. A landmark-based bar target translates the torso to the guide
  while leaving bar height driven by the pose. The guides constrain the bar
  throughout the loop and the carriages are checked against skin.

A `calf-station` uses a fixed forefoot step and paired pads with a common
vertical travel limit. Set `footplate` to the step centre Y and top Z, and
`pad_at` to the left pad's positive X, centre Y and unloaded contact Z.
The `calf_lift` key moves the contact faces and yokes together. With
`seated: true`, the shorter frame loads the thighs. Each frame checks
the padded faces, the forefoot support, and clearance of the frame and yokes.
For donkey calf raises, set `fixed_grip` to place the handles on the frame
while the pads load the back of the hips.

A `hip-machine` rotates both thigh supports about fixed vertical axles.
Set `contact` to `outer` for abduction or `inner` for adduction, give
the skin-facing pad distance as `pad_offset`, and key `hip_angle` in
degrees within `travel`. The thigh pad and forefoot support turn together.
The bake measures their skin contact, checks the backrest, and checks the
rendered frame and linkages for clearance.

A `guided-squat` holds the back and shoulder pads and hand grips on the
same carriage. Set `at` and `lean` to its standing reference pose.
With rails, `carriage` measures distance in metres along the incline.
With a world `pivot`, `carriage` measures degrees around the axle.
The fixed `footplate` gives its centre Y and top Z. Each frame checks
pad contact, foot support, grip enclosure, and clearance of the fixed
frame and moving linkages.

Selectorized stations can use `pad_size: [width, length]` to size the
chest or back pad, or omit `back_pad` when a separate preacher pad carries
the upper arms. Optional `restraints` use the same contact-face geometry as
the leg-machine pads. The pulldown uses a split thigh restraint.

- An `assist-station` has fixed hand grips and a vertically guided knee pad.
  The `assist_height` channel joins the torso movement and the knee support.
- A `trunk-station` rotates a padded yoke on a fixed pelvis-height axle.
  Its `support` selects the front or back of the torso and the `lean`
  channel drives the lever. The pad contact check samples the torso skin.
- A `lateral-station` rotates a padded support against each elbow and
  carries its grip through the same arc. The `lever_angle` key is measured
  in degrees upward from the hanging upper arm.
- A roller with `side` moves just the working leg. A roller with
  `hip_drive` rotates both legs together from fixed hip-height pivots.
- A selectorized `grip_axis` is specified in the lever's local coordinates.
  The shaft rotates with the lever and its actual transform drives the grip
  check.

- A `belt-squat` has split platforms and a cable from the waist belt
  to a fixed `anchor`. Set `footplate` to the centre Y and top Z,
  `belt_radii` to the strap's lateral and front-to-back radii, and `grip`
  to the left handle centre. The belt follows the torso and is checked
  against the waist and thighs through the full squat.
- A `rotary-torso` station carries its chest pad and grips around the
  seat's vertical axis. `torso_twist` turns the spine and frame together.
  Set `pivot`, `pad_y` for the pad face in the rotating frame, and angular
  `travel`. The bake checks pad contact and full frame clearance.
- A `leg-roller` with `hip_drive: true` pivots at the working hip for
  standing kickbacks. The roller stays against the lower leg.
- A `thrust-station` carries a hip pad and two grips on one fixed axle.
  Specify its world-space `pivot`, resting `pad_offset` and angular
  `travel`. Animate it with `thrust_lever` while the upper back rests
  on a separate bench.
- A `treadmill` uses `gait: [y, lift, heel]` for one leg. The second leg
  and both arm swings sample the same cycle half a turn apart. The
  `incline` is in degrees. The bake checks belt support through stance
  and checks the deck rails and console for collisions.
- A `cycle-station` places the pedals on opposite sides of a shared
  crank. Set the world `crank`, `radius`, `saddle`, and mirrored `grip`
  positions. A recumbent cycle adds a `backrest` contact pad, and `air`
  makes the handles move with the crank. The bake checks the saddle,
  pedals, grips, and frame.
