import type { WebsiteEnv } from "../alchemy.run"

// What `env` from "cloudflare:workers" holds: the bindings alchemy.run.ts gives the Worker.
declare global {
  namespace Cloudflare {
    interface Env extends WebsiteEnv {}
  }

  interface Env extends Cloudflare.Env {}
}
