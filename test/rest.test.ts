import { describe, expect, it } from "vitest"
import { adjustRest } from "~/domain/rest"

describe("adjustRest", () => {
  const rest = { endsAt: 120_000, total: 120, title: "Squat" }

  it("adds time to the end and the whole", () => {
    expect(adjustRest(rest, 30, 0)).toEqual({ endsAt: 150_000, total: 150, title: "Squat" })
  })

  it("cuts time off the end and the whole", () => {
    expect(adjustRest(rest, -30, 60_000)).toEqual({ endsAt: 90_000, total: 90, title: "Squat" })
  })

  it("ends the rest when the cut leaves nothing", () => {
    expect(adjustRest(rest, -30, 100_000)).toBeNull()
    expect(adjustRest(rest, -30, 90_000)).toBeNull()
  })
})
