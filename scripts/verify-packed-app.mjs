import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
await run("node", [resolve(root, "scripts/pack-all.mjs")], { cwd: root });
const artifacts = JSON.parse(await readFile(resolve(root, "artifacts/packs/manifest.json"), "utf8"));
const scratch = await mkdtemp(resolve(tmpdir(), "airic-packed-app-"));
const launcher = resolve(scratch, "launcher");
const app = resolve(scratch, "generated-app");
await mkdir(launcher);
await writeFile(resolve(launcher, "package.json"), "{\"private\":true}\n");
await run("npm", ["install", "--package-lock=false", artifacts["create-airic"]], { cwd: launcher });
await run("node", [resolve(launcher, "node_modules/create-airic/dist/index.js"), app], { cwd: scratch });
const localPackages = ["framework", "storage-files", "harness-pi", "server", "ui"].map((name) => artifacts[name]);
await run("npm", ["install", "--package-lock=false", ...localPackages], { cwd: app });
await run("npm", ["run", "build"], { cwd: app });
await run("npm", ["test"], { cwd: app });

const port = 43871;
const child = spawn("npm", ["run", "dev"], { cwd: app, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
try {
  let healthy = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Generated app exited early:\n${output}`);
    try { const response = await fetch(`http://127.0.0.1:${port}/api/health`); healthy = response.ok; } catch {}
    if (healthy) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (!healthy) throw new Error(`Generated app did not become healthy:\n${output}`);
  console.log(`Packed application built, tested and started from ${scratch}`);
} finally {
  child.kill("SIGTERM");
  await new Promise((resolveExit) => child.once("exit", resolveExit));
}
