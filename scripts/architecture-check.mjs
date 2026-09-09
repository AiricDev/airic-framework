import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const violations = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) await inspect(path);
  }
}

async function inspect(path) {
  const source = await readFile(path, "utf8");
  const name = relative(root, path);
  if (name.includes("packages/framework/src/domain/") && /from ["'](?:\.\.\/application|@airic\/)/.test(source)) {
    violations.push(`${name}: framework domain must not depend on application or adapters`);
  }
  if (name.includes("templates/default/src/domain/") && /from ["']@airic\//.test(source)) {
    violations.push(`${name}: application domain must not depend on Airic`);
  }
  if (name.startsWith("packages/") && /(?:certreport|airic-report)/i.test(source)) {
    violations.push(`${name}: framework package contains an application dependency`);
  }
  if (name.includes("packages/framework/") && /pi-coding-agent/.test(source)) {
    violations.push(`${name}: provider SDK leaked into framework core`);
  }
}

await walk(join(root, "packages"));
await walk(join(root, "templates/default/src"));
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Architecture boundaries are intact.");
}
