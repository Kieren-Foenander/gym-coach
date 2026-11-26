import type { PushState } from "~/domain/test-ids"

/**
 * Turning mini workout nudges on and off in this browser. On an iPhone, web push only works in the
 * app added to the home screen (iOS 16.4 and later), and permission can only be asked for from a tap
 * inside it. public/sw.js shows the nudges.
 */

const WORKER_URL = "/sw.js"

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && navigator.standalone === true)

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window

/** What this browser can do about nudges, before asking it anything. */
export const pushSupport = (): Exclude<PushState, "on" | "off"> | "ready" => {
  if (isIos() && !isStandalone()) return "install"

  if (!supported()) return "unsupported"

  return Notification.permission === "denied" ? "blocked" : "ready"
}

const registration = async () =>
  (await navigator.serviceWorker.getRegistration(WORKER_URL)) ?? navigator.serviceWorker.register(WORKER_URL)

/** The subscription this browser holds, or null when nudges are off here. */
export const currentSubscription = async (): Promise<PushSubscription | null> => {
  if (pushSupport() !== "ready") return null

  const existing = await navigator.serviceWorker.getRegistration(WORKER_URL)

  return existing ? existing.pushManager.getSubscription() : null
}

const keyBytes = (base64url: string): Uint8Array<ArrayBuffer> => {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))

  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export interface SubscriptionJson {
  readonly endpoint: string
  readonly keys: { readonly p256dh: string; readonly auth: string }
}

/**
 * Asks for permission and subscribes, with the server's public key. Must run from a tap. Answers
 * the subscription to send to the server, or why there is none.
 */
export const subscribe = async (publicKey: string): Promise<SubscriptionJson | "blocked" | "dismissed"> => {
  const permission = await Notification.requestPermission()

  if (permission === "denied") return "blocked"

  if (permission !== "granted") return "dismissed"

  const worker = await registration()

  await navigator.serviceWorker.ready

  const subscription =
    (await worker.pushManager.getSubscription()) ??
    (await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }))

  const json = subscription.toJSON()

  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("This browser gave no push address")

  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }
}

/** Stops nudges here. Answers the endpoint the server should forget. */
export const unsubscribe = async (): Promise<string | null> => {
  const subscription = await currentSubscription()

  if (!subscription) return null

  await subscription.unsubscribe()

  return subscription.endpoint
}

/** The device's time zone, which the nudge window is read in. */
export const deviceTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""
