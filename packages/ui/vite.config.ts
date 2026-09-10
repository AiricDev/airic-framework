import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({ plugins: [react()], build: { outDir: resolve(import.meta.dirname, "dist"), emptyOutDir: false, lib: { entry: resolve(import.meta.dirname, "src/index.ts"), formats: ["es"], fileName: "airic-ui", cssFileName: "style" }, rollupOptions: { external: ["@airic/client", "react", "react-dom", "react/jsx-runtime"] } } });
