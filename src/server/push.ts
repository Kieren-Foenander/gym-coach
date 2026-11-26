/**
 * Web Push, as browsers and the iPhone's home-screen web apps receive it: a message encrypted for
 * one subscription (RFC 8291, aes128gcm) and signed by this server's key (VAPID, RFC 8292), posted
 * to the push service the subscription names, such as web.push.apple.com. Plain WebCrypto, so it
 * runs the same on Workers and in the tests.
 */

const encoder = new TextEncoder()

export const toBase64Url = (bytes: Uint8Array): string => {
  let text = ""

  for (const byte of bytes) text += String.fromCharCode(byte)

  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
  const base64 = text.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))

  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

const concat = (...parts: ReadonlyArray<Uint8Array>): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0

  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }

  return out
}

const bytes = (buffer: ArrayBuffer) => new Uint8Array(buffer)

// ---------------------------------------------------------------- the server's key

/** The key pair pushes are signed with: the public key as the browser takes it, the private key as a JWK. */
export interface VapidKeys {
  /** The uncompressed P-256 point, base64url: what PushManager.subscribe takes as applicationServerKey. */
  readonly publicKey: string
  /** The private key as JSON Web Key text. */
  readonly privateKey: string
}

const SIGNING = { name: "ECDSA", namedCurve: "P-256" } as const

export const generateVapidKeys = async (): Promise<VapidKeys> => {
  const pair = await crypto.subtle.generateKey(SIGNING, true, ["sign", "verify"])
  const publicKey = bytes(await crypto.subtle.exportKey("raw", pair.publicKey))
  const privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey)

  return { publicKey: toBase64Url(publicKey), privateKey: JSON.stringify(privateKey) }
}

/** A push service wants to know who to contact about the pushes: an https page or an email address. */
export const vapidSubject = (origin: string): string => (origin.startsWith("https://") ? origin : "mailto:nudges@localhost")

const VAPID_HOURS = 12

/** The Authorization header for one push: a short-lived token, signed, for the push service's origin. */
export const vapidAuthorization = async (endpoint: string, keys: VapidKeys, subject: string, now: number): Promise<string> => {
  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })))

  const claims = toBase64Url(
    encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + VAPID_HOURS * 3600, sub: subject })),
  )

  const key = await crypto.subtle.importKey("jwk", JSON.parse(keys.privateKey), SIGNING, false, ["sign"])
  // WebCrypto signs as r and s side by side, 64 bytes, which is the form a JWT's ES256 signature takes.
  const signature = bytes(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${claims}`)))

  return `vapid t=${header}.${claims}.${toBase64Url(signature)}, k=${keys.publicKey}`
}

// ---------------------------------------------------------------- the message

const AGREEMENT = { name: "ECDH", namedCurve: "P-256" } as const
const RECORD_SIZE = 4096

const hkdf = async (salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) => {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"])

  return bytes(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8))
}

export interface Subscription {
  readonly endpoint: string
  /** The browser's public key, base64url. */
  readonly p256dh: string
  /** The browser's auth secret, base64url. */
  readonly auth: string
}

/**
 * Encrypts a message for one subscription, as one aes128gcm record. The salt and the key pair
 * are new for every message; the tests pass their own to check the result.
 */
export const encryptPayload = async (
  payload: string,
  subscription: Pick<Subscription, "p256dh" | "auth">,
  salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16)),
): Promise<Uint8Array<ArrayBuffer>> => {
  const clientPublic = fromBase64Url(subscription.p256dh)
  const local = await crypto.subtle.generateKey(AGREEMENT, true, ["deriveBits"])
  const localPublic = bytes(await crypto.subtle.exportKey("raw", local.publicKey))
  const clientKey = await crypto.subtle.importKey("raw", clientPublic, AGREEMENT, false, [])
  const shared = bytes(await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, local.privateKey, 256))

  const ikm = await hkdf(fromBase64Url(subscription.auth), shared, concat(encoder.encode("WebPush: info\0"), clientPublic, localPublic), 32)
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16)
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12)
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"])
  // The 2 marks the last (and only) record.
  const cipher = bytes(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(encoder.encode(payload), new Uint8Array([2]))))

  const header = new Uint8Array(21 + localPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = localPublic.length
  header.set(localPublic, 21)

  return concat(header, cipher)
}

// ---------------------------------------------------------------- sending

/** What a notification shows and opens. The service worker (public/sw.js) reads these fields. */
export interface PushMessage {
  readonly title: string
  readonly body: string
  /** The page a tap opens. */
  readonly url: string
  /** A newer notification with the same tag replaces the older one. */
  readonly tag: string
}

/** sent: the push service took it. gone: the subscription no longer exists and should be forgotten. */
export type PushOutcome = "sent" | "gone" | "failed"

/** How long the push service keeps trying a phone that is off: a nudge an hour late is no use. */
const TIME_TO_LIVE_SECONDS = 30 * 60

export const sendPush = async (
  subscription: Subscription,
  message: PushMessage,
  keys: VapidKeys,
  subject: string,
  now: number,
): Promise<PushOutcome> => {
  const body = await encryptPayload(JSON.stringify(message), subscription)

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidAuthorization(subscription.endpoint, keys, subject, now),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(TIME_TO_LIVE_SECONDS),
      urgency: "normal",
    },
    body,
  }).catch(() => null)

  if (response === null) return "failed"

  if (response.status === 404 || response.status === 410) return "gone"

  return response.ok ? "sent" : "failed"
}
