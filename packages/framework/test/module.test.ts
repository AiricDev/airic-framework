import { describe, expect, it } from "vitest";
import { ModuleRegistry, type DomainProvider } from "@airic/framework";
import { MemoryModuleSource } from "@airic/testing";

const emptySource = new MemoryModuleSource({}, {});
const provider: DomainProvider = {
  id: "shared-domain", moduleId: "shared", release: "1.0.0", buildId: "build-1",
  sourceBundle: { id: "shared-source", revision: "1", digest: "source-1" }, readme: { path: "public/architecture.md" },
  capabilities: [{ id: "shared.read", title: "Read", description: "Read shared state", kind: "query", source: { path: "public/index.ts" }, inputSchema: {}, outputSchema: {}, invoke: async () => ({}) }],
};

describe("ModuleRegistry", () => {
  it("resolves an Operating-only module that imports a Domain-only module", () => {
    const registry = new ModuleRegistry(emptySource);
    registry.registerManifest({ schemaVersion: 1, id: "shared", title: "Shared", imports: { domains: [] }, domain: { release: "1.0.0", exports: { capabilities: ["shared.read"], schemas: [{ id: "shared.record", path: "public/schema.json" }], references: [] } }, workTypes: [], contributions: {} });
    registry.registerManifest({ schemaVersion: 1, id: "consumer", title: "Consumer", imports: { domains: [{ moduleId: "shared", release: "1.*", capabilities: ["shared.read"], schemas: ["shared.record"], references: [] }] }, workTypes: [{ id: "inspect", path: "operating/inspect" }], contributions: {} });
    registry.registerDomain(provider);
    expect(registry.resolve({ moduleId: "consumer", workTypeId: "inspect" }).domains[0]).toMatchObject({ id: "shared-domain", capabilities: [{ id: "shared.read" }] });
  });

  it("rejects missing dependencies, duplicate identities, and cycles", async () => {
    const missingSource = new MemoryModuleSource({
      a: { manifest: { schemaVersion: 1, id: "a", title: "A", imports: { domains: [{ moduleId: "missing" }] } } },
    }, {});
    await expect(new ModuleRegistry(missingSource).load()).rejects.toThrow("imports missing module");

    const duplicate = new ModuleRegistry(emptySource);
    duplicate.registerManifest({ schemaVersion: 1, id: "a", title: "A" } as never);
    expect(() => duplicate.registerManifest({ schemaVersion: 1, id: "a", title: "Again" } as never)).toThrow("Duplicate module identity");

    const cyclicSource = new MemoryModuleSource({
      a: { manifest: { schemaVersion: 1, id: "a", title: "A", imports: { domains: [{ moduleId: "b" }] } } },
      b: { manifest: { schemaVersion: 1, id: "b", title: "B", imports: { domains: [{ moduleId: "a" }] } } },
    }, {});
    await expect(new ModuleRegistry(cyclicSource).load()).rejects.toThrow("Circular module dependency");
  });
});
