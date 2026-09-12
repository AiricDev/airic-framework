import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { ModuleRegistry } from "@airic/framework";
import type { LoadedServerModule, ServerModuleContext, ServerModuleContribution } from "./module-contracts.js";

export async function loadServerModules(input: { root: string; data: string; registry: ModuleRegistry }): Promise<readonly LoadedServerModule[]> {
  const loaded: LoadedServerModule[] = [];
  const services = new Map<string, unknown>();
  for (const manifest of dependencyOrder(input.registry.list())) {
    if (!manifest.contributions.server) { loaded.push({ manifest }); continue; }
    const target = resolve(input.root, "dist/modules", manifest.id, manifest.contributions.server.replace(/\.tsx?$/u, ".js"));
    const imported = await import(pathToFileURL(target).href) as { createServerContribution?: (input: ServerModuleContext) => Promise<ServerModuleContribution> };
    if (!imported.createServerContribution) throw new Error(`Module ${manifest.id} server contribution has no createServerContribution export`);
    const contribution = await imported.createServerContribution({
      root: input.root,
      data: input.data,
      getService: <T>(moduleId: string, serviceId: string) => {
        assertServiceImport(manifest, moduleId);
        const value = services.get(`${moduleId}/${serviceId}`);
        if (value === undefined) throw new Error(`Module service is unavailable: ${moduleId}/${serviceId}`);
        return value as T;
      },
    });
    for (const [serviceId, service] of Object.entries(contribution.services ?? {})) {
      const key = `${manifest.id}/${serviceId}`;
      if (services.has(key)) throw new Error(`Duplicate module service: ${key}`);
      services.set(key, service);
    }
    loaded.push({ manifest, contribution });
  }
  return loaded;
}

export function assertServiceImport(manifest: import("@airic/framework").ModuleManifest, providerModuleId: string): void {
  if (!manifest.imports.domains.some((dependency) => dependency.moduleId === providerModuleId)) {
    throw new Error(`Module ${manifest.id} cannot use undeclared service provider ${providerModuleId}`);
  }
}

function dependencyOrder(manifests: readonly import("@airic/framework").ModuleManifest[]) {
  const byId = new Map(manifests.map((item) => [item.id, item])); const result: import("@airic/framework").ModuleManifest[] = []; const seen = new Set<string>();
  const visit = (id: string) => { if (seen.has(id)) return; const item = byId.get(id)!; for (const dependency of item.imports.domains) visit(dependency.moduleId); seen.add(id); result.push(item); };
  for (const item of manifests) visit(item.id); return result;
}
