import { Schema } from "effect"
import { fromBase64Url, toBase64Url } from "~/server/push"

/**
 * The browser's side of Web Push, for tests: a subscription's keys, and decrypting what the
 * server sent to it (RFC 8291), the way a push service hands it to the browser.
 */

const AGREEMENT = { name: "ECDH", namedCurve: "P-256" } as const
const encoder = new TextEncoder()

export interface TestBrowser {
  readonly p256dh: string
  readonly auth: string
  readonly decrypt: (body: Uint8Array<ArrayBuffer>) => Promise<string>
}

const concat = (...parts: ReadonlyArray<Uint8Array>) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0

  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }

  return out
}

const hkdf = async (salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) => {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"])

  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8))
}

export const makeTestBrowser = async (): Promise<TestBrowser> => {
  const pair = await crypto.subtle.generateKey(AGREEMENT, true, ["deriveBits"])
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))
  const auth = crypto.getRandomValues(new Uint8Array(16))

  const decrypt = async (body: Uint8Array<ArrayBuffer>) => {
    const salt = body.slice(0, 16)
    const idLength = body[20]!
    const serverPublic = body.slice(21, 21 + idLength)
    const cipher = body.slice(21 + idLength)
    const serverKey = await crypto.subtle.importKey("raw", serverPublic, AGREEMENT, false, [])
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: serverKey }, pair.privateKey, 256))
    const ikm = await hkdf(auth, shared, concat(encoder.encode("WebPush: info\0"), publicKey, serverPublic), 32)
    const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16)
    const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12)
    const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"])
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher))
    // The record ends with a 2 and any padding after it.
    const end = plain.lastIndexOf(2)

    return new TextDecoder().decode(plain.slice(0, end))
  }

  return { p256dh: toBase64Url(publicKey), auth: toBase64Url(auth), decrypt }
}

/** Checks a VAPID Authorization header's signature against its public key, and answers its claims. */
export const readVapid = async (header: string): Promise<typeof VapidClaims.Type | null> => {
  const [, head, claims, signature, publicKey] = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header) ?? []

  if (head === undefined || claims === undefined || signature === undefined || publicKey === undefined) return null

  const key = await crypto.subtle.importKey("raw", fromBase64Url(publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])

  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    fromBase64Url(signature),
    encoder.encode(`${head}.${claims}`),
  )

  return valid ? decodeClaims(new TextDecoder().decode(fromBase64Url(claims))) : null
}

const VapidClaims = Schema.Struct({ aud: Schema.String, exp: Schema.Number, sub: Schema.String })
const decodeClaims = Schema.decodeUnknownSync(Schema.fromJsonString(VapidClaims))
