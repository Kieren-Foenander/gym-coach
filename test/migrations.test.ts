import { readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"

// Alchemy applies migrations/ in name order on every deploy, and D1 remembers which ran. CI checks
// that a pull request only adds files (tools/check-migrations.ts); this checks how they are named.
describe("migrations", () => {
  const files = readdirSync("migrations").toSorted()

  it("are numbered 0001, 0002, ... with no gaps or repeats", () => {
    expect(files.map((file) => file.slice(0, 4))).toEqual(files.map((_, index) => String(index + 1).padStart(4, "0")))
  })

  it("are named like 0008_what_it_does.sql", () => {
    for (const file of files) expect(file).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/)
  })
})
