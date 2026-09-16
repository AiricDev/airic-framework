import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
await run("pnpm", ["run", "build"], { cwd: root });
await run("node", [resolve(root, "scripts/pack-all.mjs")], { cwd: root });
const artifacts = JSON.parse(await readFile(resolve(root, "artifacts/packs/manifest.json"), "utf8"));
const scratch = await mkdtemp(resolve(tmpdir(), "airic-packed-app-"));
const launcher = resolve(scratch, "launcher");
const app = resolve(scratch, "generated-app");
const missingGitApp = resolve(scratch, "missing-git-app");
await mkdir(launcher);
await writeFile(resolve(launcher, "package.json"), "{\"private\":true}\n");
// `pnpm add <tarball>` has no `--no-save`; it writes the installed package spec into the package.json. The launcher is throwaway, so this is fine.
await run("pnpm", ["add", artifacts["create-airic"]], { cwd: launcher });
try {
  await run(process.execPath, [resolve(launcher, "node_modules/create-airic/dist/index.js"), missingGitApp], { cwd: scratch, env: { ...process.env, PATH: "/airic-git-is-not-installed" } });
  throw new Error("create-airic unexpectedly succeeded without Git");
} catch (error) {
  const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  if (!output.includes("Git is required")) throw error;
  try { await access(missingGitApp); throw new Error("create-airic wrote files before the Git preflight"); }
  catch (accessError) { if (accessError.code !== "ENOENT") throw accessError; }
}
await run("node", [resolve(launcher, "node_modules/create-airic/dist/index.js"), app], { cwd: scratch });
if ((await run("git", ["branch", "--show-current"], { cwd: app })).stdout.trim() !== "main") throw new Error("Generated app did not initialize the main branch");
if ((await run("git", ["rev-list", "--count", "HEAD"], { cwd: app })).stdout.trim() !== "1") throw new Error("Generated app did not create exactly one scaffold commit");
if ((await run("git", ["log", "-1", "--format=%an <%ae>"], { cwd: app })).stdout.trim() !== "Airic Scaffold <scaffold@airic.local>") throw new Error("Generated app did not use the command-scoped scaffold identity");
let scaffoldIdentityWasPersisted = false;
try { scaffoldIdentityWasPersisted = Boolean((await run("git", ["config", "--local", "--get", "user.name"], { cwd: app })).stdout.trim()); }
catch (error) { if (error.code !== 1) throw error; }
if (scaffoldIdentityWasPersisted) throw new Error("Generated app persisted the scaffold identity in Git config");
if ((await run("git", ["status", "--porcelain"], { cwd: app })).stdout.trim()) throw new Error("Generated app working tree is not clean after creation");
for (const path of [".env", "models.json", "models-store.json", ".airic/runtime"]) await run("git", ["check-ignore", "-q", path], { cwd: app });
await access(resolve(app, "src/modules/development/operating/module-smith/work.yml"));
await access(resolve(app, "src/modules/development/operating/operating-model-smith/work.yml"));
await access(resolve(app, "src/modules/development/operating/reflection/work.yml"));
await access(resolve(app, "src/modules/cases/operating/case-assistance/work.yml"));
await access(resolve(app, "e2e/cases.spec.ts"));
const localPackages = {
  framework: "@airic/framework",
  "storage-files": "@airic/storage-files",
  "harness-pi": "@airic/harness-pi",
  server: "@airic/server",
  acp: "@airic/acp",
  ui: "@airic/ui",
  client: "@airic/client",
};
// Rewrite unpublished `@airic/*` specs to local tarballs in this throwaway acceptance app.
const appPackageJsonPath = resolve(app, "package.json");
const appPackageJson = JSON.parse(await readFile(appPackageJsonPath, "utf8"));
const overrides = {};
for (const [name, packageName] of Object.entries(localPackages)) {
  const spec = `file:${artifacts[name]}`;
  appPackageJson.dependencies[packageName] = spec;
  overrides[packageName] = spec;
}
appPackageJson.pnpm = { overrides };
await writeFile(appPackageJsonPath, `${JSON.stringify(appPackageJson, null, 2)}\n`);
await run("pnpm", ["install"], { cwd: app });
await run("pnpm", ["run", "build"], { cwd: app });
await run("pnpm", ["test"], { cwd: app });

const port = 43871;
// Start the generated entrypoint directly so the verifier owns the server process
// and can reliably wait for its shutdown (rather than relying on pnpm signal relay).
const child = spawn(process.execPath, ["--env-file-if-exists=.env", "--enable-source-maps", "dist/main.js"], { cwd: app, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
try {
  let healthy = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Generated app exited early:\n${output}`);
    try {
      const applicationHealth = await fetch(`http://127.0.0.1:${port}/api/app/health`);
      const airicHealth = await fetch(`http://127.0.0.1:${port}/api/airic/health`);
      healthy = applicationHealth.ok && airicHealth.ok;
    } catch {}
    if (healthy) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (!healthy) throw new Error(`Generated app did not become healthy:\n${output}`);
  console.log(`Packed application built, tested and started from ${scratch}`);
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 5_000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
