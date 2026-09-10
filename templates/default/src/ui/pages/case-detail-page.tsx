import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import type { CaseRecord } from "../../domain/case.js";
import { AppApiError, getCase, sendCaseCommand } from "../api/cases.js";
import { CaseSummary } from "../components/case-summary.js";

export function CaseDetailPage() {
  const { id } = useParams();
  const [record, setRecord] = useState<CaseRecord>();
  const [error, setError] = useState<Error>();
  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [markReady, setMarkReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setError(undefined); setNotice(""); setRecord(undefined);
    getCase(id!).then((body) => { if (active) applyRecord(body.case); }).catch((cause) => { if (active) setError(asError(cause)); });
    return () => { active = false; };
  }, [id]);

  function applyRecord(value: CaseRecord) {
    setRecord(value); setCustomerName(value.customerName ?? ""); setEmail(value.email ?? ""); setMarkReady(value.status === "ready");
  }

  async function commit(event: FormEvent) {
    event.preventDefault();
    if (!record) return;
    setBusy(true); setError(undefined); setNotice("");
    const changes: { customerName?: string; email?: string; markReady?: boolean } = {};
    if (customerName.trim() && customerName !== (record.customerName ?? "")) changes.customerName = customerName.trim();
    if (email.trim() && email !== (record.email ?? "")) changes.email = email.trim();
    if (markReady !== (record.status === "ready")) changes.markReady = markReady;
    try {
      const body = await sendCaseCommand(record.id, { expectedRevision: record.revision, changes });
      setNotice(`Committed as revision ${body.receipt.record.revision}`);
      applyRecord(body.receipt.record);
    } catch (cause) {
      setError(cause instanceof AppApiError ? cause : asError(cause));
      try { applyRecord((await getCase(record.id)).case); } catch { /* keep the committed revision visible on double failure */ }
    } finally {
      setBusy(false);
    }
  }

  if (error && !record) return <section className="page"><h1>Case</h1><p role="alert" className="error">{error.message}</p></section>;
  if (!record) return <section className="page"><h1>Case</h1><p className="muted">Loading…</p></section>;

  return (
    <section className="page">
      <h1>Case</h1>
      <CaseSummary record={record} />
      {notice && <p role="status" className="notice">{notice}</p>}
      {error && <p role="alert" className="error">{error.message}</p>}
      <form className="case-form" onSubmit={commit}>
        <label>Customer name <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></label>
        <label>Email <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="checkbox">Mark ready <input type="checkbox" checked={markReady} onChange={(event) => setMarkReady(event.target.checked)} /></label>
        <button disabled={busy}>{busy ? "Committing…" : "Commit"}</button>
      </form>
    </section>
  );
}

function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
