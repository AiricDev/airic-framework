#!/usr/bin/env node
import { execFile } from "node:child_process";
import { cp, mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const requested = process.argv[2];
if (!requested || requested === "--help" || requested === "-h") {
  console.log("Usage: npm create airic@0.1.0 <directory>");
  process.exit(requested ? 0 : 1);
}

try { await run("git", ["--version"]); }
catch { throw new Error("Git is required to create an Airic project. Install Git and try again."); }

const target = resolve(process.cwd(), requested);
await mkdir(target, { recursive: true });
if ((await readdir(target)).length) throw new Error(`Target directory is not empty: ${target}`);
await cp(resolve(import.meta.dirname, "template"), target, { recursive: true });
await rename(resolve(target, "gitignore.template"), resolve(target, ".gitignore"));

const name = basename(target).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
const packageJson = {
  name,
  version: "0.1.0",
  private: true,
  type: "module",
  engines: { node: ">=24" },
  scripts: {
    build: "tsc -p tsconfig.json && vite build",
    dev: "node --env-file-if-exists=.env --enable-source-maps dist/main.js",
    test: "vitest run",
    typecheck: "tsc -p tsconfig.json --noEmit",
  },
  dependencies: {
    "@airic/client": "0.1.0",
    "@airic/framework": "0.1.0",
    "@airic/harness-pi": "0.1.0",
    "@airic/server": "0.1.0",
    "@airic/storage-files": "0.1.0",
    "@airic/ui": "0.1.0",
    "react": "19.1.1",
    "react-dom": "19.1.1",
    "react-router": "7.18.3"
  },
  devDependencies: {
    "@types/node": "24.3.0",
    "@types/react": "19.1.10",
    "@types/react-dom": "19.1.7",
    "@playwright/test": "1.55.0",
    "@vitejs/plugin-react": "5.0.2",
    "typescript": "5.9.2",
    "vite": "7.1.4",
    "vitest": "3.2.4"
  }
};

const tsconfig = {
  compilerOptions: {
    target: "ES2023",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    jsx: "react-jsx",
    outDir: "dist",
    rootDir: "src"
  },
  include: ["src/**/*.ts", "src/**/*.tsx"]
};

await writeFile(resolve(target, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
await writeFile(resolve(target, "tsconfig.json"), `${JSON.stringify(tsconfig, null, 2)}\n`);
await run("git", ["init", "-b", "main"], { cwd: target });
await run("git", ["add", "--all"], { cwd: target });
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_NAME: "Airic Scaffold",
  GIT_AUTHOR_EMAIL: "scaffold@airic.local",
  GIT_COMMITTER_NAME: "Airic Scaffold",
  GIT_COMMITTER_EMAIL: "scaffold@airic.local",
};
await run("git", ["commit", "-m", "Initialize Airic application"], { cwd: target, env: gitEnvironment });
console.log(`Created ${name} in ${target}`);
console.log("Initialized Git on main with the Airic scaffold commit.");
console.log("Next: npm install && npm run build && npm run dev");
