import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { CaseRecord } from "../../domain/case.js";
import { AppApiError, listCases } from "../api/cases.js";

export function CasesPage() {
  const [cases, setCases] = useState<CaseRecord[]>();
  const [error, setError] = useState<Error>();

  useEffect(() => {
    let active = true;
    listCases().then((body) => { if (active) setCases(body.cases); }).catch((cause) => { if (active) setError(asError(cause)); });
    return () => { active = false; };
  }, []);

  if (error) return <section className="page"><h1>Cases</h1><p role="alert" className="error">{error.message}</p></section>;
  if (!cases) return <section className="page"><h1>Cases</h1><p className="muted">Loading…</p></section>;
  if (!cases.length) return <section className="page"><h1>Cases</h1><p className="muted">No cases yet.</p></section>;
  return (
    <section className="page">
      <h1>Cases</h1>
      <ul className="case-list">
        {cases.map((record) => (
          <li key={record.id}>
            <Link to={`/cases/${record.id}`}>
              <strong>{record.customerName ?? record.id}</strong>
              <span className={`case-status ${record.status}`}>{record.status}</span>
              <small>revision {record.revision}</small>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
