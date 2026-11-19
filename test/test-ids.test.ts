import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { Predicate } from "effect"
import { describe, expect, it } from "vitest"
import { testIds } from "~/domain/test-ids"

/**
 * The rules for test ids (CLAUDE.md, "Test ids"), checked so they cannot drift:
 *
 *   - every id has the format `<screen>.<element>`, with `:<key>` for one of many;
 *   - screens take ids from src/domain/test-ids.ts, never a string written in place;
 *   - browser tests find elements by test id only, and read `data-state` and `data-value` rather than words.
 */

const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)+$/
const KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/

type Sample = number | string | { readonly activity: string; readonly period: string; readonly target: number }

const SAMPLES: ReadonlyArray<Sample> = [1, "sample name", { activity: "walking", period: "day", target: 1 }]

type Entry = string | ((key: never) => string) | { readonly [name: string]: Entry }

/** Every id in the registry, with a keyed id given a sample key. */
const allIds = (entry: Entry, path: string): ReadonlyArray<{ readonly path: string; readonly id: string; readonly keyed: boolean }> => {
  if (Predicate.isString(entry)) return [{ path, id: entry, keyed: false }]

  if (Predicate.isFunction(entry)) {
    // SAFETY: a keyed id takes a key (a string or a number), a time (a number), or a goal or a
    // frequency (an object with a period). Use the first sample it makes a well-formed key from.
    const make = entry as (key: Sample) => string
    const made = SAMPLES.flatMap((key) => {
      try {
        return [make(key)]
      } catch {
        return []
      }
    })

    return [{ path, id: made.find((id) => KEY.test(id.split(":")[1] ?? "")) ?? made[0] ?? "", keyed: true }]
  }

  return Object.entries(entry).flatMap(([name, child]) => allIds(child, `${path}.${name}`))
}

const files = (directory: string, pattern: RegExp): ReadonlyArray<string> =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)

    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path, pattern)

    return pattern.test(name) ? [path] : []
  })

const offending = (paths: ReadonlyArray<string>, rule: RegExp) =>
  paths.flatMap((path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .flatMap((line, index) => (rule.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : [])),
  )

describe("the test id registry", () => {
  const ids = allIds(testIds, "testIds")

  it("names every id <screen>.<element>, in lower-case words joined by hyphens", () => {
    for (const { path, id, keyed } of ids) {
      const [base, key, ...rest] = id.split(":")

      expect(base, path).toMatch(ID)
      expect(rest, path).toEqual([])

      if (keyed) expect(key, path).toMatch(KEY)
      else expect(key, path).toBeUndefined()
    }
  })

  it("uses every id once", () => {
    const bases = ids.map(({ id }) => id.split(":")[0])

    expect(bases.length).toBe(new Set(bases).size)
  })

  it("starts each id with the screen or component it is listed under", () => {
    for (const { path, id } of ids) {
      const group = path.split(".")[1]!.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

      expect(id.startsWith(`${group}.`), `${path} is "${id}"`).toBe(true)
    }
  })
})

describe("screens", () => {
  const screens = [
    ...files("src/routes", /\.tsx$/),
    ...files("src/components", /\.tsx$/),
    ...files("apps/mobile/src", /\.tsx$/),
  ]

  it("take test ids from src/domain/test-ids.ts, never a string written in place", () => {
    expect(offending(screens, /(data-testid|testID)=("|'|\{\s*["'`])/)).toEqual([])
  })
})

describe("browser tests", () => {
  const specs = files("e2e", /\.ts$/)

  it("find elements by test id only", () => {
    expect(
      offending(
        specs,
        /\b(getByText|getByRole|getByLabel|getByPlaceholder|getByAltText|getByTitle|locator|\$\$?)\s*\(|xpath=|:has-text|text=/,
      ),
    ).toEqual([])
  })

  it("take test ids from src/domain/test-ids.ts, never a string written in place", () => {
    expect(offending(specs, /getByTestId\(\s*["'`]/)).toEqual([])
  })

  it("check values and states, not the words on screen", () => {
    expect(offending(specs, /\b(toHaveText|toContainText|innerText|textContent|allTextContents|allInnerTexts)\b/)).toEqual([])
  })
})
