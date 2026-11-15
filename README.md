<img src="assets/icon.svg" width="64" height="64" alt="">

# gym

A training log for your phone, with a connection for an AI coach.

You log sets in the app. The app adjusts target weights with a simple built-in rule. Claude connects through an MCP server on the same Worker, reads your history, and writes or changes your plan. The AI runs on your Claude subscription, so there are no API costs.

## Stack

- TanStack Start on Cloudflare Workers (`src/server.ts` is the Worker entry)
- Effect v4 for the server: `effect/sql` on D1, `effect/ai` for the MCP server, Schema for every input
- D1 for data, KV for OAuth grants (`@cloudflare/workers-oauth-provider`)
- Tailwind v4, installable as a PWA on iPhone

```
src/domain/     pure logic: progression rule, input schemas, starter plans
src/server/     Effect code: repository (repo.ts), auth, MCP tools (mcp.ts)
src/functions/  server functions the screens call
src/routes/     screens
migrations/     D1 schema
tools/oxlint/   vendored anti-slop lint rules (see UPSTREAM.md there)
```

## Run locally

```sh
bun install
bun run db:migrate:local
bun run dev
```

The first account needs no invite. To let more people sign up locally, copy `.dev.vars.example` to `.dev.vars`.

`bun run check` runs lint, typecheck and tests.

## Deploy

```sh
bunx wrangler login
bun run deploy
bun run db:migrate:remote
```

Sign-up is open for the first account only. To invite others, set a code: `bunx wrangler secret put SIGNUP_CODE`.

## Put it on your iPhone

Open the deployed URL in Safari, tap Share, then Add to Home Screen.

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
