import type { DomainModule } from "@airic/framework";
import { resolve } from "node:path";
import { CaseService } from "../application/case-service.js";
import type { AppRoute } from "../http/application-handler.js";
import { createAppRoutes } from "../http/routes.js";
import { JsonCaseRepository } from "../infrastructure/json-case-repository.js";
import { createCaseDomain } from "./airic/domain-module.js";

export interface ApplicationAssembly {
  routes: readonly AppRoute[];
  domains: readonly DomainModule[];
}

/** Fixed, Experience-Smith-writable registration point consumed by the stable host. */
export async function createApplicationAssembly(input: { root: string; data: string }): Promise<ApplicationAssembly> {
  const repository = new JsonCaseRepository(resolve(input.data, "business/cases.json"));
  await repository.initialize();
  const cases = new CaseService(repository);
  return {
    routes: createAppRoutes({ cases }),
    domains: [createCaseDomain(cases, input.root)],
  };
}
