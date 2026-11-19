import { PLAN_TEMPLATES } from "../src/domain/templates"
import { DAY_STATES } from "../src/domain/test-ids"
import { expect, test, testIds } from "./support"

const template = PLAN_TEMPLATES[0]!
const firstExercise = template.plan.days[0]!.exercises[0]!.exercise

test("starts a plan, logs a set, finishes, and the day shows as trained @smoke", async ({ page }) => {
  await page.getByTestId(testIds.nav.tab("plan")).click()
  await page.getByTestId(testIds.plan.template(template.id)).click()

  await page.getByTestId(testIds.nav.tab("today")).click()
  await page.getByTestId(testIds.today.startNextWorkout).click()

  const card = page.getByTestId(testIds.workout.exercise(firstExercise))

  await card.getByTestId(testIds.workout.weight).getByTestId(testIds.stepper.input).fill("60")
  await card.getByTestId(testIds.workout.reps).getByTestId(testIds.stepper.input).fill("5")
  await card.getByTestId(testIds.workout.logSet).click()
  await expect(card.getByTestId(testIds.workout.set(1))).toBeVisible()

  await page.getByTestId(testIds.workout.finish).click()
  await expect(page.getByTestId(testIds.workout.summary)).toBeVisible()
  await expect(page.getByTestId(testIds.workout.summarySets)).toHaveAttribute("data-value", "1")

  await page.getByTestId(testIds.workout.done).click()
  await expect(page.getByTestId(testIds.today.workoutsThisWeek)).toHaveAttribute("data-value", "1")
  await expect(page.getByTestId(testIds.today.weekDay(Date.now()))).toHaveAttribute("data-state", DAY_STATES.trained)

  await page.getByTestId(testIds.today.weekCard).click()
  await expect(page.getByTestId(testIds.calendar.day(Date.now()))).toHaveAttribute("data-state", DAY_STATES.trained)
})

test("an open workout with nothing logged leaves no trace", async ({ page }) => {
  await page.getByTestId(testIds.today.startOpenWorkout).click()
  await page.getByTestId(testIds.workout.finish).click()

  await expect(page.getByTestId(testIds.today.weekCard)).toBeVisible()
  await expect(page.getByTestId(testIds.today.workoutsThisWeek)).toHaveAttribute("data-value", "0")
})
