import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
const root = new URL("..", import.meta.url).pathname; const modulesRoot = join(root, "src/modules"); const violations = [];
await walk(modulesRoot);
if (violations.length) { console.error(violations.join("\n")); process.exitCode = 1; } else console.log("Module architecture boundaries are intact.");
async function walk(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isDirectory()) await walk(path); else if (/\.(?:ts|tsx)$/u.test(entry.name)) inspect(path, await readFile(path, "utf8")); } }
function inspect(path, source) {
  const name = relative(root, path); const local = relative(modulesRoot, path); const [moduleId, layer] = local.split(sep);
  if (["domain", "application"].includes(layer) && /from ["'](?:@airic\/|node:|react)/u.test(source)) violations.push(`${name}: Domain and Application cannot depend on Airic, Node, or React`);
  if (layer === "domain" && /from ["']\.\.\/(?:application|experience|infrastructure)/u.test(source)) violations.push(`${name}: Domain dependency points outward`);
  if (layer === "application" && /from ["']\.\.\/(?:experience|infrastructure)/u.test(source)) violations.push(`${name}: Application depends on an adapter`);
  for (const match of source.matchAll(/from ["']([^"']+)["']/gu)) if (match[1].startsWith(".")) { const target = relative(modulesRoot, resolve(dirname(path), match[1])); const targetModule = target.split(sep)[0]; if (!target.startsWith("..") && targetModule && targetModule !== moduleId && !target.split(sep).includes("public")) violations.push(`${name}: cross-module import must target ${targetModule}/public`); }
}
