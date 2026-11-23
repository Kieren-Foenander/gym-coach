import { describe } from "@e2e-dev/web"
import { PLAN_TEMPLATES } from "../../src/domain/templates"
import { EXERCISE_STATES } from "../../src/domain/focus"
import { DAY_STATES } from "../../src/domain/test-ids"
import { expect, test, testIds } from "./support"

const template = PLAN_TEMPLATES[0]!
const firstExercise = template.plan.days[0]!.exercises[0]!.exercise
const secondExercise = template.plan.days[0]!.exercises[1]!.exercise

describe("a workout", { requires: ["browser"] }, () => {
  test("starts a plan, logs a set, finishes, and the day counts toward the streak", { tags: ["smoke"] }, async ({ screen }) => {
    await screen.getByTestId(testIds.nav.tab("plan")).tap()
    await screen.getByTestId(testIds.plan.template(template.id)).tap()
    // The templates go once the plan is saved; going to Today before that would find no plan.
    await expect(screen.getByTestId(testIds.plan.template(template.id))).toHaveCount(0)

    await screen.getByTestId(testIds.nav.tab("today")).tap()
    await screen.getByTestId(testIds.today.startNextWorkout).tap()

    const card = screen.getByTestId(testIds.workout.exercise(firstExercise))

    await card.getByTestId(testIds.workout.weight).getByTestId(testIds.stepper.input).fill("60")
    await card.getByTestId(testIds.workout.reps).getByTestId(testIds.stepper.input).fill("5")
    await card.getByTestId(testIds.workout.logSet).tap()
    await expect(card.getByTestId(testIds.workout.set(1))).toBeVisible()

    await screen.getByTestId(testIds.workout.finish).tap()
    await expect(screen.getByTestId(testIds.workout.summary)).toBeVisible()
    await expect(screen.getByTestId(testIds.workout.summarySets)).toHaveAttribute("data-value", "1")

    await screen.getByTestId(testIds.workout.done).tap()
    await expect(screen.getByTestId(testIds.today.workoutsThisWeek)).toHaveAttribute("data-value", "1")
    await expect(screen.getByTestId(testIds.today.weekDay(Date.now()))).toHaveAttribute("data-state", DAY_STATES.counted)

    await screen.getByTestId(testIds.today.weekCard).tap()
    await expect(screen.getByTestId(testIds.calendar.day(Date.now()))).toHaveAttribute("data-state", DAY_STATES.counted)
  })

  test("moves on past an unfinished exercise, corrects a set and cuts the rest short", async ({ screen }) => {
    await screen.getByTestId(testIds.nav.tab("plan")).tap()
    await screen.getByTestId(testIds.plan.template(template.id)).tap()
    await expect(screen.getByTestId(testIds.plan.template(template.id))).toHaveCount(0)
    await screen.getByTestId(testIds.nav.tab("today")).tap()
    await screen.getByTestId(testIds.today.startNextWorkout).tap()

    const first = screen.getByTestId(testIds.workout.exercise(firstExercise))
    const second = screen.getByTestId(testIds.workout.exercise(secondExercise))

    await first.getByTestId(testIds.workout.weight).getByTestId(testIds.stepper.input).fill("40")
    await first.getByTestId(testIds.workout.logSet).tap()
    await expect(first).toHaveAttribute("data-state", EXERCISE_STATES.current)

    // A set on the next exercise leaves the first one's other sets skipped.
    await second.getByTestId(testIds.workout.weight).getByTestId(testIds.stepper.input).fill("20")
    await second.getByTestId(testIds.workout.logSet).tap()
    await expect(first).toHaveAttribute("data-state", EXERCISE_STATES.skipped)
    await expect(second).toHaveAttribute("data-state", EXERCISE_STATES.current)

    const rest = screen.getByTestId(testIds.workout.rest)

    await expect(rest).toBeVisible()
    const before = Number(await rest.getAttribute("data-value"))

    await screen.getByTestId(testIds.workout.restLess).tap()
    await expect.poll(async () => Number(await rest.getAttribute("data-value"))).toBeLessThanOrEqual(before - 29)

    // Minimised, the timer keeps counting in a strip along the bottom, and a tap brings it back.
    await screen.getByTestId(testIds.workout.restMinimise).tap()
    await expect(rest).toHaveAttribute("data-state", "minimised")
    await expect(screen.getByTestId(testIds.workout.restLess)).not.toBeVisible()
    await screen.getByTestId(testIds.workout.restExpand).tap()
    await expect(rest).toHaveAttribute("data-state", "open")
    await expect(screen.getByTestId(testIds.workout.restLess)).toBeVisible()

    const set = second.getByTestId(testIds.workout.set(1))

    await set.getByTestId(testIds.workout.editSet).tap()
    await second.getByTestId(testIds.workout.reps).getByTestId(testIds.stepper.input).fill("3")
    await second.getByTestId(testIds.workout.addSetNote).tap()
    await second.getByTestId(testIds.workout.setNote).fill("Grip slipped")
    await second.getByTestId(testIds.workout.saveSet).tap()
    await expect(second.getByTestId(testIds.workout.saveSet)).toHaveCount(0)
    await expect(second.getByTestId(testIds.workout.set(1))).toBeVisible()
  })

  test("an open workout with nothing logged leaves no trace", async ({ screen }) => {
    await screen.getByTestId(testIds.today.startOpenWorkout).tap()
    await screen.getByTestId(testIds.workout.finish).tap()

    await expect(screen.getByTestId(testIds.today.weekCard)).toBeVisible()
    await expect(screen.getByTestId(testIds.today.workoutsThisWeek)).toHaveAttribute("data-value", "0")
  })
})
