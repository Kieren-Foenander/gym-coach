import { expect, type Screen } from "e2e"
import { testIds } from "../../src/domain/test-ids"

/** Pages the calendar back until it shows `month` (YYYY-MM), at most three years. */
export const showMonth = async (screen: Screen, month: string) => {
  const shown = screen.getByTestId(testIds.calendar.month)

  for (let step = 0; step < 36 && (await shown.getAttribute("data-value")) !== month; step++) {
    await screen.getByTestId(testIds.calendar.previousMonth).tap()
  }

  await expect(shown).toHaveAttribute("data-value", month)
}
