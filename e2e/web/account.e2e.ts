import { describe } from "@e2e-dev/web"
import { SAVE_STATES } from "../../src/domain/test-ids"
import { expect, signIn, test, testIds } from "./support"

describe("the account", { requires: ["browser"] }, () => {
  test("signs in, and signs out from Settings", { tags: ["smoke"] }, async ({ app, screen, person }) => {
    await screen.getByTestId(testIds.nav.tab("settings")).tap()
    await screen.getByTestId(testIds.settings.signOut).tap()
    await expect(screen.getByTestId(testIds.login.submit)).toBeVisible()

    await signIn({ app, screen }, person)
  })

  test("keeps a changed name after a reload", async ({ browser, screen }) => {
    await screen.getByTestId(testIds.nav.tab("settings")).tap()
    await screen.getByTestId(testIds.settings.page("profile")).tap()
    await screen.getByTestId(testIds.settings.displayName).fill("Renamed Tester")
    await screen.getByTestId(testIds.settings.saveProfile).tap()
    // Reload only once the server has the new name.
    await expect(screen.getByTestId(testIds.settings.saveProfile)).toHaveAttribute("data-state", SAVE_STATES.saved)

    await browser.reload()
    await expect(screen.getByTestId(testIds.settings.displayName)).toHaveValue("Renamed Tester")
  })
})
