import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// The browser tests run in Playwright's Docker image, whose browsers only work with the same version of
// playwright-core, which @e2e-dev/web pins. Bumping @e2e-dev/web can move it, and the image has to follow.
describe("the Playwright image", () => {
  const { dependencies } = JSON.parse(readFileSync("node_modules/@e2e-dev/web/package.json", "utf8"))
  const version: string = dependencies["playwright-core"]
  const users = [".github/workflows/ci.yml", ".github/workflows/update-screenshots.yml", "tools/e2e/screenshots.sh"]

  it("is pinned to an exact version of playwright-core", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it.each(users)("matches playwright-core in %s", (file) => {
    const tags = [...readFileSync(file, "utf8").matchAll(/mcr\.microsoft\.com\/playwright:v([\d.]+)-/g)].map((match) => match[1])

    expect(tags.length).toBeGreaterThan(0)
    expect(new Set(tags)).toEqual(new Set([version]))
  })
})
