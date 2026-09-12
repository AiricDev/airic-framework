import type { BrowserModuleContribution } from "../../../app/module-contracts.js";
import { CaseDetailPage } from "./pages/case-detail-page.js";
import { CasesPage } from "./pages/cases-page.js";
import { caseResultView } from "./result-views/case-result-view.js";

export const browserContribution: BrowserModuleContribution = {
  moduleId: "cases",
  navigation: [{ to: "/cases", label: "Cases" }],
  routes: [{ path: "/cases", element: <CasesPage /> }, { path: "/cases/:id", element: <CaseDetailPage /> }],
  resultViews: [caseResultView],
  workStarters: [{ id: "case-assistance", title: "Run Example Work", description: "Try the governed transaction example.", moduleId: "cases", workTypeId: "case-assistance", objective: "Help me complete this transaction", input: { caseId: "demo" } }],
};
