import { describe, expect, it } from "vitest"
import { coachAddress, COACH_APPS } from "~/domain/coach-apps"

// The settings screen builds the address from the server URL the user signed in to, which may end in a slash.
describe("the AI coach card in the native app", () => {
  it("shows the MCP address for the signed-in server", () => {
    expect(coachAddress("https://gym.example.workers.dev/")).toBe("https://gym.example.workers.dev/mcp")
  })

  it("has a short name for every app so the chips fit on a phone", () => {
    for (const app of COACH_APPS) expect(app.name.length).toBeLessThanOrEqual(10)
  })
})
