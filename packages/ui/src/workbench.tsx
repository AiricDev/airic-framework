import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import "./style.css";
interface Work { id: string; objective: string; status: string; definition: { id: string; revision: string }; result?: unknown; updatedAt: string }
interface Trace { eventId: string; type: string; timestamp: string; actor: string; payload: unknown }
interface DefinitionSummary { id: string; title: string; revision: string }
interface DefinitionFiles { revision: string; files: Record<string, string> }
export interface ResultView { type: string; render(value: unknown): ReactNode }
export interface AiricWorkbenchProps { apiBase?: string; resultViews?: readonly ResultView[]; defaultDefinitionId?: string; defaultDomainIds?: readonly string[] }

export function AiricWorkbench({ apiBase = "/api", resultViews = [], defaultDefinitionId = "case-assistance", defaultDomainIds = ["case-management"] }: AiricWorkbenchProps) {
  const [works, setWorks] = useState<Work[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [trace, setTrace] = useState<Trace[]>([]);
  const [definitions, setDefinitions] = useState<DefinitionSummary[]>([]);
  const [editor, setEditor] = useState<{ id: string; path: string; value: DefinitionFiles }>();
  const [objective, setObjective] = useState("Help me complete this transaction");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const active = works.find((work) => work.id === activeId);

  const reload = async () => {
    const values = await checked<Work[]>(await fetch(`${apiBase}/works`));
    setWorks(values); setActiveId((id) => id ?? values[0]?.id);
  };
  const reloadDefinitions = async () => setDefinitions(await checked<DefinitionSummary[]>(await fetch(`${apiBase}/definitions`)));
  const reloadActive = async () => {
    if (!activeId) return;
    const response = await fetch(`${apiBase}/works/${encodeURIComponent(activeId)}`);
    if (!response.ok) return;
    const value = await response.json() as { work: Work; trace: Trace[] };
    setTrace(value.trace); setWorks((items) => [value.work, ...items.filter((item) => item.id !== value.work.id)]);
  };
  useEffect(() => { void reload(); void reloadDefinitions(); const events = new EventSource(`${apiBase}/events`); events.addEventListener("trace", () => { void reload(); void reloadActive(); }); return () => events.close(); }, []);
  useEffect(() => { void reloadActive(); }, [activeId]);

  const messages = trace.filter((event) => event.type === "message.user" || event.type === "message.agent");
  const candidates = trace.filter((event) => event.type === "reflection.candidate");
  const renderedResult = useMemo(() => { const typed = active?.result as { type?: string } | undefined; return resultViews.find((view) => view.type === typed?.type)?.render(active?.result); }, [active?.result, resultViews]);

  async function create(event: FormEvent) { event.preventDefault(); await act(async () => { const work = await checked<Work>(await post(`${apiBase}/works`, { definitionId: defaultDefinitionId, objective, input: {}, domainIds: defaultDomainIds })); setActiveId(work.id); await reload(); }); }
  async function send(event: FormEvent) { event.preventDefault(); if (!activeId || !message.trim()) return; const sent = message; setMessage(""); await act(async () => { await checked(await post(`${apiBase}/works/${encodeURIComponent(activeId)}/messages`, { message: sent })); await reloadActive(); }); }
  async function startReflection() { if (!active) return; await act(async () => { const work = await checked<Work>(await post(`${apiBase}/works`, { definitionId: "reflection", objective: `Reflect on ${active.objective}`, input: { sourceWorkId: active.id }, domainIds: [] })); setActiveId(work.id); await reload(); }); }
  async function rebind() { if (!active) return; await act(async () => { await checked(await post(`${apiBase}/works/${encodeURIComponent(active.id)}/rebind`, {})); await reloadActive(); }); }
  async function loadDefinition(id: string) { await act(async () => { const value = await checked<DefinitionFiles>(await fetch(`${apiBase}/definitions/${encodeURIComponent(id)}`)); const path = Object.keys(value.files).find((item) => item.endsWith(".md")) ?? "work.yml"; setEditor({ id, path, value }); }); }
  async function publishDefinition() { if (!editor) return; await act(async () => { await checked(await post(`${apiBase}/definitions/publish`, { id: editor.id, baseRevision: editor.value.revision, files: editor.value.files })); await reloadDefinitions(); }); }
  async function upload(file: File) { if (!active) return; await act(async () => { await checked(await post(`${apiBase}/works/${encodeURIComponent(active.id)}/uploads`, { name: file.name, mediaType: file.type || "application/octet-stream", contentBase64: await toBase64(file) })); await reloadActive(); }); }
  async function act(action: () => Promise<void>) { setBusy(true); setError(undefined); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } }

  return <div className="airic-shell">
    <aside><h1>Airic</h1><form onSubmit={create}><input aria-label="Work objective" value={objective} onChange={(event) => setObjective(event.target.value)} /><button disabled={busy}>New work</button></form><nav>{works.map((work) => <button className={work.id === activeId ? "active" : ""} key={work.id} onClick={() => setActiveId(work.id)}><span>{work.objective}</span><small>{work.status}</small></button>)}</nav></aside>
    <main>{!active ? <section className="empty"><h2>Start a governed work</h2><p>The workbench runs in simulated mode until the host selects the Pi harness and configures a model.</p></section> : <>
      <header><div><small>{active.definition.id} · {active.definition.revision.slice(0, 8)}</small><h2>{active.objective}</h2></div><div className="header-actions">{active.status === "open" && <button onClick={rebind}>Rebind versions</button>}{active.definition.id !== "reflection" && <button onClick={startReflection}>Reflect</button>}<span className={`status ${active.status}`}>{active.status}</span></div></header>
      <section className="conversation" aria-label="Conversation">{messages.length ? messages.map((entry) => <article className={entry.type.endsWith("user") ? "user" : "agent"} key={entry.eventId}><small>{entry.actor}</small><p>{String((entry.payload as { text?: string }).text ?? "")}</p></article>) : <p className="muted">Tell the agent what outcome you need. It can choose the order, while domain constraints remain deterministic.</p>}</section>
      {error && <p role="alert" className="error">{error}</p>}
      {active.status === "open" && <><form className="composer" onSubmit={send}><textarea aria-label="Message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe the transaction or answer the agent…" /><button disabled={busy}>{busy ? "Working…" : "Send"}</button></form><label className="upload">Attach evidence <input type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label></>}
      <section className="panels"><details open><summary>Outcome</summary>{renderedResult ?? <pre>{JSON.stringify(active.result ?? { state: "Not completed" }, null, 2)}</pre>}</details><details><summary>Context & trace ({trace.length})</summary><ol>{trace.map((entry) => <li key={entry.eventId}><code>{entry.type}</code><small>{new Date(entry.timestamp).toLocaleString()}</small></li>)}</ol></details><details><summary>Reflection ({candidates.length})</summary>{candidates.length ? candidates.map((candidate) => <pre key={candidate.eventId}>{JSON.stringify(candidate.payload, null, 2)}</pre>) : <p className="muted">No candidate changes yet.</p>}</details><details><summary>Operating model</summary><div className="definition-list">{definitions.map((definition) => <button key={definition.id} onClick={() => loadDefinition(definition.id)}>{definition.title} · {definition.revision.slice(0, 8)}</button>)}</div>{editor && <div className="editor"><select value={editor.path} onChange={(event) => setEditor({ ...editor, path: event.target.value })}>{Object.keys(editor.value.files).map((path) => <option key={path}>{path}</option>)}</select><textarea aria-label="Definition content" value={editor.value.files[editor.path]} onChange={(event) => setEditor({ ...editor, value: { ...editor.value, files: { ...editor.value.files, [editor.path]: event.target.value } } })} /><button onClick={publishDefinition}>Publish immutable revision</button></div>}</details></section>
    </>}</main>
  </div>;
}

async function post(url: string, body: unknown) { return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
async function checked<T>(response: Response): Promise<T> { const value = await response.json(); if (!response.ok) throw new Error((value as { error?: string }).error ?? response.statusText); return value as T; }
async function toBase64(file: File): Promise<string> { const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
