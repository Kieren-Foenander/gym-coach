import { afterAll, beforeAll, describe, expect, it } from "vitest"

// Node has these methods and Hermes does not. Take Node's away so the test runs the fallbacks the phone runs.
const NAMES = ["toSorted", "toReversed", "toSpliced", "with"] as const
const native = NAMES.map((name) => Object.getOwnPropertyDescriptor(Array.prototype, name))

beforeAll(async () => {
  for (const name of NAMES) Reflect.deleteProperty(Array.prototype, name)

  const { installArrayPolyfills } = await import("../src/lib/array-polyfills")
  installArrayPolyfills()
})

afterAll(() => {
  NAMES.forEach((name, index) => {
    const descriptor = native[index]

    if (descriptor) Object.defineProperty(Array.prototype, name, descriptor)
  })
})

describe("array polyfills", () => {
  it("are the fallbacks, not the engine's own", () => {
    NAMES.forEach((name, index) => {
      expect(Object.getOwnPropertyDescriptor(Array.prototype, name)?.value).not.toBe(native[index]?.value)
    })
  })

  it("sort, reverse, splice and replace without changing the original", () => {
    const original = [3, 1, 2]

    expect(original.toSorted((a, b) => a - b)).toEqual([1, 2, 3])
    expect(original.toReversed()).toEqual([2, 1, 3])
    expect(original.toSpliced(1, 1, 9, 8)).toEqual([3, 9, 8, 2])
    expect(original.toSpliced(1)).toEqual([3])
    expect(original.with(-1, 7)).toEqual([3, 1, 7])
    expect(original).toEqual([3, 1, 2])
  })

  it("refuses an index outside the array, as the standard does", () => {
    expect(() => [1].with(1, 2)).toThrow(RangeError)
  })

  it("stay out of for-in loops", () => {
    expect(Object.keys(Array.prototype)).toEqual([])
  })
})
