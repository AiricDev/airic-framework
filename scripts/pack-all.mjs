import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, "artifacts/packs");
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
const packages = ["framework", "client", "storage-files", "testing", "harness-pi", "server", "ui", "create-airic"];
const artifacts = {};
for (const name of packages) {
  const directory = resolve(root, `packages/${name}`);
  // `pnpm pack --json` emits a single object with an absolute `filename` (unlike npm's array of `{ filename }`).
  const { stdout } = await run("pnpm", ["pack", "--json", "--pack-destination", destination], { cwd: directory });
  const result = JSON.parse(stdout);
  artifacts[name] = result.filename;
}
await writeFile(resolve(destination, "manifest.json"), `${JSON.stringify(artifacts, null, 2)}\n`);
console.log(`Packed ${packages.length} public packages in ${destination}`);
