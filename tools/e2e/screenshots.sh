#!/bin/sh
# Records the approved screenshots for e2e/screenshots.spec.ts in the same Playwright image CI runs the
# browser tests in, so they match there pixel for pixel. Needs Docker. Without it, run the
# "Update screenshots" workflow on the branch instead.
#
#   bun run e2e:screenshots
set -e
cd "$(git rev-parse --show-toplevel)"

docker run --rm --init --ipc=host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e CI=1 \
  -v "$PWD:/work" -w /work \
  mcr.microsoft.com/playwright:v1.65.1-noble \
  sh -c 'npx -y bun@1.4.4 x playwright test e2e/screenshots.spec.ts --update-snapshots=all'
