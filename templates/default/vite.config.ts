import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: "dist/public", emptyOutDir: false },
  test: { include: ["test/**/*.test.{ts,tsx}", "src/modules/**/tests/**/*.test.{ts,tsx}"] },
});
