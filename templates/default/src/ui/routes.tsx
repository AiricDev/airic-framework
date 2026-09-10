import { Navigate, Route, Routes } from "react-router";
import { CasesPage } from "./pages/cases-page.js";
import { CaseDetailPage } from "./pages/case-detail-page.js";
import { WorkbenchPage } from "./pages/workbench-page.js";

/**
 * The fixed registration entry for application pages. New experience slices
 * register their routes here so the composition root never changes.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/cases" replace />} />
      <Route path="/cases" element={<CasesPage />} />
      <Route path="/cases/:id" element={<CaseDetailPage />} />
      <Route path="/work/*" element={<WorkbenchPage />} />
      <Route path="*" element={<main className="page"><h1>Not found</h1><p className="muted">This page does not exist.</p></main>} />
    </Routes>
  );
}
