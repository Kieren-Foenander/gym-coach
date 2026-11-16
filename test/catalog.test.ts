import { describe, expect, it } from "vitest"
import { CATALOG, catalogByName, catalogBySlug, mergeLibrary, muscleGroupFor, searchLibrary } from "~/domain/catalog"
import { RENDERED_SLUGS } from "~/domain/demos"
import { PLAN_TEMPLATES } from "~/domain/templates"

const names = (text: string) => searchLibrary(mergeLibrary([]), text).map((item) => item.name)

describe("the exercise library", () => {
  it("has no two exercises with the same name or slug", () => {
    expect(new Set(CATALOG.map((entry) => entry.name.toLowerCase())).size).toBe(CATALOG.length)
    expect(new Set(CATALOG.map((entry) => entry.slug)).size).toBe(CATALOG.length)
  })

  it("gives every exercise a primary muscle, a name that fits the database and a slug safe for a file name", () => {
    for (const entry of CATALOG) {
      expect(entry.primary.length, entry.name).toBeGreaterThan(0)
      expect(entry.name.length, entry.name).toBeLessThanOrEqual(80)
      expect(entry.slug, entry.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it("never lists a muscle as both primary and secondary", () => {
    for (const entry of CATALOG) {
      expect(entry.secondary.filter((muscle) => entry.primary.includes(muscle)), entry.name).toEqual([])
    }
  })

  it("does not use one exercise's name as another's alias", () => {
    for (const entry of CATALOG) {
      expect(entry.aliases.filter((alias) => catalogByName(alias) !== null), entry.name).toEqual([])
    }
  })

  it("knows every exercise in the starter plans", () => {
    const planned = PLAN_TEMPLATES.flatMap((template) => template.plan.days.flatMap((day) => day.exercises))

    expect(planned.filter((item) => catalogByName(item.exercise) === null).map((item) => item.exercise)).toEqual([])
  })

  it("has an entry for every rendered demonstration", () => {
    expect(RENDERED_SLUGS.filter((slug) => catalogBySlug(slug) === null)).toEqual([])
  })

  it("finds an exercise by name whatever the case", () => {
    expect(catalogByName("  bench press ")?.slug).toBe("bench-press")
    expect(catalogByName("Made Up Lift")).toBeNull()
  })

  it("files a known exercise under its first primary muscle and leaves others as stored", () => {
    expect(muscleGroupFor("squat", "Legs")).toBe("Quads")
    expect(muscleGroupFor("Made Up Lift", "Legs")).toBe("Legs")
  })
})

describe("searchLibrary", () => {
  it("puts an exact name first, then names that start with the words typed", () => {
    expect(names("squat")[0]).toBe("Squat")
    expect(names("leg c")[0]).toBe("Leg Curl")
  })

  it("matches words in any order and ignores hyphens and apostrophes", () => {
    expect(names("press incline dumbbell")).toContain("Incline Dumbbell Press")
    expect(names("pull up")).toContain("Pull-Up")
    expect(names("farmers")).toContain("Farmer's Carry")
  })

  it("finds exercises by another name they go by", () => {
    expect(names("rdl")[0]).toBe("Romanian Deadlift")
    expect(names("pullup")[0]).toBe("Pull-Up")
    expect(names("skullcrusher")).toContain("Skull Crusher")
  })

  it("finds exercises by equipment and muscle together", () => {
    const found = names("cable biceps")

    expect(found).toContain("Cable Curl")
    expect(found).not.toContain("Barbell Curl")
  })

  it("returns nothing when a word matches nowhere", () => {
    expect(names("squat zzz")).toEqual([])
  })

  it("includes the user's own exercises and marks library ones they have used", () => {
    const items = mergeLibrary([
      { id: 1, name: "Sandbag Carry", muscleGroup: "Core", lastPerformedAt: null },
      { id: 2, name: "bench press", muscleGroup: "Chest", lastPerformedAt: 5 },
    ])

    expect(searchLibrary(items, "sandbag").map((item) => item.known?.id)).toEqual([1])
    expect(items.find((item) => item.name === "Bench Press")?.known?.id).toBe(2)
    expect(items.filter((item) => item.name.toLowerCase() === "bench press")).toHaveLength(1)
  })
})
