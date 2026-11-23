# Working on gym

## Build every feature for the web app and the native app

The app has two clients that show the same data from the same server:

- the web app: `src/routes/` (screens) and `src/functions/` (server functions)
- the native app: `apps/mobile/src/features/` (screens) and `apps/mobile/src/api/` (the client for the JSON API)

When you build a feature a user sees or uses, build it in both clients in the same pull request. The work usually goes in this order:

1. Put shared rules and input schemas in `src/domain/` and the server logic in `src/server/`, so both clients run the same code.
2. Add the server call to `src/server/calls.ts`. Expose it to the web app through `src/functions/` and to the native app through the JSON API in `src/server/http.ts` (`/api/v1`).
3. Build the web screen in `src/routes/` and the native screen in `apps/mobile/src/features/`.
4. Add tests on both sides and run `bun run check` both at the root and in `apps/mobile`. See "Verify every change" below.

Build for one client only when the feature cannot work on the other. For example, lock-screen rest alerts and logging with no signal need the native app, and the install-to-home-screen steps belong to the web app. When that happens, say in the pull request description which client is left out and why.

Changes to the MCP server (`src/server/mcp.ts`) affect neither client's screens, but if a new tool writes data that people see, both clients must show it.

## Verify every change

`master` is protected: a pull request merges only when the CI checks pass, and nothing is pushed to `master` directly. The same checks run on your machine before every push (`.githooks/pre-push`, turned on by `bun install`). Don't skip them with `--no-verify` to get a change out; fix what fails.

What each change needs:

- **A server call that is new or changed** gets a test in `test/server/`, which runs the real JSON API (`src/server/http.ts` and everything behind it) on SQLite with every migration and, where it helps, the seed history. Test what the call does to the data, not only that it answers.
- **Every call is in the API contract** (`test/server/contract.test.ts`). Its step list is typed by call name, so a new call doesn't typecheck until it has a step. The test records the shape of every answer in `test/server/api-signatures.json`:
  - If a change only adds to an answer, run `UPDATE_API_SIGNATURES=1 bun run test` and commit the file.
  - If it reports a breaking change (a field removed, a value that can now be null), native builds already on phones would break. Keep the old field instead. If it really must go, change `apps/mobile` first and say in the pull request what happens to older builds.
- **A migration** is a new file with the next number. Never edit, rename or delete one that is on `master`; CI fails if you do, because deployed databases have already run it.
- **Shared rules in `src/domain/`** get unit tests in `test/`, and the native side gets tests in `apps/mobile/test/` when its screens read them.
- **A screen that is new or changed** gets a browser test in `e2e/web/` for what someone does on it (`bun run e2e`), written with [e2e](https://e2e.com). Tag a test `smoke` (`{ tags: ["smoke"] }`) if it works on an empty database; those also run against the pull request's preview deploy. A screen whose look matters gets a screenshot comparison in `e2e/web/screenshots.e2e.ts`, showing data that doesn't change with the date. When a change is meant to alter how it looks, run the "Update screenshots" workflow on the branch and check the new images in the pull request.
- **A native screen that is new or changed** gets a step in the native tour, `e2e/native/tour.e2e.ts`, with the same runner (`e2e.config.ts`). It checks what the screen shows by test id, as the browser tests do; a device reads no `data-state`, so assert on an element being there or selected. `.github/workflows/ios-tour.yml` runs it on an iOS Simulator and keeps a recording and screenshots. It is paused until there is an Apple developer account, and runs only when started by hand from the Actions tab. To run it on an Android emulator, see the comment in `e2e.config.ts`.

## Test ids

Tests find elements by test id and by nothing else. Text, roles, labels, placeholders, CSS classes and page structure all change when the wording or the design does, so a test built on them breaks for no reason. `test/test-ids.test.ts` fails the build if these rules are broken.

- **One registry.** Every id is in `src/domain/test-ids.ts`, used as `data-testid={testIds.calendar.nextMonth}` on the web and as `testID={testIds.calendar.nextMonth}` in the native app, so both clients and their tests share the same ids. Never write an id as a string in a screen or a test; add it to the registry.
- **Format.** `<screen>.<element>`, in lower-case words joined by hyphens: `calendar.next-month`, `settings.save-profile`. The first part is the screen, or the shared component (`stepper.input`), it is listed under.
- **One of many.** A repeated element adds `:<key>`, where the key comes from the data and stays the same when the order or the wording changes: a date (`calendar.day:2026-11-19`, from `dayKey`), an exercise slug (`workout.exercise:bench-press`), an id (`plan.template:full-body-3`). Never use a position on screen.
- **Parts of a keyed element** keep plain ids, and a test looks for them inside it: `card.getByTestId(testIds.workout.logSet)`.
- **State and values.** What an element shows goes in `data-state` (values from the registry, such as `DAY_STATES.trained`), and a number it shows goes in `data-value`. Tests check those attributes, never the words on screen, so `toHaveText` and `getByText` are off limits.
- **Give an id to what a test needs**, not to every element: what someone taps or types into, and what shows the result.

## Test data

When a database needs realistic training history (local dev, a preview stage, a screenshot, a test that needs many workouts), use `seed/training-history.json` and load it with `tools/seed/load.ts`, as the README describes. Don't make up workouts by hand. Tests can read the file directly, as `test/seed.test.ts` does.

## Keep tooling up to date, in its own pull request

The tooling here ships fast (oxlint, tsrs, TypeScript, Vite, Vitest, Alchemy), so keep it current. Dependabot (`.github/dependabot.yml`) opens grouped update pull requests every Monday. On top of that, when you start other work:

1. Run `bun outdated` at the root and in `apps/mobile`, and look for open Dependabot pull requests (`gh pr list --author app/dependabot`).
2. If tooling is behind and no open pull request covers it, update it on its own branch from `master` and open a separate pull request. Don't mix version bumps into a feature pull request.
3. Keep prereleases (tsrs, Alchemy betas) on exact versions. Read the release notes of anything that is still pre-1.0 or a beta before bumping it.
4. In `apps/mobile`, move Expo, React and React Native packages only with an Expo SDK upgrade (`bunx expo install --fix`), never one by one.
5. Run `bun run check` at the root and in `apps/mobile` before opening the pull request.

The `playwright-core` that `@e2e-dev/web` pins and the Playwright Docker image tag (in `.github/workflows/` and `tools/e2e/screenshots.sh`) move together; `test/playwright-image.test.ts` fails until they match. Record the screenshots again after a bump.

tsrs is used for oxlint's type-aware lint only; `tsc` stays the type checker until tsrs ships a stable release for the TypeScript version this project uses. When that happens, assess switching `typecheck` to `tsrs --noEmit`.
