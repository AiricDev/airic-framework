import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testData = join(mkdtempSync(join(tmpdir(), "airic-playwright-")), "data");

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "npm run dev --workspace @airic/template-default",
    url: "http://127.0.0.1:4173",
    env: { AIRIC_DATA_DIR: testData, AIRIC_HARNESS: "simulated" },
    reuseExistingServer: !process.env.CI,
  },
});
