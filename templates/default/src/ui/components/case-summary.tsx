import type { CaseRecord } from "../../domain/case.js";

export function CaseSummary({ record }: { record: CaseRecord }) {
  return (
    <dl className="case-summary">
      <dt>Case</dt><dd><code>{record.id}</code></dd>
      <dt>Status</dt><dd><span className={`case-status ${record.status}`}>{record.status}</span></dd>
      <dt>Customer</dt><dd>{record.customerName ?? "—"}</dd>
      <dt>Email</dt><dd>{record.email ?? "—"}</dd>
      <dt>Revision</dt><dd>{record.revision}</dd>
    </dl>
  );
}
