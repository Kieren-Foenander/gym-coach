import { describe, expect, it } from "vitest"
import { coachAddress, coachApp, coachSteps, COACH_APPS, DEFAULT_COACH_APP } from "~/domain/coach-apps"

describe("connecting an AI app to the coach", () => {
  it("offers each app once, starting with the default, and ends with a catch-all", () => {
    const ids = COACH_APPS.map((app) => app.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe(DEFAULT_COACH_APP)
    expect(ids.at(-1)).toBe("other")
  })

  it("tells every app where the address goes, then to sign in, then what to ask", () => {
    for (const app of COACH_APPS) {
      const steps = coachSteps(app)
      expect(app.steps.at(-1)).toContain("address below")
      expect(steps.at(-2)).toContain("Sign in")
      expect(steps.at(-1)).toContain("build me a plan")
    }
  })

  it("only links to secure pages", () => {
    for (const app of COACH_APPS) {
      if (app.setupUrl !== null) expect(new URL(app.setupUrl).protocol).toBe("https:")
    }
  })

  it("finds an app by id", () => {
    expect(coachApp("grok").name).toBe("Grok")
  })

  it("puts /mcp on the server's origin once, with or without a trailing slash", () => {
    expect(coachAddress("https://gym.example.com")).toBe("https://gym.example.com/mcp")
    expect(coachAddress("https://gym.example.com/")).toBe("https://gym.example.com/mcp")
  })
})
