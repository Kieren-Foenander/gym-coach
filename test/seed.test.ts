import { readdirSync, readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { catalogByName, isCardio } from "~/domain/catalog"
import { exerciseNames, seedStatements, type History } from "../tools/seed/history"

const history: History = JSON.parse(readFileSync("seed/training-history.json", "utf8"))

const database = () => {
  const db = new DatabaseSync(":memory:")

  for (const file of readdirSync("migrations").toSorted()) db.exec(readFileSync(`migrations/${file}`, "utf8"))

  db.exec(`INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES
    ('me', 'me@example.com', '', 'Me', 0), ('other', 'other@example.com', '', 'Other', 0)`)

  return db
}

const load = (db: DatabaseSync, target: Parameters<typeof seedStatements>[1]) => {
  for (const statement of seedStatements(history, target)) db.exec(statement)
}

const total = (db: DatabaseSync, sql: string) => Number(Object.values(db.prepare(sql).get() ?? {})[0])

describe("the seed training history", () => {
  it("names only library exercises or ones it lists as its own", () => {
    for (const name of exerciseNames(history)) {
      expect(catalogByName(name) !== null || name in history.customExercises, name).toBe(true)
    }
  })

  it("has a duration for every cardio set and reps for every other set", () => {
    for (const exercise of history.workouts.flatMap((workout) => workout.exercises)) {
      for (const set of exercise.sets) {
        if (isCardio(exercise.name)) expect(set.durationSeconds).toBeGreaterThan(0)
        else expect(set.reps).toBeGreaterThanOrEqual(0)

        if (set.rpe !== undefined) expect(set.rpe).toBeGreaterThanOrEqual(6)
      }
    }
  })

  it("loads every workout and set into the account it is given, once", () => {
    const db = database()
    load(db, { email: "me@example.com" })
    load(db, { userId: "me" })

    const sets = history.workouts.reduce(
      (sum, workout) => sum + workout.exercises.reduce((inner, exercise) => inner + exercise.sets.length, 0),
      0,
    )

    expect(total(db, "SELECT COUNT(*) FROM workouts WHERE user_id = 'me'")).toBe(history.workouts.length)
    expect(total(db, "SELECT COUNT(*) FROM workout_sets")).toBe(sets)
    expect(total(db, "SELECT COUNT(*) FROM workouts WHERE user_id = 'other'")).toBe(0)
    expect(total(db, "SELECT COUNT(*) FROM workouts WHERE finished_at IS NULL")).toBe(0)
  })

  it("files each exercise under its muscle group", () => {
    const db = database()
    load(db, { userId: "me" })

    const group = (name: string) =>
      db.prepare("SELECT muscle_group FROM exercises WHERE user_id = 'me' AND name = ?").get(name)?.muscle_group

    expect(group("Incline Bench Press")).toBe("Chest")

    for (const [name, muscle] of Object.entries(history.customExercises)) expect(group(name)).toBe(muscle)
  })

  it("keeps an exercise the account already has as it is", () => {
    const db = database()
    db.exec("INSERT INTO exercises (user_id, name, muscle_group) VALUES ('me', 'Bench Press', 'Mine')")
    load(db, { userId: "me" })

    expect(db.prepare("SELECT muscle_group FROM exercises WHERE name = 'Bench Press'").get()?.muscle_group).toBe("Mine")
  })
})
