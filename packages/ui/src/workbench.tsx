import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createAiricClient, type AiricClient, type WorkTypeFilesDto, type WorkTypeSummaryDto, type TraceDto, type WorkDto, type WorkspaceStatusDto } from "@airic/client";
import { useOptionalAiricClient } from "./provider.js";
import "./style.css";
interface WorkspaceChange { path: string; status: "added" | "modified" | "deleted"; beforeDigest: string | null; afterDigest: string | null }
export interface ResultView { type: string; render(value: unknown): ReactNode }
export interface WorkStarter { id: string; title: string; description: string; moduleId: string; workTypeId: string; objective: string; input?: unknown; requiresWorkspace?: boolean }
export interface AiricWorkbenchProps { client?: AiricClient; /** @deprecated Prefer client or AiricProvider. */ apiBase?: string; resultViews?: readonly ResultView[]; defaultModuleId?: string; defaultWorkTypeId?: string; defaultInput?: unknown; workStarters?: readonly WorkStarter[] }

export function AiricWorkbench({ client: suppliedClient, apiBase = "/api", resultViews = [], defaultModuleId = "cases", defaultWorkTypeId = "case-assistance", defaultInput = {}, workStarters }: AiricWorkbenchProps) {
  const inheritedClient = useOptionalAiricClient();
  const client = useMemo(() => suppliedClient ?? inheritedClient ?? createAiricClient({ baseUrl: apiBase }), [suppliedClient, inheritedClient, apiBase]);
  const starters = workStarters?.length ? workStarters : [{ id: "default", title: "New work", description: "Start a governed work.", moduleId: defaultModuleId, workTypeId: defaultWorkTypeId, objective: "Help me complete this transaction", input: defaultInput }];
  const initialStarter = starters.find((starter) => !starter.requiresWorkspace) ?? starters[0]!;
  const [works, setWorks] = useState<WorkDto[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [trace, setTrace] = useState<TraceDto[]>([]);
  const [definitions, setDefinitions] = useState<WorkTypeSummaryDto[]>([]);
  const [viewer, setViewer] = useState<{ id: string; path: string; value: WorkTypeFilesDto }>();
  const [starterId, setStarterId] = useState(initialStarter.id);
  const [objective, setObjective] = useState(initialStarter.objective);
  const [workspaceWorkTypes, setWorkspaceWorkTypes] = useState<string[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceStatusDto>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const active = works.find((work) => work.id === activeId);

  const reload = async () => {
    const values = await client.listWorks();
    setWorks(values); setActiveId((id) => id ?? values[0]?.id);
  };
  const reloadDefinitions = async () => setDefinitions(await client.listWorkTypes());
  const reloadWorkspace = async () => { try { setWorkspace(await client.getWorkspace()); } catch {} };
  const reloadActive = async (id = activeIdRef.current) => {
    if (!id) return;
    const value = await client.getWork(id);
    setTrace(value.trace); setWorks((items) => [value.work, ...items.filter((item) => item.id !== value.work.id)]);
  };
  useEffect(() => { void reload(); void reloadDefinitions(); void reloadWorkspace(); void client.getCapabilities().then((value) => setWorkspaceWorkTypes(value.workspaceWorkTypes ?? [])); return client.subscribeTrace((event) => { void reload(); if (event.workId === activeIdRef.current) void reloadActive(event.workId); void reloadWorkspace(); }); }, [client]);
  useEffect(() => { void reloadActive(activeId); }, [activeId]);

  const messages = trace.filter((event) => event.type === "message.user" || event.type === "message.agent");
  const proposals = trace.filter((event) => event.type === "reflection.proposed");
  const workspaceEvidence = trace.filter((event) => event.type === "tool.execution" && String((event.payload as { name?: string }).name ?? "").startsWith("workspace_") && (event.payload as { phase?: string }).phase === "end");
  const workspaceChanges = workspaceEvidence.flatMap((event) => ((event.payload as { result?: { changes?: WorkspaceChange[] } }).result?.changes ?? []));
  const workspaceChecks = workspaceEvidence.flatMap((event) => { const check = (event.payload as { result?: { check?: { id: string; title: string; status: string } } }).result?.check; return check ? [check] : []; });
  const workspaceFailures = workspaceEvidence.filter((event) => (event.payload as { isError?: boolean }).isError).map((event) => String((event.payload as { name?: string }).name ?? "workspace tool"));
  const renderedResult = useMemo(() => { const typed = active?.result as { type?: string } | undefined; return resultViews.find((view) => view.type === typed?.type)?.render(active?.result); }, [active?.result, resultViews]);

  async function create(event: FormEvent) { event.preventDefault(); const starter = starters.find((item) => item.id === starterId)!; await createStarter(starter, objective); }
  async function createStarter(starter: WorkStarter, selectedObjective = starter.objective) { await act(async () => { const work = await client.createWork({ moduleId: starter.moduleId, workTypeId: starter.workTypeId, objective: selectedObjective, input: starter.input ?? {} }); setActiveId(work.id); await reload(); }); }
  async function send(event: FormEvent) { event.preventDefault(); if (!activeId || !message.trim()) return; const sent = message; setMessage(""); await act(async () => { await client.sendMessage(activeId, sent); await reloadActive(); }); }
  async function startReflection() { if (!active) return; await act(async () => { const work = await client.createReflection({ moduleId: "development", workTypeId: "reflection", objective: `Reflect on ${active.objective}`, sourceWorks: [{ workId: active.id }] }); setActiveId(work.id); await reload(); }); }
  async function loadDefinition(moduleId: string, workTypeId: string) { await act(async () => { const value = await client.getWorkType(moduleId, workTypeId); const path = Object.keys(value.files).find((item) => item.endsWith(".md")) ?? "work.yml"; setViewer({ id: `${moduleId}/${workTypeId}`, path, value }); }); }
  async function upload(file: File) { if (!active) return; await act(async () => { await client.uploadEvidence(active.id, { name: file.name, mediaType: file.type || "application/octet-stream", contentBase64: await toBase64(file) }); await reloadActive(); }); }
  async function act(action: () => Promise<void>) { setBusy(true); setError(undefined); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } }

  const context = [...trace].reverse().find((event) => event.type === "context.assembled")?.payload as { workType?: { operatingDigest?: string; gitHead?: string; dirty?: boolean } } | undefined;
  const selectedStarter = starters.find((starter) => starter.id === starterId)!;
  return <div className="airic-shell">
    <aside><h1>Airic</h1><form onSubmit={create}><select aria-label="Work type" value={starterId} onChange={(event) => { const next = starters.find((item) => item.id === event.target.value)!; setStarterId(next.id); setObjective(next.objective); }}>{starters.map((starter) => <option key={starter.id} value={starter.id}>{starter.title}</option>)}</select><input aria-label="Work objective" value={objective} onChange={(event) => setObjective(event.target.value)} /><button disabled={busy || Boolean(selectedStarter.requiresWorkspace && !workspaceWorkTypes.includes(`${selectedStarter.moduleId}/${selectedStarter.workTypeId}`))}>New work</button></form><nav>{works.map((work) => <button className={work.id === activeId ? "active" : ""} key={work.id} onClick={() => setActiveId(work.id)}><span>{work.objective}</span><small>{work.status}</small></button>)}</nav></aside>
    <main>{!active ? <section className="empty"><h2>Start a governed work</h2><p>Choose a module-owned WorkType.</p><div className="starter-grid">{starters.map((starter) => { const unavailable = starter.requiresWorkspace && !workspaceWorkTypes.includes(`${starter.moduleId}/${starter.workTypeId}`); return <button key={starter.id} disabled={busy || unavailable} onClick={() => createStarter(starter)}><strong>{starter.title}</strong><span>{unavailable ? "Configure the Pi harness and a model to enable project changes." : starter.description}</span></button>; })}</div></section> : <>
      <header><div><small>{active.workType.moduleId}/{active.workType.workTypeId}{context?.workType?.operatingDigest ? ` · ${context.workType.operatingDigest.slice(0, 8)}` : ""}{context?.workType?.dirty ? " · dirty" : ""}</small><h2>{active.objective}</h2></div><div className="header-actions">{active.workType.workTypeId !== "reflection" && <button onClick={startReflection}>Reflect</button>}<span className={`status ${active.status}`}>{active.status}</span></div></header>
      <section className="conversation" aria-label="Conversation">{messages.length ? messages.map((entry) => <article className={entry.type.endsWith("user") ? "user" : "agent"} key={entry.eventId}><small>{entry.actor}</small><p>{String((entry.payload as { text?: string }).text ?? "")}</p></article>) : <p className="muted">Tell the agent what outcome you need. It can choose the order, while domain constraints remain deterministic.</p>}</section>
      {error && <p role="alert" className="error">{error}</p>}
      {active.status === "open" && <><form className="composer" onSubmit={send}><textarea aria-label="Message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe the transaction or answer the agent…" /><button disabled={busy}>{busy ? "Working…" : "Send"}</button></form><label className="upload">Attach evidence <input type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label></>}
      <section className="panels"><details open><summary>Outcome</summary>{renderedResult ?? <pre>{JSON.stringify(active.result ?? { state: "Not completed" }, null, 2)}</pre>}</details>{active.workType.workTypeId.endsWith("-smith") && <details open><summary>Workspace changes</summary>{workspaceChanges.length ? <ul>{workspaceChanges.map((change, index) => <li key={`${change.path}-${index}`}><code>{change.status}</code> {change.path}</li>)}</ul> : <p className="muted">No recorded file changes yet.</p>}{workspaceChecks.length > 0 && <><h3>Validation</h3><ul>{workspaceChecks.map((check, index) => <li key={`${check.id}-${index}`}><code>{check.status}</code> {check.title}</li>)}</ul></>}{workspaceFailures.length > 0 && <><h3>Conflicts or failures</h3><ul>{workspaceFailures.map((name, index) => <li key={`${name}-${index}`}><code>failed</code> {name}</li>)}</ul></>}</details>}<details><summary>Context & trace ({trace.length})</summary><ol>{trace.map((entry) => <li key={entry.eventId}><code>{entry.type}</code><small>{new Date(entry.timestamp).toLocaleString()}</small></li>)}</ol></details><details><summary>Reflection proposals ({proposals.length})</summary>{proposals.length ? proposals.map((proposal) => <pre key={proposal.eventId}>{JSON.stringify(proposal.payload, null, 2)}</pre>) : <p className="muted">No proposed Operating Model changes yet.</p>}</details><details><summary>Operating model</summary><p className="muted">Working tree · {workspace?.gitHead?.slice(0, 8) ?? "no HEAD"} · {workspace?.dirty ? "dirty" : "clean"}</p><pre>{workspace?.status || "Clean working tree."}</pre><div className="definition-list">{definitions.map((definition) => <button key={definition.moduleId + "/" + definition.workTypeId} onClick={() => loadDefinition(definition.moduleId, definition.workTypeId)}>{definition.title} · {definition.digest.slice(0, 8)}</button>)}</div>{viewer && <div className="editor"><select value={viewer.path} onChange={(event) => setViewer({ ...viewer, path: event.target.value })}>{Object.keys(viewer.value.files).map((path) => <option key={path}>{path}</option>)}</select><pre>{viewer.value.files[viewer.path]}</pre></div>}<h3>Git diff</h3><pre>{workspace?.diff || "No tracked-file diff."}</pre></details></section>
    </>}</main>
  </div>;
}

async function toBase64(file: File): Promise<string> { const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
