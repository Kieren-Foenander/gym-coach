#!/usr/bin/env bash
# Renders one exercise demonstration and encodes it as a looping video with a poster image.
#   tools/blender/render.sh dumbbell-curl            the trainer with his skin on
#   tools/blender/render.sh dumbbell-curl --muscles  the muscle layer, saved as dumbbell-curl-muscles
#   tools/blender/render.sh squat --rear             rear view, saved as squat-rear
set -euo pipefail

exercise="${1:?Usage: render.sh <exercise> [--rear] [--muscles]}"
shift
rear=""
layer=""
options=()
for option in "$@"; do
  case "$option" in
    --rear) rear="-rear"; export TRAINER_ANGLE=130 ;;
    --muscles) layer="-muscles"; options=(--muscles) ;;
    *) echo "Unknown option: $option" >&2; exit 2 ;;
  esac
done
name="$exercise$rear$layer"
root="$(cd "$(dirname "$0")/../.." && pwd)"
frames="$(mktemp -d)"
out="$root/public/exercises"
mkdir -p "$out"

blender -b --python-exit-code 1 --python "$root/tools/blender/trainer.py" -- "$exercise" "$frames" "${options[@]}" > "$frames/blender.log" 2>&1 \
  || { tail -n 30 "$frames/blender.log"; exit 1; }

# H.264 in MP4 plays inline on iPhone. yuv420p and even dimensions are required for that.
ffmpeg -y -loglevel error -framerate 30 -i "$frames/frame-%04d.png" \
  -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart -an "$out/$name.mp4"
ffmpeg -y -loglevel error -i "$frames/frame-0001.png" -quality 82 "$out/$name.webp"

rm -rf "$frames"
ls -la "$out/$name".*
