import { Clock, Effect } from "effect"
import { SqlClient } from "effect/sql"
import { Invalid, Unauthorized } from "./errors"
import type { User } from "./repo"

export const SESSION_COOKIE = "gym_session"
export const SESSION_DAYS = 90
const SESSION_MS = SESSION_DAYS * 86_400_000

// Workers caps PBKDF2 at 100,000 iterations.
const PBKDF2_ITERATIONS = 100_000

const encoder = new TextEncoder()
const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
const fromHex = (hex: string) => new Uint8Array((hex.match(/.{2}/g) ?? []).map((pair) => parseInt(pair, 16)))

const pbkdf2 = (password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) =>
  Effect.promise(async () => {
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"])
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256)

    return new Uint8Array(bits)
  })

const sha256 = (value: string) =>
  Effect.promise(async () => toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))))

const constantTimeEqual = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false
  let diff = 0

  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!

  return diff === 0
}

export const hashPassword = (password: string) =>
  Effect.gen(function* () {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const hash = yield* pbkdf2(password, salt, PBKDF2_ITERATIONS)

    return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(hash)}`
  })

export const verifyPassword = (password: string, stored: string) =>
  Effect.gen(function* () {
    const [scheme, iterations, salt, hash] = stored.split("$")

    if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return false
    const actual = yield* pbkdf2(password, fromHex(salt), Number(iterations))

    return constantTimeEqual(actual, fromHex(hash))
  })

const USER_COLUMNS = `u.id, u.email, u.display_name, u.unit, u.goal, u.training_context`

const createSession = Effect.fn("createSession")(function* (userId: string) {
  const sql = yield* SqlClient.SqlClient
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)))
  const current = yield* Clock.currentTimeMillis
  yield* sql`DELETE FROM sessions WHERE expires_at < ${current}`
  yield* sql`INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${yield* sha256(token)}, ${userId}, ${current + SESSION_MS})`

  return token
})

/**
 * Creates an account and a session. The first account needs no invite; after
 * that, sign-up needs the SIGNUP_CODE secret, and is closed if none is set.
 */
export const signUp = Effect.fn("signUp")(function* (
  input: {
    readonly email: string
    readonly password: string
    readonly displayName: string
    readonly inviteCode?: string | undefined
  },
  signupCode: string | undefined,
) {
  const sql = yield* SqlClient.SqlClient
  const counts = yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM users`

  if (counts[0]!.count > 0) {
    if (!signupCode) return yield* new Invalid({ reason: "Sign-up is closed" })
    const given = encoder.encode(input.inviteCode ?? "")

    if (!constantTimeEqual(given, encoder.encode(signupCode))) {
      return yield* new Invalid({ reason: "That invite code is not right" })
    }
  }

  const existing = yield* sql`SELECT id FROM users WHERE email = ${input.email}`

  if (existing.length > 0) return yield* new Invalid({ reason: "An account with that email already exists" })
  const id = crypto.randomUUID()
  yield* sql`INSERT INTO users (id, email, password_hash, display_name, created_at)
    VALUES (${id}, ${input.email}, ${yield* hashPassword(input.password)}, ${input.displayName},
      ${yield* Clock.currentTimeMillis})`

  return yield* createSession(id)
})

export const signIn = Effect.fn("signIn")(function* (input: { readonly email: string; readonly password: string }) {
  const sql = yield* SqlClient.SqlClient

  const rows = yield* sql<{ id: string; passwordHash: string }>`
    SELECT id, password_hash FROM users WHERE email = ${input.email}`

  const user = rows[0]

  // Hash even when the account is missing so timing does not reveal which emails exist.
  const ok = yield* verifyPassword(
    input.password,
    user?.passwordHash ?? `pbkdf2$${PBKDF2_ITERATIONS}$00000000000000000000000000000000$00`,
  )

  if (!user || !ok) return yield* new Invalid({ reason: "Wrong email or password" })

  return yield* createSession(user.id)
})

export const signOut = Effect.fn("signOut")(function* (token: string | undefined) {
  if (!token) return
  const sql = yield* SqlClient.SqlClient
  yield* sql`DELETE FROM sessions WHERE token_hash = ${yield* sha256(token)}`
})

export const userFromSession = Effect.fn("userFromSession")(function* (token: string | undefined) {
  if (!token) return yield* new Unauthorized()
  const sql = yield* SqlClient.SqlClient

  const rows = yield* sql<User>`
    SELECT ${sql.unsafe(USER_COLUMNS)} FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${yield* sha256(token)} AND s.expires_at > ${yield* Clock.currentTimeMillis}`

  return rows[0] ?? (yield* new Unauthorized())
})

export const userById = Effect.fn("userById")(function* (userId: string) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<User>`SELECT ${sql.unsafe(USER_COLUMNS)} FROM users u WHERE u.id = ${userId}`

  return rows[0] ?? (yield* new Unauthorized())
})

export const signupStatus = Effect.fn("signupStatus")(function* (signupCode: string | undefined) {
  const sql = yield* SqlClient.SqlClient
  const counts = yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM users`
  const firstUser = counts[0]!.count === 0

  return { firstUser, open: firstUser || Boolean(signupCode) }
})
