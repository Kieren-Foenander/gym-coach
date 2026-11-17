import { describe, expect, it } from "vitest"
import { ApiError, describeError, isOffline, normalizeServerUrl } from "@/api/client"

describe("normalizeServerUrl", () => {
  it("adds https when no scheme is typed", () => {
    expect(normalizeServerUrl("gym.example.workers.dev")).toBe("https://gym.example.workers.dev")
  })

  it("keeps a scheme that was typed, so a local server over http works", () => {
    expect(normalizeServerUrl("http://192.168.1.20:1337")).toBe("http://192.168.1.20:1337")
  })

  it("drops spaces and trailing slashes", () => {
    expect(normalizeServerUrl("  https://gym.example.dev// ")).toBe("https://gym.example.dev")
  })

  it("leaves nothing as nothing", () => {
    expect(normalizeServerUrl("   ")).toBe("")
  })
})

describe("errors", () => {
  it("treats only a missing connection as offline", () => {
    expect(isOffline(new ApiError("network", "No connection"))).toBe(true)
    expect(isOffline(new ApiError("invalid", "Nope"))).toBe(false)
    expect(isOffline(new Error("boom"))).toBe(false)
  })

  it("has something to say about any failure", () => {
    expect(describeError(new ApiError("invalid", "Rep range 12-8 is upside down"))).toBe("Rep range 12-8 is upside down")
    expect(describeError("what")).toBe("Something went wrong")
  })
})
