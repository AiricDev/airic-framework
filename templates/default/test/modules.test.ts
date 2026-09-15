import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ModuleRegistry } from "@airic/framework";
import { DirectoryModuleSource } from "@airic/storage-files";
import { assertServiceImport } from "../src/app/server-modules.js";

describe("application modules", () => {
  it("loads every declared module and WorkType package", async () => {
    const source = new DirectoryModuleSource(resolve(import.meta.dirname, "..", "src/modules"), { gitRoot: process.cwd() });
    const registry = new ModuleRegistry(source); await registry.load();
    const refs = registry.list().flatMap((module) => module.workTypes.map((workType) => ({ moduleId: module.id, workTypeId: workType.id })));
    expect(refs).toEqual(expect.arrayContaining([{ moduleId: "cases", workTypeId: "case-assistance" }, { moduleId: "development", workTypeId: "module-smith" }, { moduleId: "development", workTypeId: "reflection" }]));
    const { loadWorkDefinition } = await import("@airic/framework");
    for (const ref of refs) { const packagePath = registry.manifest(ref.moduleId).workTypes.find((item) => item.id === ref.workTypeId)!.path; const exported = await source.exportFiles({ ...ref, packagePath }); expect((await loadWorkDefinition({ target: ref, ref: { revisionId: `working:${exported.digest.slice(0, 12)}`, contentDigest: exported.digest }, manifest: exported.files["work.yml"]!, documents: Object.entries(exported.files).map(([path, content]) => ({ path, content, digest: content })) })).manifest.id).toBe(ref.workTypeId); }
  });

  it("rejects services from modules that were not declared as Domain imports", () => {
    const manifest: import("@airic/framework").ModuleManifest = {
      schemaVersion: 1, id: "consumer", title: "Consumer", description: "Test consumer",
      imports: { domains: [{ moduleId: "provider", release: "1.*", capabilities: [], schemas: [], references: [] }] },
      workTypes: [], contributions: {},
    };
    expect(() => assertServiceImport(manifest, "provider")).not.toThrow();
    expect(() => assertServiceImport(manifest, "hidden")).toThrow("undeclared service provider hidden");
  });
});
