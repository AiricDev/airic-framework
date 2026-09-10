import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testData = join(mkdtempSync(join(tmpdir(), "airic-template-playwright-")), "data");

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:4199" },
  webServer: {
    command: "pnpm run build && pnpm run dev",
    url: "http://127.0.0.1:4199/api/app/health",
    cwd: import.meta.dirname,
    env: { AIRIC_DATA_DIR: testData, AIRIC_HARNESS: "simulated", PORT: "4199" },
    reuseExistingServer: !process.env.CI,
  },
});
