import { describe, expect, it } from "vitest"
import { coachAction, coachAddress, coachApp, coachSteps, COACH_APPS, DEFAULT_COACH_APP } from "~/domain/coach-apps"

const address = "https://gym.example.com/mcp"

describe("connecting an AI app to the coach", () => {
  it("offers each app once, starting with the default, and ends with a catch-all", () => {
    const ids = COACH_APPS.map((app) => app.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe(DEFAULT_COACH_APP)
    expect(ids.at(-1)).toBe("other")
  })

  it("ends every app's steps with signing in, then what to ask", () => {
    for (const app of COACH_APPS) {
      const steps = coachSteps(app)
      expect(steps.at(-2)).toContain("Sign in")
      expect(steps.at(-1)).toContain("build me a plan")
    }
  })

  it("names the button in the first step when there is one", () => {
    for (const app of COACH_APPS) {
      const action = coachAction(app, address)

      if (action) expect(app.steps[0]).toContain(`Tap ${action.label}`)
    }
  })

  it("opens Claude's add-connector dialog with the name and address filled in", () => {
    const action = coachAction(coachApp("claude"), "https://gym.example.com/mcp?a=1&b=2")
    expect(action?.copiesAddress).toBe(false)
    const url = new URL(action?.url ?? "")
    expect(url.origin).toBe("https://claude.ai")
    expect(url.searchParams.get("modal")).toBe("add-custom-connector")
    expect(url.searchParams.get("connectorName")).toBe("Gym")
    // The address is encoded, so its own query can't leak into the link's.
    expect(url.searchParams.get("connectorUrl")).toBe("https://gym.example.com/mcp?a=1&b=2")
  })

  it("copies the address and opens the setup page for apps without a prefill link", () => {
    const action = coachAction(coachApp("chatgpt"), address)
    expect(action).toEqual({ label: "Copy and open ChatGPT", url: "https://chatgpt.com/plugins", copiesAddress: true })
    expect(coachAction(coachApp("other"), address)).toBeNull()
  })

  it("only links to secure pages", () => {
    for (const app of COACH_APPS) {
      const action = coachAction(app, address)

      if (action) expect(new URL(action.url).protocol).toBe("https:")
    }
  })

  it("puts /mcp on the server's origin once, with or without a trailing slash", () => {
    expect(coachAddress("https://gym.example.com")).toBe("https://gym.example.com/mcp")
    expect(coachAddress("https://gym.example.com/")).toBe("https://gym.example.com/mcp")
  })
})
