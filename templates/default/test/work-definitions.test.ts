import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadWorkDefinition } from "@airic/framework";
import { DirectoryDefinitionSource } from "@airic/storage-files";
import { describe, expect, it } from "vitest";

describe("project operating model", () => {
  it("loads every Work Definition from the authoritative directory", async () => {
    const root = resolve(import.meta.dirname, "..", "work-definitions");
    const source = new DirectoryDefinitionSource(root, { gitRoot: process.cwd() });
    const ids = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const definitions = await Promise.all(ids.map((id) => loadWorkDefinition(source, id)));
    expect(definitions.map((definition) => definition.manifest.id).sort()).toEqual(ids.sort());
    expect(definitions.every((definition) => definition.digest.length === 64)).toBe(true);
  });
});
