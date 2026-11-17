/**
 * Talks to the JSON API in src/server/http.ts at the repository root. Every request is a
 * POST; an answer is `{ ok: true, value }` or `{ ok: false, error }`.
 */

export type ApiErrorCode = "unauthorized" | "not_found" | "invalid" | "server" | "network"

/** A request that did not work. `network` means the server was never reached, so it is safe to try again. */
export class ApiError extends Error {
  readonly code: ApiErrorCode

  constructor(code: ApiErrorCode, message: string) {
    super(message)
    this.name = "ApiError"
    this.code = code
  }
}

export const isApiError = (cause: unknown): cause is ApiError => cause instanceof ApiError

/** Whether a failure only means there was no connection. */
export const isOffline = (cause: unknown): boolean => isApiError(cause) && cause.code === "network"

/** What to tell the user about a failure. */
export const describeError = (cause: unknown): string =>
  cause instanceof Error && cause.message !== "" ? cause.message : "Something went wrong"

interface Failure {
  readonly code: ApiErrorCode
  readonly message: string
}

type Envelope<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: Failure }

const REQUEST_TIMEOUT_MS = 15_000

export interface Destination {
  readonly serverUrl: string
  readonly token: string | null
}

/** Sends one request and returns its value, or throws an ApiError. */
export const post = async <A>(destination: Destination, path: string, input: {}): Promise<A> => {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
  const headers = new Headers({ "content-type": "application/json" })

  if (destination.token !== null) headers.set("authorization", `Bearer ${destination.token}`)

  try {
    const response = await fetch(`${destination.serverUrl}/api/v1/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: abort.signal,
    }).catch(() => null)

    if (response === null) throw new ApiError("network", "No connection. Check your signal and try again.")

    // An address that is not this app's server answers with something else entirely, such as a web page.
    const answer: Envelope<A> | null = await response.json().catch(() => null)

    if (answer === null || !("ok" in answer)) {
      throw new ApiError("server", "That address did not answer like a Gym server.")
    }

    if (!answer.ok) throw new ApiError(answer.error.code, answer.error.message)

    return answer.value
  } finally {
    clearTimeout(timer)
  }
}

/** Tidies an address someone typed: adds https:// when there is no scheme and drops trailing slashes. */
export const normalizeServerUrl = (text: string): string => {
  const trimmed = text.trim().replace(/\/+$/, "")

  if (trimmed === "") return ""

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}
