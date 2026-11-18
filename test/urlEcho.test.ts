import { describe, expect, it } from "vitest"
import { createUrlEcho } from "~/components/urlEcho"

describe("createUrlEcho", () => {
  it("ignores the URL catching up one letter at a time behind fast typing", () => {
    const echo = createUrlEcho()

    for (const text of ["b", "be", "ben", "benc", "bench"]) echo.wrote(text)
    expect(["b", "be", "ben", "benc", "bench"].map((value) => echo.isOutside(value))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
  })

  it("ignores intermediate values the router skipped over", () => {
    const echo = createUrlEcho()

    for (const text of ["s", "sq", "squ"]) echo.wrote(text)
    expect(echo.isOutside("sq")).toBe(false)
    expect(echo.isOutside("squ")).toBe(false)
  })

  it("takes a value the field never wrote, such as the tab bar clearing the search", () => {
    const echo = createUrlEcho()
    echo.wrote("row")
    expect(echo.isOutside("")).toBe(true)
  })

  it("takes an earlier value again once the URL has caught up", () => {
    const echo = createUrlEcho()
    echo.wrote("")
    echo.wrote("press")
    expect(echo.isOutside("press")).toBe(false)
    // Back to a cleared search from elsewhere, after the field's own writes have settled.
    expect(echo.isOutside("")).toBe(true)
  })
})
