import { describe, expect, it } from "vitest"
import { compareSignatures, signatureOf, type Json } from "./signature"

const breaking = (before: Json, after: Json) =>
  compareSignatures(signatureOf(before), signatureOf(after)).filter((difference) => difference.breaking).map((difference) => difference.change)

describe("compareSignatures", () => {
  it("passes an answer that only gained a field", () => {
    expect(breaking({ id: 1 }, { id: 1, name: "Squat" })).toEqual([])
  })

  it("fails an answer that lost a field, at any depth", () => {
    expect(breaking([{ id: 1, sets: [{ reps: 5 }] }], [{ id: 1, sets: [{}] }])).toEqual(["was removed"])
  })

  it("fails a value that can now be null or a different kind", () => {
    expect(breaking({ weight: 60 }, { weight: null })).toEqual(["can now be null"])
    expect(breaking({ weight: 60 }, { weight: "60" })).toEqual(["can now be string"])
  })

  it("passes a value that was only ever seen as null and now holds something", () => {
    expect(breaking({ activeWorkout: null }, { activeWorkout: { id: 3 } })).toEqual([])
  })

  it("merges every item of an array, so a field only some items have reads as possibly null", () => {
    expect(signatureOf([{ rpe: 8 }, {}])).toEqual({ array: true, items: { fields: { rpe: { kinds: ["null", "number"] } } } })
  })
})
