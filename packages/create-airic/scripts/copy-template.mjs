import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(import.meta.dirname, "../../../templates/default");
const target = resolve(import.meta.dirname, "../dist/template");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const entry of ["src", "test", "e2e", "work-definitions", "index.html", "vite.config.ts", "playwright.config.ts", "README.md", "AGENTS.md", "architecture-map.md", ".env.example", "models.example.json"]) {
  await cp(resolve(source, entry), resolve(target, entry), { recursive: true });
}
// npm excludes nested .gitignore files from published packages, so carry it
// under a neutral name and restore it in the generator.
await cp(resolve(source, ".gitignore"), resolve(target, "gitignore.template"));
