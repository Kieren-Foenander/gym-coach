import { describe, expect, it } from "vitest"
import { CATALOG } from "~/domain/catalog"
import { HOW_TO, howToFor } from "~/domain/howto"

describe("how-to steps", () => {
  it("covers every library exercise and nothing else", () => {
    const names = CATALOG.map((entry) => entry.name).toSorted()

    expect(Object.keys(HOW_TO).toSorted()).toEqual(names)
  })

  it("gives each exercise three full sentences", () => {
    for (const [name, steps] of Object.entries(HOW_TO)) {
      expect(steps.length, name).toBe(3)

      for (const step of steps) {
        expect(step, name).toMatch(/^[A-Z].{8,}\.$/)
      }

      expect(new Set(steps).size, name).toBe(steps.length)
    }
  })

  it("finds steps whatever the case and returns none for unknown names", () => {
    expect(howToFor("bench press")).toEqual(HOW_TO["Bench Press"])
    expect(howToFor("Underwater Basket Weaving")).toEqual([])
  })
})
