import { AuthorizationError, CimdFetchError, OAuthProvider } from "@cloudflare/workers-oauth-provider"
import type { ConsentDescription, OAuthHelpers } from "@cloudflare/workers-oauth-provider"
import startHandler from "@tanstack/react-start/server-entry"
import { Effect, Option, Schema } from "effect"
import type { SqlClient } from "effect/sql"
import { SESSION_COOKIE, userById, userFromSession } from "./server/auth"
import { API_PREFIX, apiHandlerFor } from "./server/http"
import { isExerciseMedia, serveExerciseMedia } from "./server/media"
import { handleMcpRequest, MCP_PATH } from "./server/mcp"
import { runNudges } from "./server/minis"
import type { User } from "./server/repo"
import { runtime, signupCode, stage } from "./server/runtime"

const handleApiRequest = apiHandlerFor({ run: (effect) => runtime.runPromise(effect), signupCode, stage })

/**
 * Worker entry. Five things live behind one hostname:
 *   /exercises/*.mp4  demonstration videos and posters (.webp), streamed from the R2 bucket
 *   /mcp              the MCP server the AI coach connects to (OAuth access token required)
 *   /oauth/*          the OAuth endpoints an MCP client uses to get that token
 *   /api/v1/*         the JSON API the native app uses (session token required)
 *   everything else   the TanStack Start app
 *
 * The cron trigger in alchemy.run.ts calls `scheduled`, which sends the mini workout nudges that are due.
 */

type OAuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers }

const AUTHORIZE_PATH = "/oauth/authorize"
const SCOPE = "training"
const GrantProps = Schema.Struct({ userId: Schema.String })

const readCookie = (request: Request, name: string) =>
  request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1]

const optionalUser = (effect: Effect.Effect<User, unknown, SqlClient.SqlClient>) =>
  runtime.runPromise(Effect.catch(Effect.map(effect, (user): User | null => user), () => Effect.succeed(null)))

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #08090b; color: #f5f6f7;
    font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  main { width: min(100% - 32px, 400px); padding: 24px 0; }
  h1 { font-size: 22px; line-height: 1.25; margin: 0 0 12px; }
  p { color: #a3a3a3; margin: 0 0 12px; }
  strong { color: #fafafa; }
  ul { color: #d4d4d4; padding-left: 20px; margin: 0 0 20px; }
  .warn { color: #fbbf24; }
  .row { display: flex; gap: 12px; margin-top: 24px; }
  button { flex: 1; min-height: 48px; border-radius: 16px; border: 1px solid #272b33; background: transparent;
    color: #fafafa; font: inherit; font-weight: 600; }
  button[value=approve] { background: #d7ff3e; border-color: #d7ff3e; color: #0b0d05; }
</style>
<main>${body}</main>
</html>`

const html = (title: string, body: string, init?: ResponseInit) => {
  const headers = new Headers(init?.headers)
  headers.set("content-type", "text/html; charset=utf-8")

  return new Response(page(title, body), { ...init, headers })
}

const consentPage = (details: ConsentDescription, handle: string, user: User) => {
  const name = escapeHtml(details.clientName)

  const origin = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : "This app registered itself, so its name is not verified."

  return `
    <h1>Let ${name} coach your training?</h1>
    <p>Signed in as <strong>${escapeHtml(user.email)}</strong>.</p>
    <p>${origin} Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
    ${details.redirectIsLoopback ? `<p class="warn">This sends access to an app on your computer. Continue only if you just started connecting from it.</p>` : ""}
    <p>It will be able to:</p>
    <ul>
      <li>Read your profile, plan and workout history</li>
      <li>Create and change your plan, including target weights</li>
      <li>Log workouts and leave you notes</li>
    </ul>
    <form method="post">
      <input type="hidden" name="handle" value="${escapeHtml(handle)}">
      <div class="row">
        <button name="decision" value="deny">Deny</button>
        <button name="decision" value="approve">Allow</button>
      </div>
    </form>`
}

const authorize = async (request: Request, env: OAuthEnv): Promise<Response> => {
  const oauth = env.OAUTH_PROVIDER
  const user = await optionalUser(userFromSession(readCookie(request, SESSION_COOKIE)))

  try {
    if (request.method === "POST") {
      if (!user) return html("Signed out", `<h1>You were signed out</h1><p>Start connecting again from your AI app.</p>`, { status: 401 })
      const form = await request.formData()
      const handle = form.get("handle")

      if (handle === null || handle instanceof File) {
        return html("Something went wrong", `<h1>Something went wrong</h1><p>Start connecting again from your AI app.</p>`, { status: 400 })
      }

      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(request, handle)

        return new Response(null, { status: 302, headers: denied.headers })
      }

      const approved = await oauth.approveConsent(request, handle)

      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: user.id,
        metadata: {},
        scope: approved.request.scope,
        props: { userId: user.id } satisfies typeof GrantProps.Type,
      })

      approved.headers.set("Location", redirectTo)

      return new Response(null, { status: 302, headers: approved.headers })
    }

    const authRequest = await oauth.parseAuthRequest(request)

    if (!user) {
      const url = new URL(request.url)
      const login = new URL("/login", url.origin)
      login.searchParams.set("redirect", url.pathname + url.search)

      return Response.redirect(login.toString(), 302)
    }

    const details = await oauth.describeConsent(authRequest)
    const consent = await oauth.beginConsent(authRequest)

    return html(`Connect ${details.clientName}`, consentPage(details, consent.handle, user), { headers: consent.headers })
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302)

    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const message = error instanceof AuthorizationError ? error.description : "This app could not be verified."

      return html("Could not connect", `<h1>Could not connect</h1><p>${escapeHtml(message)}</p>`, { status: 400 })
    }

    throw error
  }
}

const mcpHandler = {
  async fetch(request: Request, _env: OAuthEnv, ctx: ExecutionContext) {
    // The props are whatever was stored at authorization time, so they are parsed like any other input.
    const props = Schema.decodeUnknownOption(GrantProps)(ctx.props)
    const user = Option.isSome(props) ? await optionalUser(userById(props.value.userId)) : null

    if (!user) return new Response("Account not found", { status: 401 })

    return handleMcpRequest(request, user)
  },
}

const appHandler = {
  fetch(request: Request, env: OAuthEnv) {
    const { pathname } = new URL(request.url)

    if (pathname === AUTHORIZE_PATH) return authorize(request, env)

    if (pathname.startsWith(API_PREFIX)) return handleApiRequest(request)

    return startHandler.fetch(request)
  },
}

// The provider has to know its own public URL. It is taken from the first request to each
// hostname, so the same build works on localhost, workers.dev and a custom domain.
const providers = new Map<string, OAuthProvider<OAuthEnv>>()

const providerFor = (origin: string) => {
  let provider = providers.get(origin)

  if (!provider) {
    provider = new OAuthProvider<OAuthEnv>({
      apiRoute: MCP_PATH,
      apiHandler: mcpHandler,
      defaultHandler: appHandler,
      authorizeEndpoint: AUTHORIZE_PATH,
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      scopesSupported: [SCOPE, "offline_access"],
      requiredScopes: [SCOPE],
      resourceMetadata: {
        resource: `${origin}${MCP_PATH}`,
        authorization_servers: [origin],
        resource_name: "Gym",
      },
      clientIdMetadataDocumentEnabled: true,
    })
    providers.set(origin, provider)
  }

  return provider
}

export default {
  fetch(request: Request, env: OAuthEnv, ctx: ExecutionContext) {
    // Public, like the static assets: the native app's video player sends no session token.
    if (isExerciseMedia(new URL(request.url).pathname)) return serveExerciseMedia(request, env.EXERCISE_MEDIA)

    return providerFor(new URL(request.url).origin).fetch(request, env, ctx)
  },
  // Every few minutes: one run looks at every user with nudges on and sends what is due.
  async scheduled(controller: ScheduledController) {
    await runtime.runPromise(
      runNudges(controller.scheduledTime).pipe(Effect.catch((error) => Effect.logError("Sending mini workout nudges failed", error))),
    )
  },
} satisfies ExportedHandler<OAuthEnv>
