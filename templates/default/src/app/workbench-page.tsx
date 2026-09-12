import { AiricWorkbench, type WorkStarter } from "@airic/ui";
import { browserModules } from "./browser-modules.js";

const moduleSmith: WorkStarter = {
  id: "module-smith", title: "Develop a Module", description: "Change one complete vertical slice within an explicitly selected module.",
  moduleId: "development", workTypeId: "module-smith", objective: "Help me develop a complete application module", input: { targetModuleId: "cases" }, requiresWorkspace: true,
};

export function WorkbenchPage() {
  return <AiricWorkbench workStarters={[moduleSmith, ...browserModules.flatMap((item) => item.workStarters ?? [])]} resultViews={browserModules.flatMap((item) => item.resultViews ?? [])} />;
}
