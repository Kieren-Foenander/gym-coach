# Modelling continuation — 16 November 2026

Fable completed the combined trainer and a first squat render before its limit. This continuation added rear and muscle-only renders, then fixed an anatomy binding defect exposed by the squat.

## Fixed: tissue stretching between the legs

The global nearest-skin search could select the opposite inner thigh. If the transferred weights contained too little permitted influence, `atlas.bind` fell back to the unrestricted weights. Some vertices in the left adductors and hamstrings therefore followed the right thigh, and vice versa, stretching triangles across the gap as the legs spread.

The search now considers only skin faces with compatible weights for the same side and limb. The forbidden-weight fallback is removed. Shared pelvis/root influences remain available. A Blender regression test reproduces the wrong-side nearest-surface case on both legs and checks the actual binding output, including retained pelvis influence.

## Available renders

- `public/exercises/squat.mp4` and `.webp`: corrected front cutaway.
- `public/exercises/squat-rear.mp4` and `.webp`: rear cutaway, with lighting turned behind the figure so the skin and glutes are not washed out.
- `public/exercises/squat-muscles.mp4` and `.webp`: front anatomy view.
- `public/exercises/deadlift.mp4`, `deadlift-rear.mp4` and `deadlift-muscles.mp4`, with matching `.webp` posters: conventional deadlift, using the corrected anatomy binding.

- `public/exercises/dumbbell-curl.mp4` and `dumbbell-curl-muscles.mp4`, with posters.

All eight clips were rendered again after the fixes under "Later fixes" below.

Curl, squat and conventional deadlift are registered in `src/domain/demos.ts`. The exercise page has a Front / Back / Muscles switch, showing whichever views a demonstration lists. Romanian deadlift is a separate exercise and has not been mapped to this demonstration.

## Deadlift

The 120-frame loop uses a narrow stance, double-overhand grip, 45 cm plates, a brief standing pause and a slower lowering phase. The bar moves vertically from floor height. The hip position is solved from the trainer's actual straight-arm grip, and the leg IK keeps the ankles fixed.

`check_deadlift.py` passes across all 120 frames: ankle drift and grip error below 0.000001 m, elbows straight, hands outside the knees, plates at floor height, loop closed, and no atlas part following both legs. Front, side and rear views were inspected. The app checks also pass (27 tests).

## Verified

- Inspected the standing, intermediate and deepest poses. The shorts reveal the glutes and upper thighs in the squat, using the same per-vertex mask as the skin.
- Sampled ankle positions over all 96 frames: maximum drift below 0.000001 metres. The bar is attached to `spine01`.
- Shorts reveal values span 0–1, retaining opaque coverage as well as the muscle openings.
- Corrected full mesh: zero vertices bound to opposite-side bones. Maximum sampled inner-thigh edge length fell from about 33 cm to under 7 cm (frames 1, 20, 32, 44, 60, 80 and 96).
- `test_bind.py`: failed against the original binder, passes with the fix on both sides.
- `bun run check`: lint and typecheck pass; 27 tests pass.
- The render wrapper rejects unknown options and now propagates Blender Python failures via `--python-exit-code 1`.

## Later fixes

- Resting muscle poking through the skin (dark patches on the front of the shoulders with the arms forward, and marks at the base of the neck): `paint` now stores a `shown` value on the anatomy. A vertex is drawn only if its muscle works, it lies more than 2 cm from the nearest skin vertex, or the skin over it is open. The anatomy materials read `shown` as their alpha.
- Specks: `paint` closes an opening that has closed skin all round it and removes a speck of skin left inside an opening, before softening the edges.
- Shorts: when an exercise opens most of the thighs, the shorts come off the thighs whole, leaving a waistband instead of ragged strips.
- Secondary muscles now work at 0.35 instead of 0.45, so the primary ones stand out more.

## Remaining fitting work

The overall trainer is still a modelling preview. A thin mark can remain at the base of the neck, and in close-up the lats' tendons stretch into straight strands at the armpit when the arms reach forward. The rear camera is now at 130 degrees, matching the front view's foreshortening so the bar fits better.

Keep the atlas as the anatomical reference and fit the skin and rig around it, as requested. Note that `atlas.bind` still tucks protruding anatomy vertices under the skin; it does not preserve every atlas vertex exactly. That inherited tuck step remains, now using the compatible surface. Review it when improving the skin fit.

The rest of the exercise library, including Romanian deadlift, has not been modelled yet.
