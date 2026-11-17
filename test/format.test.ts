import { describe, expect, it } from "vitest"
import { formatCompact } from "~/format"

describe("formatCompact", () => {
  it("leaves small numbers alone", () => {
    expect(formatCompact(0)).toBe("0")
    expect(formatCompact(999)).toBe("999")
    expect(formatCompact(12.34)).toBe("12.3")
  })

  it("shortens thousands, millions and billions to one decimal", () => {
    expect(formatCompact(1000)).toBe("1k")
    expect(formatCompact(12_480)).toBe("12.5k")
    expect(formatCompact(1_250_000)).toBe("1.3m")
    expect(formatCompact(2_000_000_000)).toBe("2b")
  })

  it("moves up a step instead of showing 1000k", () => {
    expect(formatCompact(999_960)).toBe("1m")
  })
})
