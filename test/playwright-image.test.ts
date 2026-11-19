import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// The browser tests run in Playwright's Docker image, whose browsers only work with the same version of
// @playwright/test. A version bump has to move all of them together.
describe("the Playwright image", () => {
  const { devDependencies } = JSON.parse(readFileSync("package.json", "utf8"))
  const version: string = devDependencies["@playwright/test"]
  const users = [".github/workflows/ci.yml", ".github/workflows/update-screenshots.yml", "tools/e2e/screenshots.sh"]

  it("is pinned to an exact version of @playwright/test", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it.each(users)("matches @playwright/test in %s", (file) => {
    const tags = [...readFileSync(file, "utf8").matchAll(/mcr\.microsoft\.com\/playwright:v([\d.]+)-/g)].map((match) => match[1])

    expect(tags.length).toBeGreaterThan(0)
    expect(new Set(tags)).toEqual(new Set([version]))
  })
})
