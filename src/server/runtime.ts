import { env } from "cloudflare:workers"
import { D1Client } from "@effect/sql-d1"
import { Layer, ManagedRuntime, String as Str } from "effect"

export const DbLive = D1Client.layer({ db: env.DB, transformResultNames: Str.snakeToCamel }).pipe(Layer.orDie)

/** One runtime per isolate. Bindings come from `cloudflare:workers`, so nothing here waits on a request. */
export const runtime = ManagedRuntime.make(DbLive)

export const signupCode = (): string | undefined => env.SIGNUP_CODE || undefined

/** The Alchemy stage this Worker was deployed as, such as prod, pr-21 or dev_<user>. */
export const stage = (): string => env.STAGE
