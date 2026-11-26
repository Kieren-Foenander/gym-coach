import { describe, expect, it } from "vitest"
import { encryptPayload, fromBase64Url, generateVapidKeys, toBase64Url, vapidAuthorization, vapidSubject } from "~/server/push"
import { makeTestBrowser, readVapid } from "./push-client"

/** Web Push as the server sends it: encrypted so only the browser can read it, and signed by the server. */

describe("base64url", () => {
  it("round-trips bytes, padded or not", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255])

    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
    expect(toBase64Url(bytes)).not.toMatch(/[+/=]/)
    expect(fromBase64Url(`${toBase64Url(bytes)}==`)).toEqual(bytes)
  })
})

describe("encrypting a message", () => {
  it("can be read by the browser it was made for, as one aes128gcm record", async () => {
    const browser = await makeTestBrowser()
    const body = await encryptPayload('{"title":"Got time for 25 push-ups?"}', browser)

    expect(new DataView(body.buffer).getUint32(16)).toBe(4096)
    expect(body[20]).toBe(65)
    expect(await browser.decrypt(body)).toBe('{"title":"Got time for 25 push-ups?"}')
  })

  it("comes out different every time, and cannot be read by another browser", async () => {
    const browser = await makeTestBrowser()
    const other = await makeTestBrowser()
    const first = await encryptPayload("same", browser)
    const second = await encryptPayload("same", browser)

    expect(toBase64Url(first)).not.toBe(toBase64Url(second))
    await expect(other.decrypt(first)).rejects.toThrow()
  })
})

describe("signing for the push service", () => {
  it("names the push service, expires within a day and carries the public key", async () => {
    const keys = await generateVapidKeys()
    const now = Date.UTC(2026, 10, 26, 9)
    const header = await vapidAuthorization("https://web.push.apple.com/abc123", keys, "https://gym.example.com", now)
    const claims = await readVapid(header)

    expect(fromBase64Url(keys.publicKey)).toHaveLength(65)
    expect(header.endsWith(`k=${keys.publicKey}`)).toBe(true)
    expect(claims).toEqual({ aud: "https://web.push.apple.com", exp: now / 1000 + 12 * 3600, sub: "https://gym.example.com" })
  })

  it("names an https app, or an address when the app runs on this machine", () => {
    expect(vapidSubject("https://gym.example.com")).toBe("https://gym.example.com")
    expect(vapidSubject("http://localhost:1337")).toMatch(/^mailto:/)
  })
})
