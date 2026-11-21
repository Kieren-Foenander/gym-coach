/**
 * Loads a training history (by default seed/training-history.json) into one account.
 *
 *   bun tools/seed/load.ts --local --email you@example.com          the `bun run dev` database
 *   bun tools/seed/load.ts --database <d1-id> --user-id <id>         a deployed stage, through the cf CLI
 *
 * Sign up in the app first: this adds history to an account, it does not make one.
 * Running it twice adds nothing the second time. To take it back out:
 *   DELETE FROM workouts WHERE user_id = '<id>' AND notes = 'Imported from Gymverse.';
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { seedStatements, type History, type Target } from "./history"

const LOCAL_D1 = ".alchemy/local/d1/cloudflare-runtime-D1DatabaseObject"

// D1 refuses a statement over 100 KB; a batch of whole statements stays under this.
const BATCH_BYTES = 90_000

const { values } = parseArgs({
  options: {
    local: { type: "boolean", default: false },
    sqlite: { type: "string" },
    database: { type: "string" },
    email: { type: "string" },
    "user-id": { type: "string" },
    file: { type: "string", default: "seed/training-history.json" },
  },
})

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const target: Target = values["user-id"]
  ? { userId: values["user-id"] }
  : values.email
    ? { email: values.email }
    : fail("Say whose account: --email or --user-id")

const history: History = JSON.parse(readFileSync(values.file, "utf8"))
const statements = seedStatements(history, target)
const where = "userId" in target ? `id = '${target.userId}'` : `email = '${target.email.replaceAll("'", "''")}'`
const check = `SELECT unit FROM users WHERE ${where}`

const count = `SELECT COUNT(DISTINCT w.id) AS workouts, COUNT(s.id) AS sets FROM workouts w
LEFT JOIN workout_sets s ON s.workout_id = w.id WHERE w.user_id = (SELECT id FROM users WHERE ${where})`

const batches = statements.reduce<Array<Array<string>>>((all, statement) => {
  const last = all.at(-1)

  if (last && last.join("\n").length + statement.length < BATCH_BYTES) last.push(statement)
  else all.push([statement])

  return all
}, [])

const localFile = (): string => {
  if (values.sqlite) return values.sqlite

  const files = readdirSync(LOCAL_D1).filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")

  if (files.length !== 1) fail(`Found ${files.length} local databases in ${LOCAL_D1}. Pick one with --sqlite <file>.`)

  return join(LOCAL_D1, files[0]!)
}

/** The columns the checks below read. Every statement that changes data returns no rows. */
interface Row {
  readonly unit?: string
  readonly workouts?: number
  readonly sets?: number
}

const run = (sql: string): ReadonlyArray<Row> => {
  if (values.local) {
    const out = execFileSync("sqlite3", ["-json", localFile()], { input: sql, encoding: "utf8", maxBuffer: 1 << 26 })

    return out.trim() === "" ? [] : JSON.parse(out)
  }

  if (!values.database) return fail("Say which database: --local, or --database <d1-id>")

  const out = execFileSync("cf", ["d1", "query", values.database, "--sql", sql], { encoding: "utf8", maxBuffer: 1 << 26 })
  const results: ReadonlyArray<{ results: ReadonlyArray<Row> }> = JSON.parse(out)

  return results.at(-1)?.results ?? []
}

const unit = run(check)[0]?.unit

if (unit === undefined) fail("No account matches. Sign up in the app first.")

if (unit !== history.unit) fail(`The account uses ${unit} but the history is in ${history.unit}.`)

console.log("Before:", run(count)[0])

for (const [index, batch] of batches.entries()) {
  run(values.local ? `BEGIN;\n${batch.join("\n")}\nCOMMIT;` : batch.join("\n"))
  process.stdout.write(`\rBatch ${index + 1} of ${batches.length}`)
}

console.log("\nAfter:", run(count)[0])
