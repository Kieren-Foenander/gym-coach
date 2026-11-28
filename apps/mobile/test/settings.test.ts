import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { SETTINGS_PAGES } from "~/domain/settings"

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")

// The menu is a component, so this reads the source: every page it lists must open a screen
// that the app's stack actually registers, or the row would do nothing when tapped.
describe("the Settings menu in the native app", () => {
  const menu = read("../src/features/settings/SettingsScreen.tsx")
  const navigation = read("../src/navigation.tsx")

  it("opens a registered screen for every page", () => {
    for (const page of SETTINGS_PAGES) {
      const screen = new RegExp(`\\b${page}: "(\\w+)"`).exec(menu)?.[1]

      expect(screen, page).toBeDefined()
      expect(navigation).toContain(`<AppStack.Screen name="${screen}"`)
    }
  })
})
