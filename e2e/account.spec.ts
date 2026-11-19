import { expect, signIn, test, testIds } from "./support"

test("signs in, and signs out from Settings @smoke", async ({ page, person }) => {
  await page.getByTestId(testIds.nav.tab("settings")).click()
  await page.getByTestId(testIds.settings.signOut).click()
  await expect(page.getByTestId(testIds.login.submit)).toBeVisible()

  await signIn(page, person)
})

test("keeps a changed name after a reload", async ({ page }) => {
  await page.getByTestId(testIds.nav.tab("settings")).click()
  await page.getByTestId(testIds.settings.displayName).fill("Renamed Tester")
  await page.getByTestId(testIds.settings.saveProfile).click()
  await expect(page.getByTestId(testIds.settings.saveProfile)).toBeEnabled()

  await page.reload()
  await expect(page.getByTestId(testIds.settings.displayName)).toHaveValue("Renamed Tester")
})
