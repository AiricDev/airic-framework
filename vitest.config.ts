import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    "include": ["packages/**/test/**/*.test.{ts,tsx}", "templates/**/test/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
