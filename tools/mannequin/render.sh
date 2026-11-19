#!/usr/bin/env bash
# Renders one exercise on the mannequin from its spec in exercises/<slug>.json.
#   tools/mannequin/render.sh squat --sheet          checks the motion and writes a four-frame contact sheet
#   tools/mannequin/render.sh squat                  checks it and writes tools/mannequin/renders/squat.mp4 and .webp
#   tools/mannequin/render.sh squat --view back      the same from behind, as squat-rear
#   tools/mannequin/render.sh squat --sheet --angle 90   a contact sheet from the side (0 is front, 90 the figure's right)
#   tools/mannequin/render.sh squat --sheet --focus LeftHand   close-ups that follow one bone
# OUT=<folder> writes somewhere other than tools/mannequin/renders. publish.sh uploads renders to R2;
# they are never committed or put under public/.
set -euo pipefail

slug="${1:?Usage: render.sh <slug> [--sheet] [--view front|back]}"
shift
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
if [[ "$slug" == --library ]]; then
  views="$(cd "$root" && bun -e '
    import { RENDERED_SLUGS, demoFor } from "./src/domain/demos"
    for (const slug of RENDERED_SLUGS) {
      for (const view of demoFor(slug).views) console.log(slug, view)
    }
  ')"
  while read -r exercise view; do
    "$here/render.sh" "$exercise" --view "$view" "$@" </dev/null
  done <<< "$views"
  exit 0
fi

spec="$here/exercises/$slug.json"
if [[ "$slug" != --verify-rig && ! -f "$spec" ]]; then
  echo "No spec at $spec" >&2
  exit 2
fi

check="" palette="" sheet="" view="front" suffix="" angle=() focus=() distance=()
while (($#)); do
  case "$1" in
    --sheet) sheet="--sheet" ;;
    --palette) palette="--palette" ;;
    --check-only) check="--check-only" ;;
    --angle) angle=(--angle "$2"); suffix="$suffix-$2"; shift ;;
    --focus-distance) distance=(--focus-distance "$2"); suffix="$suffix-d$2"; shift ;;
    --focus) focus=(--focus "$2"); suffix="$suffix-$2"; shift ;;
    --view) view="$2"; shift; [[ "$view" =~ ^(front|back)$ ]] || { echo "Unknown view: $view" >&2; exit 2; }; [[ "$view" == back ]] && suffix="$suffix-rear" ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

# Isolate different rig builds across worktrees. Publish only a complete .blend.
cache="${XDG_DATA_HOME:-$HOME/.local/share}/gym-trainer"
mkdir -p "$cache"
poses=(fist fist)
if [[ "$slug" != --verify-rig ]]; then
  pair="$(bun -e 'const s=await Bun.file(process.argv[1]).json(); console.log(["Left","Right"].map(side=>s.hands?.[side] ?? "fist").join(" "))' "$spec")"
  read -r -a poses <<< "$pair"
fi
key="$( { sha256sum < "$here/build.py"; echo "${poses[*]}"; blender --version | head -n 1; } | sha256sum | cut -d' ' -f1)"
scene_dir="$cache/scenes/$key"
blend="$scene_dir/mannequin.blend"
mkdir -p "$scene_dir"
if [[ ! -f "$blend" ]]; then
  (
    flock 9
    [[ ! -f "$blend" ]] || exit 0
    tmp="$(mktemp -d "$scene_dir/build.XXXXXX")"
    trap 'rm -rf "$tmp"' EXIT
    blender -b --python-exit-code 1 --python "$here/build.py" -- "$tmp/mannequin.blend" "${poses[@]}" > "$scene_dir/build.log" 2>&1 \
      || { tail -n 30 "$scene_dir/build.log"; exit 1; }
    mv "$tmp/mannequin.blend" "$blend"
  ) 9>"$scene_dir/build.lock"
fi
if [[ "$slug" == --verify-rig ]]; then
  for suite in verify-grips verify-elbows verify-shoulders verify-deadlift verify-cables; do
    blender -b "$blend" --python-exit-code 1 --python "$here/$suite.py"
  done
  exit 0
fi

muscles="$(cd "$root" && bun -e '
  import { catalogBySlug } from "./src/domain/catalog"
  const slug = process.argv[1]
  const entry = catalogBySlug(slug)
  if (!entry) { console.error("No library entry with slug", slug); process.exit(2) }
  console.log(JSON.stringify({ primary: entry.primary, secondary: entry.secondary }))
' "$slug")"

work="$(mktemp -d "${TMPDIR:-$cache}/render-$slug.XXXXXX")"
trap 'rm -rf "$work"' EXIT
blender -b "$blend" --python-exit-code 1 --python "$here/animate.py" -- \
  "$spec" "$work" --muscles "$muscles" --view "$view" "${angle[@]}" "${focus[@]}" "${distance[@]}" $sheet $check $palette > "$work/blender.log" 2>&1 \
  || { grep -E "CHECK FAILED|check failures|Error|Traceback|line [0-9]+" "$work/blender.log" | head -40; exit 1; }
grep -E "CHECKS PASSED|GRIP CHECKS|ELBOW CHECKS|SHOULDER CHECKS" "$work/blender.log"

[[ -z "$check" ]] || exit 0

out="${OUT:-$here/renders}"
mkdir -p "$out"
name="$slug$suffix"
if [[ -n "$palette" ]]; then
  inputs=() labels="" streams=""
  while read -r label; do
    i=$((${#inputs[@]} / 2))
    inputs+=(-i "$work/sheet-$i.png")
    labels+="[$i:v]pad=iw:ih+70:0:70:color=0x19191d,drawtext=text='$label':fontsize=32:fontcolor=white:x=(w-tw)/2:y=(70-th)/2[p$i];"
    streams+="[p$i]"
  done < <(sed -n 's/^PIGMENT //p' "$work/blender.log")
  ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "${labels}${streams}hstack=$((i+1))" "$out/$name-palette.png"
  echo "$out/$name-palette.png"
elif [[ -n "$sheet" ]]; then
  ffmpeg -y -loglevel error -i "$work/sheet-0.png" -i "$work/sheet-1.png" -i "$work/sheet-2.png" -i "$work/sheet-3.png" \
    -filter_complex hstack=4 "$out/$name-sheet.png"
  echo "$out/$name-sheet.png"
else
  # H.264 in MP4 plays inline on iPhone. yuv420p and even dimensions are required for that.
  staging="$(mktemp -d "$out/.encode-$name.XXXXXX")"
  trap 'rm -rf "$staging" "$work"' EXIT
  ffmpeg -y -loglevel error -framerate 30 -i "$work/frame-%04d.png" \
    -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart -an "$staging/$name.mp4"
  ffmpeg -y -loglevel error -i "$work/frame-0001.png" -quality 86 "$staging/$name.webp"
  mv "$staging/$name.webp" "$staging/$name.mp4" "$out/"
  ls -la "$out/$name".*
fi
