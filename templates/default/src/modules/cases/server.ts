import { resolve } from "node:path";
import type { ServerModuleContribution } from "../../app/module-contracts.js";
import { CaseService } from "./application/case-service.js";
import { createAppRoutes } from "./experience/http-routes.js";
import { createCaseDomain } from "./infrastructure/airic-domain-provider.js";
import { JsonCaseRepository } from "./infrastructure/json-case-repository.js";

export async function createServerContribution(input: { root: string; data: string }): Promise<ServerModuleContribution> {
  const repository = new JsonCaseRepository(resolve(input.data, "modules/cases/cases.json"));
  await repository.initialize();
  const service = new CaseService(repository);
  return { routes: createAppRoutes({ cases: service }), domain: createCaseDomain(service, input.root) };
}
