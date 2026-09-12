import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ResultView } from "@airic/ui";
import type { CaseRecord } from "../../domain/case.js";
import { getCase } from "../api/cases.js";
import { CaseSummary } from "../components/case-summary.js";

/** Work results store a business reference; the authoritative record is read through the business API. */
export const caseResultView: ResultView = {
  type: "case",
  render: (value) => {
    const reference = value as { id?: string };
    return <CaseResultCard id={reference.id ?? ""} />;
  },
};

function CaseResultCard({ id }: { id: string }) {
  const [record, setRecord] = useState<CaseRecord>();
  const [error, setError] = useState<Error>();

  useEffect(() => {
    if (!id) return;
    let active = true;
    getCase(id).then((body) => { if (active) setRecord(body.case); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause : new Error(String(cause))); });
    return () => { active = false; };
  }, [id]);

  if (!id) return <p className="muted">The work result carries no case reference.</p>;
  if (error) return <p role="alert" className="error">{error.message}</p>;
  if (!record) return <p className="muted">Loading the committed case…</p>;
  return (
    <div>
      <CaseSummary record={record} />
      <p><Link to={`/cases/${record.id}`}>Open case</Link></p>
    </div>
  );
}
