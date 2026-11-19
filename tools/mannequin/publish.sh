#!/usr/bin/env bash
# Uploads reviewed demonstration videos and posters from tools/mannequin/renders to the R2 bucket the app
# streams them from (src/server/media.ts). Needs the cf CLI, signed in to the account.
#   tools/mannequin/publish.sh squat deadlift   every listed view of these demos
#   tools/mannequin/publish.sh --all            every demo in src/domain/demos.ts
#   tools/mannequin/publish.sh --missing        report demos whose files are not in the bucket, and upload nothing
# Re-publishing a slug overwrites its files; browsers pick up the change within an hour.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
renders="${RENDERS:-$here/renders}"
bucket="$(cd "$root" && bun -e 'import { MEDIA_BUCKET } from "./src/server/media.ts"; console.log(MEDIA_BUCKET)')"

# Every file a demo is shown with: "<slug>" for the front view, "<slug>-rear" for the back, each as .mp4 and .webp.
files_for() {
  (cd "$root" && bun -e '
    import { DEMO_VIEWS, RENDERED_SLUGS, demoFor } from "./src/domain/demos.ts"
    const wanted = process.argv[1] === "--all" ? RENDERED_SLUGS : process.argv.slice(1)
    for (const slug of wanted) {
      const demo = demoFor(slug)
      if (!demo) { console.error(`No demo for ${slug} in src/domain/demos.ts`); process.exit(1) }
      for (const view of demo.views) for (const ext of ["mp4", "webp"]) console.log(`${slug}${DEMO_VIEWS[view]}.${ext}`)
    }' -- "$@")
}

if [[ "${1:-}" == --missing ]]; then
  stored="$(cf r2 objects list --bucket-name "$bucket" --prefix exercises/ --per-page 1000 2>/dev/null | grep -o '"key": *"exercises/[^"]*"' | sed 's/.*exercises\///; s/"$//' | sort || true)"
  missing="$(comm -23 <(files_for --all | sort) <(echo "$stored"))"
  [[ -z "$missing" ]] && { echo "Every demo's files are in $bucket."; exit 0; }
  echo "Not in $bucket:"; echo "$missing"; exit 1
fi

[[ $# -gt 0 ]] || { echo "Usage: publish.sh <slug>... | --all | --missing" >&2; exit 2; }

list="$(files_for "$@")"
[[ -n "$list" ]] || { echo "Nothing to publish." >&2; exit 1; }
while read -r file; do
  [[ -f "$renders/$file" ]] || { echo "Missing $renders/$file: render it first." >&2; exit 1; }
done <<< "$list"

while read -r file; do
  case "$file" in *.mp4) type=video/mp4 ;; *.webp) type=image/webp ;; esac
  cf r2 objects put "exercises/$file" --bucket-name "$bucket" --file "$renders/$file" --content-type "$type" -q > /dev/null
  echo "exercises/$file"
done <<< "$list"
