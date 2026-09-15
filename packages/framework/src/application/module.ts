import { z } from "zod";
import YAML from "yaml";
import type { DomainProvider } from "../integration/contracts.js";
import type { WorkTypeRef } from "../domain/work.js";
import type { ModuleSource } from "./ports.js";

const domainImportSchema = z.object({
  moduleId: z.string().min(1),
  release: z.string().min(1).default("*"),
  capabilities: z.array(z.string()).default([]),
  schemas: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
});

const publicItemSchema = z.object({ id: z.string().min(1), path: z.string().min(1) });
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  imports: z.object({ domains: z.array(domainImportSchema).default([]) }).default({ domains: [] }),
  domain: z.object({
    release: z.string().min(1),
    exports: z.object({
      capabilities: z.array(z.string()).default([]),
      schemas: z.array(publicItemSchema).default([]),
      references: z.array(publicItemSchema).default([]),
    }).default({ capabilities: [], schemas: [], references: [] }),
  }).optional(),
  workTypes: z.array(z.object({ id: z.string().min(1), path: z.string().min(1) })).default([]),
  contributions: z.object({ server: z.string().min(1).optional(), browser: z.string().min(1).optional() }).default({}),
});

export type ModuleManifest = z.infer<typeof manifestSchema>;

export interface ResolvedWorkType {
  ref: WorkTypeRef;
  module: ModuleManifest;
  packagePath: string;
  domains: readonly DomainProvider[];
}

/** Application-owned module registry. Imports describe availability; a WorkType allowlist still grants execution. */
export class ModuleRegistry {
  readonly #manifests = new Map<string, ModuleManifest>();
  readonly #providers = new Map<string, DomainProvider>();
  constructor(readonly source: ModuleSource) {}

  async load(moduleIds?: readonly string[]): Promise<void> {
    const ids = moduleIds ?? await this.source.listModules();
    for (const id of ids) {
      const raw = await this.source.readModuleManifest(id);
      const manifest = manifestSchema.parse(typeof raw === "string" ? YAML.parse(raw) : raw);
      if (manifest.id !== id) throw new Error(`Module id mismatch: expected ${id}, got ${manifest.id}`);
      this.registerManifest(manifest);
    }
    this.#validateGraph();
  }

  registerManifest(value: ModuleManifest): void {
    const manifest = manifestSchema.parse(value);
    if (this.#manifests.has(manifest.id)) throw new Error(`Duplicate module identity: ${manifest.id}`);
    validateLocalPaths(manifest);
    this.#manifests.set(manifest.id, manifest);
  }

  registerDomain(provider: DomainProvider): void {
    const manifest = this.#manifests.get(provider.moduleId);
    if (!manifest?.domain) throw new Error(`Module ${provider.moduleId} does not declare a Domain provider`);
    if (manifest.domain.release !== provider.release) throw new Error(`Domain release mismatch for ${provider.moduleId}: ${provider.release} != ${manifest.domain.release}`);
    const current = this.#providers.get(provider.moduleId);
    if (current) throw new Error(`Duplicate Domain provider for module ${provider.moduleId}`);
    if ([...this.#providers.values()].some((item) => item.id === provider.id)) throw new Error(`Duplicate Domain identity: ${provider.id}`);
    const capabilityIds = new Set(provider.capabilities.map((item) => item.id));
    for (const id of manifest.domain.exports.capabilities) if (!capabilityIds.has(id)) throw new Error(`Module ${provider.moduleId} does not provide exported capability ${id}`);
    for (const capability of provider.capabilities) if (capability.kind === "command" && !provider.inspectCommand) throw new Error(`Command capability ${capability.id} requires inspectCommand`);
    this.#providers.set(provider.moduleId, provider);
  }

  list(): readonly ModuleManifest[] { return [...this.#manifests.values()]; }
  manifest(moduleId: string): ModuleManifest { return this.#manifests.get(moduleId) ?? fail(`Unknown module ${moduleId}`); }
  domainById(id: string): DomainProvider | undefined { return [...this.#providers.values()].find((provider) => provider.id === id); }

  resolve(ref: WorkTypeRef): ResolvedWorkType {
    const module = this.manifest(ref.moduleId);
    const workType = module.workTypes.find((item) => item.id === ref.workTypeId) ?? fail(`Unknown WorkType ${ref.moduleId}/${ref.workTypeId}`);
    const domains: DomainProvider[] = [];
    if (module.domain && !this.#providers.has(module.id)) throw new Error(`Domain provider is not registered for module ${module.id}`);
    const localProvider = this.#providers.get(module.id);
    if (localProvider && module.domain) domains.push(withCapabilities(localProvider, module.domain.exports.capabilities));
    for (const dependency of module.imports.domains) {
      const target = this.manifest(dependency.moduleId);
      if (!target.domain) throw new Error(`Imported module ${dependency.moduleId} has no Domain export`);
      if (!releaseMatches(target.domain.release, dependency.release)) throw new Error(`Module ${module.id} requires ${dependency.moduleId}@${dependency.release}, got ${target.domain.release}`);
      const provider = this.#providers.get(dependency.moduleId) ?? fail(`Domain provider is not registered for imported module ${dependency.moduleId}`);
      const exported = new Set(target.domain.exports.capabilities);
      for (const capability of dependency.capabilities) if (!exported.has(capability)) throw new Error(`Module ${module.id} imports non-exported capability ${capability}`);
      const schemas = new Set(target.domain.exports.schemas.map((item) => item.id));
      for (const schema of dependency.schemas) if (!schemas.has(schema)) throw new Error(`Module ${module.id} imports non-exported schema ${schema}`);
      const references = new Set(target.domain.exports.references.map((item) => item.id));
      for (const reference of dependency.references) if (!references.has(reference)) throw new Error(`Module ${module.id} imports non-exported reference ${reference}`);
      domains.push(withCapabilities(provider, dependency.capabilities));
    }
    return { ref, module, packagePath: workType.path, domains };
  }

  #validateGraph(): void {
    for (const manifest of this.#manifests.values()) for (const dependency of manifest.imports.domains) if (!this.#manifests.has(dependency.moduleId)) throw new Error(`Module ${manifest.id} imports missing module ${dependency.moduleId}`);
    const visiting = new Set<string>(); const visited = new Set<string>();
    const visit = (id: string) => { if (visiting.has(id)) throw new Error(`Circular module dependency involving ${id}`); if (visited.has(id)) return; visiting.add(id); for (const item of this.manifest(id).imports.domains) visit(item.moduleId); visiting.delete(id); visited.add(id); };
    for (const id of this.#manifests.keys()) visit(id);
  }
}

function validateLocalPaths(manifest: ModuleManifest): void {
  const values = [...manifest.workTypes.map((item) => item.path), ...manifest.domain?.exports.schemas.map((item) => item.path) ?? [], ...manifest.domain?.exports.references.map((item) => item.path) ?? [], ...Object.values(manifest.contributions).filter((item): item is string => Boolean(item))];
  for (const path of values) if (path.startsWith("/") || path.split("/").includes("..")) throw new Error(`Unsafe module path: ${path}`);
  const workIds = new Set<string>(); for (const item of manifest.workTypes) { if (workIds.has(item.id)) throw new Error(`Duplicate WorkType ${manifest.id}/${item.id}`); workIds.add(item.id); }
}
function releaseMatches(actual: string, requirement: string): boolean { return requirement === "*" || (requirement.endsWith(".*") ? actual.startsWith(requirement.slice(0, -1)) : actual === requirement); }
function withCapabilities(provider: DomainProvider, allowed: readonly string[]): DomainProvider { const ids = new Set(allowed); return { ...provider, capabilities: provider.capabilities.filter((item) => ids.has(item.id)) }; }
function fail(message: string): never { throw new Error(message); }
