import { describe, expect, it } from "vitest"
import { adjustRest, restElapsed } from "~/domain/rest"

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

describe("restElapsed", () => {
  const rest = { endsAt: 120_000, total: 120 }

  it("is nothing at the start and all of it at the end", () => {
    expect(restElapsed(rest, 0)).toBe(0)
    expect(restElapsed(rest, 120_000)).toBe(1)
  })

  it("grows as the rest runs out", () => {
    expect(restElapsed(rest, 30_000)).toBe(0.25)
  })

  it("stays between nothing and all of it", () => {
    expect(restElapsed(rest, -10_000)).toBe(0)
    expect(restElapsed(rest, 200_000)).toBe(1)
  })
})
