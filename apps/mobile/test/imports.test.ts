import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const source = fileURLToPath(new URL("../src", import.meta.url))

const files = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(directory, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(directory, entry.name)] : [],
  )

// The shared files that pull in the server's libraries. The app may use their types, which vanish
// when it is built, but importing a value from them would bundle server code into the phone app.
const SERVER_SIDE = /from "~\/(server\/[^"]+|domain\/schema|domain\/calls)"/

describe("what the app shares with the server", () => {
  it("only ever imports types from server-side files", () => {
    const offenders = files(source).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => SERVER_SIDE.test(line) && !line.startsWith("import type "))
        .map((line) => `${file}: ${line}`),
    )

    expect(offenders).toEqual([])
  })
})
