import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AiricWorkbench } from "@airic/ui";
import "@airic/ui/style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AiricWorkbench
      workStarters={[
        { id: "domain-model", title: "Create Domain Model", description: "Model business language, invariants and domain tests.", definitionId: "domain-model-smith", domainIds: [], objective: "Help me create the domain model for this application", requiresWorkspace: true },
        { id: "operating-model", title: "Create Operating Model", description: "Turn a working method into a project-owned Work Definition.", definitionId: "operating-model-smith", domainIds: [], objective: "Help me create an operating model for this application", requiresWorkspace: true },
        { id: "example", title: "Run Example Work", description: "Try the governed transaction example.", definitionId: "case-assistance", domainIds: ["case-management"], objective: "Help me complete this transaction", input: { caseId: "demo" } },
      ]}
      resultViews={[{ type: "case", render: (value) => <pre>{JSON.stringify(value, null, 2)}</pre> }]}
    />
  </StrictMode>,
);
