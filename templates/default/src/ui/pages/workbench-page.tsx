import { AiricWorkbench } from "@airic/ui";
import { caseResultView } from "../result-views/case-result-view.js";

const workStarters = [
  { id: "domain-model", title: "Create Domain Model", description: "Model business language, invariants and domain tests.", definitionId: "domain-model-smith", domainIds: [], objective: "Help me create the domain model for this application", requiresWorkspace: true },
  { id: "operating-model", title: "Create Operating Model", description: "Turn a working method into a project-owned Work Definition.", definitionId: "operating-model-smith", domainIds: [], objective: "Help me create an operating model for this application", requiresWorkspace: true },
  { id: "experience", title: "Create Experience Slice", description: "Implement an application slice from use cases to HTTP API and React pages.", definitionId: "experience-smith", domainIds: [], objective: "Help me implement an experience slice for this application", requiresWorkspace: true },
  { id: "example", title: "Run Example Work", description: "Try the governed transaction example.", definitionId: "case-assistance", domainIds: ["case-management"], objective: "Help me complete this transaction", input: { caseId: "demo" } },
];

export function WorkbenchPage() {
  return <AiricWorkbench workStarters={workStarters} resultViews={[caseResultView]} />;
}
