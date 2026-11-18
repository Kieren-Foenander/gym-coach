import Constants from "expo-constants"
import { useSyncExternalStore } from "react"
import type { CallName } from "~/domain/calls"
import type { CallInput, CallOutput } from "~/server/calls"
import type { User } from "~/server/repo"
import { queryClient } from "@/data/query-client"
import { secureStorage } from "@/data/secure-storage"
import { storage } from "@/data/storage"
import { ApiError, isApiError, normalizeServerUrl, post } from "./client"

/**
 * Who is signed in, and to which server. The token is kept in the phone's keychain;
 * the server address and the profile are kept beside the cached screens.
 */

export type SessionState =
  | { readonly status: "loading" }
  | { readonly status: "signedOut"; readonly serverUrl: string }
  | { readonly status: "signedIn"; readonly serverUrl: string; readonly token: string; readonly user: User }

const TOKEN_KEY = "gym.token"
const SERVER_KEY = "gym.serverUrl"
const USER_KEY = "gym.user"

const configuredServer: string | undefined = Constants.expoConfig?.extra?.defaultServerUrl

export const DEFAULT_SERVER_URL = normalizeServerUrl(configuredServer ?? "")

let state: SessionState = { status: "loading" }

const listeners = new Set<() => void>()

const setState = (next: SessionState) => {
  state = next

  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export const getSession = () => state

/** Runs the listener whenever someone signs in or out. */
export const onSessionChange = subscribe

export const useSession = () => useSyncExternalStore(subscribe, getSession, getSession)

const readUser = (): User | null => {
  const saved = storage.get(USER_KEY)

  if (saved === null) return null

  try {
    const user: User = JSON.parse(saved)

    return user
  } catch {
    return null
  }
}

/** Picks up where the last launch left off. Works with no signal: nothing here asks the server. */
export const restoreSession = async () => {
  const serverUrl = storage.get(SERVER_KEY) ?? DEFAULT_SERVER_URL
  const token = await secureStorage.get(TOKEN_KEY).catch(() => null)
  const user = readUser()

  setState(token !== null && user !== null ? { status: "signedIn", serverUrl, token, user } : { status: "signedOut", serverUrl })
}

interface NewSession {
  readonly token: string
  readonly user: User
}

const begin = async (serverUrl: string, session: NewSession) => {
  await secureStorage.set(TOKEN_KEY, session.token)
  storage.set(SERVER_KEY, serverUrl)
  storage.set(USER_KEY, JSON.stringify(session.user))
  // Whatever is cached belongs to whoever was signed in before.
  queryClient.clear()
  setState({ status: "signedIn", serverUrl, token: session.token, user: session.user })
}

/** Forgets the session on this phone without telling the server, for when the server has already ended it. */
const forget = async () => {
  const serverUrl = state.status === "loading" ? DEFAULT_SERVER_URL : state.serverUrl

  await secureStorage.remove(TOKEN_KEY).catch(() => undefined)
  storage.remove(USER_KEY)
  queryClient.clear()
  setState({ status: "signedOut", serverUrl })
}

export interface SignInDetails {
  readonly serverUrl: string
  readonly email: string
  readonly password: string
}

export const signIn = async (details: SignInDetails) => {
  const serverUrl = normalizeServerUrl(details.serverUrl)

  await begin(
    serverUrl,
    await post<NewSession>({ serverUrl, token: null }, "account/sign-in", {
      email: details.email,
      password: details.password,
    }),
  )
}

export interface SignUpDetails extends SignInDetails {
  readonly displayName: string
  readonly inviteCode: string
}

export const signUp = async (details: SignUpDetails) => {
  const serverUrl = normalizeServerUrl(details.serverUrl)

  await begin(
    serverUrl,
    await post<NewSession>({ serverUrl, token: null }, "account/sign-up", {
      email: details.email,
      password: details.password,
      displayName: details.displayName,
      inviteCode: details.inviteCode,
    }),
  )
}

export interface SignupStatus {
  readonly firstUser: boolean
  readonly open: boolean
}

export const fetchSignupStatus = (serverUrl: string) =>
  post<SignupStatus>({ serverUrl: normalizeServerUrl(serverUrl), token: null }, "account/signup-status", {})

/** Which copy of the app the server is (prod, pr-21, dev_<user>). The AI coach card names the connector after it. */
export const fetchDeployment = (serverUrl: string) =>
  post<{ readonly stage: string | null }>({ serverUrl: normalizeServerUrl(serverUrl), token: null }, "deployment", {})

export const signOut = async () => {
  if (state.status === "signedIn") {
    // Ending the session on the server is a courtesy. Signing out here must work with no signal too.
    await post<null>(state, "account/sign-out", {}).catch(() => undefined)
  }

  await forget()
}

/** Keeps the saved profile in step after it is read from, or changed on, the server. */
export const rememberUser = (user: User) => {
  if (state.status !== "signedIn") return

  storage.set(USER_KEY, JSON.stringify(user))
  setState({ ...state, user })
}

/** Makes one of the calls in src/domain/calls.ts as the signed-in user. */
export const call = async <K extends CallName>(name: K, input: CallInput<K>): Promise<CallOutput<K>> => {
  if (state.status !== "signedIn") throw new ApiError("unauthorized", "Not signed in")

  try {
    return await post<CallOutput<K>>(state, `call/${name}`, input)
  } catch (cause) {
    // The server no longer knows this session, so the sign-in screen is the only way forward.
    if (isApiError(cause) && cause.code === "unauthorized") await forget()

    throw cause
  }
}
