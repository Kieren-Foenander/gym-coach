import { describe } from "@e2e-dev/web"
import { expect, seededTest as test, seedHistory, testIds } from "./support"

describe("the history", { requires: ["browser"] }, () => {
  test("counts every workout, not only the latest it lists", async ({ screen }) => {
    await screen.getByTestId(testIds.nav.tab("history")).tap()

    await expect(screen.getByTestId(testIds.history.totalWorkouts)).toHaveAttribute("data-value", String(seedHistory.workouts.length))
  })
})
