import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Tests cover the plain logic only, so they run without a phone or the React Native runtime.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "~": fileURLToPath(new URL("../../src", import.meta.url)),
    },
  },
  test: { include: ["test/**/*.test.ts"] },
})
