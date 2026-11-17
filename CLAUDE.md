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
