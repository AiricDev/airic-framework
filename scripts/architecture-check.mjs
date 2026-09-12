import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const violations = [];
for (const base of [join(root, "packages"), join(root, "templates/default/src")]) await walk(base);
if (violations.length) { console.error(violations.join("\n")); process.exitCode = 1; } else console.log("Architecture boundaries are intact.");

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path); else if (/\.(?:ts|tsx)$/u.test(entry.name)) await inspect(path);
  }
}
async function inspect(path) {
  const source = await readFile(path, "utf8"); const name = relative(root, path);
  if (name.includes("packages/framework/src/domain/") && /from ["'](?:\.\.\/application|@airic\/)/u.test(source)) violations.push(`${name}: framework domain must not depend on application or adapters`);
  if (name.startsWith("packages/") && /(?:certreport|airic-report)/iu.test(source)) violations.push(`${name}: framework package contains an application dependency`);
  if (name.includes("packages/framework/") && /pi-coding-agent/u.test(source)) violations.push(`${name}: provider SDK leaked into framework core`);
  const moduleMatch = name.match(/templates\/default\/src\/modules\/([^/]+)\/(.+)$/u);
  if (!moduleMatch) return;
  const [, moduleId, local] = moduleMatch;
  if ((local.startsWith("domain/") || local.startsWith("application/")) && /from ["'](?:@airic\/|node:|react)/u.test(source)) violations.push(`${name}: Domain and Application cannot depend on Airic, Node, or React`);
  if (local.startsWith("domain/") && /from ["']\.\.\/(?:application|experience|infrastructure)/u.test(source)) violations.push(`${name}: Domain dependency points outward`);
  if (local.startsWith("application/") && /from ["']\.\.\/(?:experience|infrastructure)/u.test(source)) violations.push(`${name}: Application depends on an adapter`);
  for (const specifier of imports(source)) {
    if (!specifier.startsWith(".")) continue;
    const target = relative(join(root, "templates/default/src/modules"), resolve(dirname(path), specifier));
    const targetModule = target.split(sep)[0];
    if (!target.startsWith("..") && targetModule && targetModule !== moduleId && !target.split(sep).includes("public")) violations.push(`${name}: cross-module import must target ${targetModule}/public`);
  }
}
function imports(source) { return [...source.matchAll(/(?:from|import)\s*(?:\([^)]*?\)|["']([^"']+)["'])/gu)].map((match) => match[1]).filter(Boolean); }
