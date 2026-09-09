import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(import.meta.dirname, "../../../templates/default");
const target = resolve(import.meta.dirname, "../dist/template");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const entry of ["src", "test", "work-definitions", "index.html", "vite.config.ts", "README.md", "AGENTS.md", ".gitignore"]) {
  await cp(resolve(source, entry), resolve(target, entry), { recursive: true });
}
