/**
 * Serves the app for the browser tests (e2e/), the way `bun run dev` does but apart from it:
 *
 *   - its own stage, `e2e`, on port 4174, so it runs beside a dev server on 1337;
 *   - state kept in .alchemy rather than the Cloudflare account, so it needs no sign-in and runs in CI;
 *   - a new, empty database every time, with every migration applied. Its file is written to
 *     .alchemy/e2e-database, where e2e/web/support.ts finds it to load the seed history;
 *   - a readiness address on E2E_READY_PORT that answers only once the app has rendered its sign-in page.
 *     The first render compiles the app, which can take longer than e2e waits for one answer, so e2e
 *     waits on that address instead of the app's own (e2e.config.ts).
 *
 * e2e starts this (e2e.config.ts) and stops it when the tests finish.
 */
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { E2E_DATABASE_FILE, E2E_INVITE_CODE, E2E_PORT, E2E_READY_PORT } from "./constants"

const STAGE = "e2e"
const LOCAL_D1 = ".alchemy/local/d1/cloudflare-runtime-D1DatabaseObject"

const databases = () =>
  existsSync(LOCAL_D1) ? readdirSync(LOCAL_D1).filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite") : []

// Start from nothing: forget the last run's stage, and delete its database.
rmSync(join(".alchemy/state/Gym", STAGE), { recursive: true, force: true })

if (existsSync(E2E_DATABASE_FILE)) {
  const last = readFileSync(E2E_DATABASE_FILE, "utf8").trim()

  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${last}${suffix}`, { force: true })
  rmSync(E2E_DATABASE_FILE)
}

const before = new Set(databases())

const server = spawn("bunx", ["alchemy", "dev", "--stage", STAGE, "--no-input", "--env-file", "tools/e2e/e2e.env"], {
  stdio: "inherit",
  env: { ...process.env, ALCHEMY_LOCAL_STATE: "1", GYM_DEV_PORT: String(E2E_PORT), SIGNUP_CODE: E2E_INVITE_CODE },
})

// The database file appears once Alchemy has made it; remember which one is this run's.
const watch = setInterval(() => {
  const made = databases().find((name) => !before.has(name))

  if (made) {
    writeFileSync(E2E_DATABASE_FILE, join(LOCAL_D1, made))
    clearInterval(watch)
  }
}, 200)

let ready = false

const readiness = createServer((_, response) => {
  response.writeHead(ready ? 200 : 503).end(ready ? "ready" : "starting")
}).listen(E2E_READY_PORT, "127.0.0.1")

/** Asks for the sign-in page until it renders, giving each try as long as the first compile takes. */
const warmUp = async () => {
  while (!ready) {
    try {
      const response = await fetch(`http://localhost:${E2E_PORT}/login`, { signal: AbortSignal.timeout(120_000) })

      ready = response.status < 500
    } catch {
      // Not listening yet.
    }

    if (!ready) await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

void warmUp()

const stop = () => {
  clearInterval(watch)
  readiness.close()
  server.kill("SIGTERM")
}

process.on("SIGTERM", stop)

process.on("SIGINT", stop)

server.on("exit", (code) => process.exit(code ?? 0))
