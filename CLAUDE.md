# Working on gym

## Build every feature for the web app and the native app

The app has two clients that show the same data from the same server:

- the web app: `src/routes/` (screens) and `src/functions/` (server functions)
- the native app: `apps/mobile/src/features/` (screens) and `apps/mobile/src/api/` (the client for the JSON API)

When you build a feature a user sees or uses, build it in both clients in the same pull request. The work usually goes in this order:

1. Put shared rules and input schemas in `src/domain/` and the server logic in `src/server/`, so both clients run the same code.
2. Add the server call to `src/server/calls.ts`. Expose it to the web app through `src/functions/` and to the native app through the JSON API in `src/server/http.ts` (`/api/v1`).
3. Build the web screen in `src/routes/` and the native screen in `apps/mobile/src/features/`.
4. Add tests on both sides and run `bun run check` both at the root and in `apps/mobile`.

Build for one client only when the feature cannot work on the other. For example, lock-screen rest alerts and logging with no signal need the native app, and the install-to-home-screen steps belong to the web app. When that happens, say in the pull request description which client is left out and why.

Changes to the MCP server (`src/server/mcp.ts`) affect neither client's screens, but if a new tool writes data that people see, both clients must show it.

## Test data

When a database needs realistic training history (local dev, a preview stage, a screenshot, a test that needs many workouts), use `seed/training-history.json` and load it with `tools/seed/load.ts`, as the README describes. Don't make up workouts by hand. Tests can read the file directly, as `test/seed.test.ts` does.

## Keep tooling up to date, in its own pull request

The tooling here ships fast (oxlint, tsrs, TypeScript, Vite, Vitest, Alchemy), so keep it current. Dependabot (`.github/dependabot.yml`) opens grouped update pull requests every Monday. On top of that, when you start other work:

1. Run `bun outdated` at the root and in `apps/mobile`, and look for open Dependabot pull requests (`gh pr list --author app/dependabot`).
2. If tooling is behind and no open pull request covers it, update it on its own branch from `master` and open a separate pull request. Don't mix version bumps into a feature pull request.
3. Keep prereleases (tsrs, Alchemy betas) on exact versions. Read the release notes of anything that is still pre-1.0 or a beta before bumping it.
4. In `apps/mobile`, move Expo, React and React Native packages only with an Expo SDK upgrade (`bunx expo install --fix`), never one by one.
5. Run `bun run check` at the root and in `apps/mobile` before opening the pull request.

tsrs is used for oxlint's type-aware lint only; `tsc` stays the type checker until tsrs ships a stable release for the TypeScript version this project uses. When that happens, assess switching `typecheck` to `tsrs --noEmit`.
