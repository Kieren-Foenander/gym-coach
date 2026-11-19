/**
 * Fails when a change edits, renames or deletes a migration that is already on the base branch.
 * Deployed databases have run those, so changing one never reaches them: add a new migration instead.
 *
 *   bun tools/check-migrations.ts origin/master
 */
import { execFileSync } from "node:child_process"

const base = process.argv[2] ?? "origin/master"

const changed = execFileSync("git", ["diff", "--name-status", "--diff-filter=MDRT", `${base}...HEAD`, "--", "migrations"], {
  encoding: "utf8",
}).trim()

if (changed) {
  console.error(`These migrations are already on ${base} and must not change:\n${changed}\nAdd a new migration instead.`)
  process.exit(1)
}

console.log(`Migrations: only additions since ${base}.`)
