import * as Cloudflare from "@alchemy.run/cloudflare"
import * as GitHub from "@alchemy.run/github"
import * as Alchemy from "alchemy"
import * as Output from "alchemy/Output"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import { MEDIA_BUCKET } from "./src/server/media"

/**
 * Everything the app runs on, declared in one place. `alchemy deploy --stage <name>` makes it so.
 *
 * Each stage is a separate copy: its own Worker, database and key-value store. They all read the same
 * R2 bucket of exercise videos, which Alchemy only looks up: tools/mannequin/publish.sh fills it.
 *   prod      the live app. It keeps the names it had before Alchemy, so the address and the data stay.
 *   pr-<n>    a preview for one pull request, made and removed by .github/workflows/deploy.yml.
 *   anything else is yours to try things in (the default is live_<your user name>).
 */

const PRODUCTION = "prod"
const STATE_STORE = "gym-state-store"

/** The resources the live app was first deployed with, by name. Other stages get generated names. */
const LIVE_NAMES = { worker: "gym", database: "gym", grants: "gym-oauth-kv" } as const

type Names = typeof LIVE_NAMES | null

// The live database and grants hold real data, so Alchemy refuses any plan that would delete or replace them.
const database = (names: Names) =>
  Cloudflare.D1.Database("Database", { name: names?.database, migrations: "./migrations" }).pipe(
    Alchemy.RemovalPolicy.protect(names !== null),
  )

/** Holds the OAuth grants and tokens of connected AI coaches. */
const grants = (names: Names) =>
  Cloudflare.KV.Namespace("OAuthGrants", { title: names?.grants }).pipe(Alchemy.RemovalPolicy.protect(names !== null))

// Optional. When set, people after the first account can sign up with this invite code. Empty means sign-up is closed.
const signupCode = Config.Redacted("SIGNUP_CODE").pipe(Config.withDefault(Redacted.make("")))

// Set by tools/e2e/serve.ts: the browser tests run `alchemy dev` on a machine with no Cloudflare account.
const NO_ACCOUNT = process.env.ALCHEMY_LOCAL_STATE === "1"

// The demonstration videos and posters. Made once with `cf r2 buckets create` and never managed here,
// so no stage can delete it, and previews show the same videos as prod. Looking it up needs the account,
// so with none, `alchemy dev` gets an empty local bucket instead and the demos show no video.
const exerciseMedia = NO_ACCOUNT ? Cloudflare.R2.Bucket("ExerciseMedia") : Cloudflare.R2.Bucket.lookup({ name: MEDIA_BUCKET })

const bindings = (names: Names, stage: string) => ({
  DB: database(names),
  OAUTH_KV: grants(names),
  EXERCISE_MEDIA: exerciseMedia,
  SIGNUP_CODE: signupCode,
  // Which copy this is, so a test copy's MCP server and connector name say so (src/domain/coach-apps.ts).
  STAGE: stage,
})

/** The bindings the Worker is given. src/env.d.ts makes them the type of `env`. */
export type WebsiteEnv = Cloudflare.InferEnv<ReturnType<typeof bindings>>

export default Alchemy.Stack(
  "Gym",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    // State is kept in the Cloudflare account, so a laptop and CI see the same thing. It has a store of
    // its own, so upgrading Alchemy here never touches the store other projects on the account share.
    // The browser tests serve the app with `alchemy dev` on a machine with no Cloudflare account (see
    // tools/e2e/serve.ts), so they keep state in .alchemy instead.
    state: NO_ACCOUNT ? Alchemy.localState() : Cloudflare.state({ workerName: STATE_STORE }),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage
    const names = stage === PRODUCTION ? LIVE_NAMES : null

    const app = yield* Cloudflare.Website.Vite("Website", {
      name: names?.worker,
      // src/server.ts wraps the TanStack Start handler with the OAuth provider and the MCP server.
      main: "src/server.ts",
      compatibility: { date: "2026-11-01", flags: ["nodejs_compat", "global_fetch_strictly_public"] },
      env: bindings(names, stage),
      // Sends the mini workout nudges that are due (the `scheduled` handler in src/server.ts).
      crons: ["*/5 * * * *"],
      // The browser tests serve their own copy on another port, beside a `bun run dev` already running.
      dev: process.env.GYM_DEV_PORT ? { port: Number(process.env.GYM_DEV_PORT), strictPort: true } : undefined,
    })

    const github = yield* GitHub.GitHubEnv

    if (github?.pr) {
      yield* GitHub.Comment("PreviewComment", {
        owner: github.owner,
        repository: github.repository,
        issueNumber: github.pr,
        body: Output.interpolate`**Preview:** ${app.url}\n\nBuilt from ${github.sha.slice(0, 7)}. It has its own empty database, and is removed when this pull request closes.`,
      })
    }

    return { url: app.url }
  }),
)
