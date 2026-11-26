import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"

/**
 * 0011 follows 0010 on a database that already ran 0010 (a preview that deployed it), including
 * one where a nudge was answered more than once before the index that stops that.
 */

const migration = (prefix: string) => {
  const file = readdirSync("migrations").find((name) => name.startsWith(prefix))!

  return readFileSync(join("migrations", file), "utf8")
}

const upTo = (database: DatabaseSync, last: number) => {
  for (const file of readdirSync("migrations").toSorted()) {
    if (Number(file.slice(0, 4)) <= last) database.exec(readFileSync(join("migrations", file), "utf8"))
  }
}

describe("0011 after 0010", () => {
  it("keeps the first answer to a nudge answered twice, and then lets no nudge be answered twice", () => {
    const database = new DatabaseSync(":memory:")

    upTo(database, 10)
    database.exec(`
      INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES ('u1', 'a@example.com', 'x', 'A', 0);
      INSERT INTO mini_nudges (id, user_id, day, exercise, unit, amount, sent_at) VALUES (1, 'u1', '2026-11-26', 'Push-Up', 'reps', 25, 0);
      INSERT INTO mini_sets (id, user_id, day, exercise, unit, amount, nudge_id, created_at) VALUES
        (1, 'u1', '2026-11-26', 'Push-Up', 'reps', 25, 1, 0),
        (2, 'u1', '2026-11-26', 'Push-Up', 'reps', 25, 1, 0);`)

    database.exec(migration("0011"))

    expect(database.prepare("SELECT id, nudge_id FROM mini_sets ORDER BY id").all()).toEqual([
      { id: 1, nudge_id: 1 },
      { id: 2, nudge_id: null },
    ])
    expect(() =>
      database.exec(`INSERT INTO mini_sets (user_id, day, exercise, unit, amount, nudge_id, created_at)
        VALUES ('u1', '2026-11-26', 'Push-Up', 'reps', 25, 1, 0)`),
    ).toThrow()
    expect(database.prepare("SELECT mini_revision, push_tested_at FROM users").get()).toEqual({ mini_revision: 0, push_tested_at: null })
  })
})
