<img src="assets/icon.svg" width="64" height="64" alt="">

# gym

A training log for your phone, with a connection for an AI coach.

You log sets in the app. The app adjusts target weights with a simple built-in rule. An AI app (Claude, ChatGPT, Grok, Gemini, Le Chat or any other that takes a remote MCP server) connects through an MCP server on the same Worker, reads your history, and writes or changes your plan. The AI runs on the subscription you already have, so there are no API costs.

## Stack

- TanStack Start on Cloudflare Workers (`src/server.ts` is the Worker entry)
- Effect v4 for the server: `effect/sql` on D1, `effect/ai` for the MCP server, Schema for every input
- D1 for data, KV for OAuth grants (`@cloudflare/workers-oauth-provider`)
- Alchemy for infrastructure and deploys (`alchemy.run.ts`), GitHub Actions for CI and CD
- Tailwind v4, installable as a PWA on iPhone

```
src/domain/     pure logic: progression rule, input schemas, starter plans, the exercise library
src/server/     Effect code: repository (repo.ts), auth, MCP tools (mcp.ts), the calls clients make (calls.ts)
src/functions/  server functions the web screens call
src/routes/     web screens
apps/mobile/    the native iPhone and Android app (see its README)
migrations/     D1 schema
tools/oxlint/   vendored anti-slop lint rules (see UPSTREAM.md there)
```

## Run locally

```sh
bun install
bun run dev
```

`bun run dev` is `alchemy dev`: it serves the app on http://localhost:1337 with a local database and applies the migrations.

The first account needs no invite. To let more people sign up locally, copy `.env.example` to `.env`.

`bun run check` runs lint, typecheck and tests. Lint is type-aware: oxlint uses [tsrs](https://github.com/oxc-project/tsrs) for the type information, while `tsc` stays the type checker.

### Checks before a change ships

| Where | What runs | Blocks |
| --- | --- | --- |
| `git push` | `.githooks/pre-push`: `bun run check` here and in `apps/mobile`, and the migration check | the push (skip once with `--no-verify`) |
| Pull request | `.github/workflows/ci.yml`: the same, on a clean checkout, and the browser tests | the merge: every job is a required check on `master` |
| Pull request preview | `.github/workflows/deploy.yml`: the browser tests marked `@smoke`, against the preview just deployed | the merge |
| Merge to `master` | the checks again, then the production deploy | the deploy |

`bun install` turns the pre-push hook on. The tests include:

- `test/server/`: the real JSON API on SQLite with every migration, using the seed history. `api.test.ts` covers sign-in, errors and what calls do to the data.
- The API contract (`test/server/contract.test.ts`): runs every call and compares the shape of each answer with `test/server/api-signatures.json`, so a change that would break a native build already installed fails. After a change that only adds to an answer, run `UPDATE_API_SIGNATURES=1 bun run test` and commit the file.
- `tools/check-migrations.ts`: a migration already on `master` may not be edited, renamed or deleted.
- `e2e/`: end-to-end tests with [e2e](https://e2e.com) (`e2e.config.ts`). `e2e/web/` tests the web app in a browser, on a phone-sized screen: `bun run e2e` serves its own copy of the app on port 4174 with a fresh database (`tools/e2e/serve.ts`), beside any `bun run dev`, and downloads Chromium the first time. `e2e/native/` tours the native app on an iOS Simulator or Android emulator (see `e2e.config.ts`). Tests find elements by test id only; CLAUDE.md has the rules, and `src/domain/test-ids.ts` has the ids.
- Screenshot comparisons (`e2e/web/screenshots.e2e.ts`) run in CI only, in Playwright's Docker image. After a change that is meant to alter how a screen looks, record new ones with `bun run e2e:screenshots` (needs Docker) or the "Update screenshots" workflow, and check the images in the pull request.

### Seed data

`seed/training-history.json` is a real training history: 242 workouts and 3,560 sets from Nov 2022 to Jul 2026, exported from Gymverse and converted to the app's exercise names. Use it whenever a database needs realistic history. Sign up first, then load it into that account:

```sh
bun tools/seed/load.ts --local --email you@example.com              # the bun run dev database
bun tools/seed/load.ts --database <d1-id> --email you@example.com   # a deployed stage (find the id with cf d1 list)
```

Loading twice adds nothing the second time. Every workout it adds has the note `Imported from Gymverse.`, so deleting the workouts with that note removes it again. `tools/seed/from-gymverse.ts` rebuilds the file from a Gymverse export, and holds the map from Gymverse's exercise names to the library's.

## Deploy

The Worker, the D1 database and the KV namespace are declared in `alchemy.run.ts` and deployed with [Alchemy](https://alchemy.run). Each stage is a separate copy of all three.

```sh
bunx alchemy profile edit --add Cloudflare   # once: sign in to Cloudflare
bun run deploy                               # your own stage
bun run deploy --stage prod                  # the live app
```

Migrations in `migrations/` are applied on every deploy. Sign-up is open for the first account only. To invite others, set `SIGNUP_CODE` in `.env` (or as a repository secret) and deploy again.

### Pipelines

- **CI** (`.github/workflows/ci.yml`): lint, typecheck and tests on every pull request.
- **Deploy** (`.github/workflows/deploy.yml`): a push to `master` runs the checks and then deploys the `prod` stage. A pull request from a branch of this repository gets its own preview stage, `pr-<number>`, with the address posted as a comment, and closing the pull request destroys it.

The pipelines need two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token needs these account permissions: Workers Scripts, Workers KV Storage, D1 and Secrets Store (all Edit), and Account Settings (Read). `SIGNUP_CODE` is an optional third secret.

## Put it on your iPhone

Open the deployed URL in Safari, tap Share, then Add to Home Screen.

## The native app

`apps/mobile` is the same app built with React Native and Expo. It signs in to the same server and shows the same data, logs sets with no signal, and alerts you on the lock screen when a rest ends. It talks to the Worker through a JSON API at `/api/v1` (`src/server/http.ts`), which runs the same calls as the web app. See [apps/mobile/README.md](apps/mobile/README.md).

## Adding a feature

Build each feature for both the web app and the native app in the same pull request, unless it can only work on one of them. [CLAUDE.md](CLAUDE.md) lists the steps and the exceptions.

## Connect your AI app

The coach is a remote MCP server with OAuth at `https://<your-worker-url>/mcp`, so it works with any AI app that can add a custom MCP server or connector. In Claude:

1. Settings, Connectors, Add custom connector.
2. Paste `https://<your-worker-url>/mcp`.
3. Sign in to the app when asked and tap Allow.
4. Ask something like "Look at my gym log and build me a plan."

The app's Settings screen has the steps for Claude, ChatGPT, Grok, Gemini and Le Chat (`src/domain/coach-apps.ts`), and general ones for any other app.

Every copy other than `prod` names its connector after its stage (`Gym-dev` for `bun run dev`, `Gym-pr-21` for a preview), and its MCP server tells the AI it is a test copy. Add it next to the live `Gym` connector, ask your AI to use `Gym-pr-21` by name, and remove that connector when you're done. An AI app can't reach `localhost`, so test the MCP server on a deployed stage.

## How weights change

When you finish a workout, each exercise with automatic adjustment on is checked (`src/domain/progression.ts`):

- Every prescribed set at the top of the rep range: add one increment.
- Half or more of the sets below the bottom of the range, two sessions running: drop 10%.
- No target yet: the heaviest set of the first session becomes the target.

Claude's changes go on top of that. Every change, from the rule or from Claude, is listed on the home screen with its reason.

## Food

The food log (Today, then Food) keeps it light: an entry is a meal or a day's total with calories and whichever of protein, carbs and fat you know. There is no food database. Tell Claude what you ate and it estimates the numbers and logs them, or type them in. Calorie and protein targets can be set on the Food screen or by Claude.

If you track food in another app that writes to Apple Health (MyFitnessPal, Cronometer and so on), the iPhone app brings in each day's calories and macros and they count in the day's totals alongside anything logged here. Days are the device's calendar days (`src/domain/nutrition.ts`), because the server does not know your time zone.
