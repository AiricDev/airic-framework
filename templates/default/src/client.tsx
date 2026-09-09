import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AiricWorkbench } from "@airic/ui";
import "@airic/ui/style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AiricWorkbench defaultInput={{ caseId: "demo" }} resultViews={[{ type: "case", render: (value) => <pre>{JSON.stringify(value, null, 2)}</pre> }]} />
  </StrictMode>,
);
