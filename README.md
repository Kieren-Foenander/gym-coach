<img src="assets/icon.svg" width="64" height="64" alt="">

# gym

A training log for your phone, with a connection for an AI coach.

You log sets in the app. The app adjusts target weights with a simple built-in rule. Claude connects through an MCP server on the same Worker, reads your history, and writes or changes your plan. The AI runs on your Claude subscription, so there are no API costs.

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

`bun run check` runs lint, typecheck and tests.

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

## Connect Claude

1. In Claude: Settings, Connectors, Add custom connector.
2. Paste `https://<your-worker-url>/mcp`.
3. Sign in to the app when asked and tap Allow.
4. Ask something like "Look at my gym log and build me a plan."

The same steps are in the app under Settings.

## How weights change

When you finish a workout, each exercise with automatic adjustment on is checked (`src/domain/progression.ts`):

- Every prescribed set at the top of the rep range: add one increment.
- Half or more of the sets below the bottom of the range, two sessions running: drop 10%.
- No target yet: the heaviest set of the first session becomes the target.

Claude's changes go on top of that. Every change, from the rule or from Claude, is listed on the home screen with its reason.
