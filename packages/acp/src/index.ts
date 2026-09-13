import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { isAbsolute, join, resolve } from "node:path";
import type { Duplex } from "node:stream";
import { AgentSideConnection, PROTOCOL_VERSION, RequestError, type Agent } from "@agentclientprotocol/sdk";
import { AcpServer } from "@agentclientprotocol/sdk/experimental/server";
import { WebSocketServer } from "ws";
import type { AiricRuntime, TraceEvent, TrustedCallContext, Work } from "@airic/framework";
import type { AiricAccessPolicy } from "@airic/server";

type Actor = TrustedCallContext["actor"];

export interface AiricAcpGatewayOptions {
  runtime: AiricRuntime;
  authenticate(request: IncomingMessage): Promise<Actor>;
  authorize: AiricAccessPolicy;
  /** Absolute directory actually used by the host's Agent harness, never client-selected. */
  cwd: string;
  sessionDirectory: string;
  origin: string;
  basePath?: string;
}

/** A transport identity only; Work and canonical trace remain Airic-owned. */
export class FileAcpSessionStore {
  readonly #directory: string;
  constructor(directory: string) { this.#directory = resolve(directory); }
  async get(workId: string): Promise<string | undefined> {
    try { return (JSON.parse(await readFile(this.#path(workId), "utf8")) as { sessionId: string }).sessionId; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  async create(workId: string): Promise<string> {
    const path = this.#path(workId);
    await mkdir(this.#directory, { recursive: true });
    const sessionId = `airic_${randomUUID()}`;
    try { await writeFile(path, JSON.stringify({ sessionId, workId }), { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new RequestError(-32004, "WorkAlreadyHasSession: use session/load"); throw error; }
    return sessionId;
  }
  #path(workId: string): string {
    if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(workId)) throw new Error("Invalid Work ID");
    return join(this.#directory, `${workId}.json`);
  }
}

export function createAiricAcpGateway(options: AiricAcpGatewayOptions) {
  const base = (options.basePath ?? "/api/airic").replace(/\/$/u, "");
  const cwd = resolve(options.cwd);
  const configuredOrigin = new URL(options.origin);
  if (configuredOrigin.protocol !== "http:" && configuredOrigin.protocol !== "https:") throw new Error("ACP origin must be HTTP or HTTPS");
  const origin = configuredOrigin.origin;
  if (!isAbsolute(options.cwd) || !isAbsolute(options.sessionDirectory)) throw new Error("ACP directories must be absolute");
  const store = new FileAcpSessionStore(options.sessionDirectory);
  const cancelledTurns = new Set<string>();
  const activeTurns = new Set<string>();
  const ws = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const server = new AcpServer({ createLegacyAgent: () => { throw new Error("ACP requires a Work-bound WebSocket"); } });
  let closed = false;

  async function verify(request: IncomingMessage, work: Work, action: "read" | "prompt" | "interrupt"): Promise<Actor> {
    let actor: Actor;
    try { actor = await options.authenticate(request); }
    catch { throw RequestError.authRequired(); }
    let authorized = false;
    try { authorized = Boolean(actor?.id && await options.authorize(actor, { kind: "work", work, action })); }
    catch { /* a policy failure denies access */ }
    if (!authorized) throw new RequestError(-32001, "WorkAccessDenied");
    return actor;
  }

  return {
    async connection(work: Work, request: IncomingMessage): Promise<{ url: string; cwd: string; sessionId?: string }> {
      await verify(request, work, "read");
      const url = new URL(`${base}/works/${encodeURIComponent(work.id)}/acp`, origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const sessionId = await store.get(work.id);
      return { url: url.toString(), cwd, ...(sessionId ? { sessionId } : {}) };
    },
    async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const match = pathname.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/works/([^/]+)/acp$`, "u"));
      if (!match) return false;
      try {
        if (closed || request.headers.origin !== origin) throw new Error("Invalid ACP origin");
        const work = options.runtime.getWork(decodeURIComponent(match[1]!));
        if (!work) throw new Error("Unknown Work");
        await verify(request, work, "read");
        const prepared = server.prepareWebSocketUpgrade({ createLegacyAgent: (connection) => new WorkAgent(connection, options.runtime, store, cwd, work.id, cancelledTurns, activeTurns, (action) => verify(request, options.runtime.getWork(work.id) ?? work, action)) });
        const headers = (values: string[], source: IncomingMessage) => { if (source === request) values.push(`Acp-Connection-Id: ${prepared.connectionId}`); };
        ws.on("headers", headers);
        const cleanup = () => ws.off("headers", headers);
        socket.once("close", () => { cleanup(); prepared.reject(); });
        ws.handleUpgrade(request, socket, head, (webSocket) => { cleanup(); prepared.accept(webSocket); });
      } catch { socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); socket.destroy(); }
      return true;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const client of ws.clients) client.terminate();
      await server.close();
      await new Promise<void>((done) => ws.close(() => done()));
    },
  };
}

class WorkAgent implements Agent {
  readonly #connection: AgentSideConnection;
  readonly #runtime: AiricRuntime;
  readonly #store: FileAcpSessionStore;
  readonly #cwd: string;
  readonly #workId: string;
  readonly #cancelledTurns: Set<string>;
  readonly #activeTurns: Set<string>;
  readonly #verify: (action: "read" | "prompt" | "interrupt") => Promise<Actor>;
  constructor(connection: AgentSideConnection, runtime: AiricRuntime, store: FileAcpSessionStore, cwd: string, workId: string, cancelledTurns: Set<string>, activeTurns: Set<string>, verify: (action: "read" | "prompt" | "interrupt") => Promise<Actor>) {
    this.#connection = connection; this.#runtime = runtime; this.#store = store; this.#cwd = cwd; this.#workId = workId; this.#cancelledTurns = cancelledTurns; this.#activeTurns = activeTurns; this.#verify = verify;
  }
  async initialize(): Promise<Awaited<ReturnType<Agent["initialize"]>>> {
    await this.#verify("read");
    return { protocolVersion: PROTOCOL_VERSION, agentInfo: { name: "Airic Work", version: "0.2.0" }, agentCapabilities: { loadSession: true, promptCapabilities: { image: false, audio: false, embeddedContext: false } } };
  }
  async authenticate(): Promise<void> { throw new Error("Authentication is managed by the application host"); }
  #validateSetup(params: { cwd: string; mcpServers: readonly unknown[]; additionalDirectories?: readonly string[] }): void {
    if (params.cwd !== this.#cwd || params.mcpServers.length || params.additionalDirectories?.length) throw RequestError.invalidParams(undefined, "ACP session configuration is fixed by the application host");
  }
  async newSession(params: Parameters<Agent["newSession"]>[0]): Promise<{ sessionId: string }> {
    await this.#verify("read"); this.#validateSetup(params);
    if (await this.#store.get(this.#workId)) throw new RequestError(-32004, "WorkAlreadyHasSession: use session/load");
    return { sessionId: await this.#store.create(this.#workId) };
  }
  async loadSession(params: Parameters<NonNullable<Agent["loadSession"]>>[0]): Promise<void> {
    await this.#verify("read"); this.#validateSetup(params); await this.#requireSession(params.sessionId);
    for (const event of this.#runtime.getTrace(this.#workId)) await this.#projectTrace(params.sessionId, event);
  }
  async prompt(params: Parameters<Agent["prompt"]>[0]): Promise<Awaited<ReturnType<Agent["prompt"]>>> {
    const actor = await this.#verify("prompt"); await this.#requireSession(params.sessionId);
    if (!params.prompt.length || params.prompt.some((block) => block.type !== "text")) throw RequestError.invalidParams(undefined, "Only text prompts are supported; use authenticated evidence uploads for attachments");
    const message = params.prompt.map((block) => block.type === "text" ? block.text : "").join("\n");
    if (!message.trim()) throw RequestError.invalidParams(undefined, "Prompt text is required");
    if (this.#activeTurns.has(this.#workId)) throw new RequestError(-32009, "WorkBusy: an Agent turn is already running");
    this.#activeTurns.add(this.#workId);
    this.#cancelledTurns.delete(this.#workId);
    let sawDelta = false;
    let queued = Promise.resolve();
    let streamError: unknown;
    const enqueue = (update: Parameters<AgentSideConnection["sessionUpdate"]>[0]["update"]) => { queued = queued.then(async () => { if (streamError) return; try { await this.#verify("read"); await this.#connection.sessionUpdate({ sessionId: params.sessionId, update }); } catch (error) { streamError = error; try { await this.#runtime.interrupt(this.#workId); } catch { /* preserve the delivery or authorization error */ } } }); };
    const offLive = this.#runtime.subscribeLive((event) => { if (event.workId === this.#workId) { sawDelta = true; enqueue({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: event.text } }); } });
    const offTrace = this.#runtime.subscribe((event) => { if (event.workId === this.#workId && event.type === "tool.execution") {
      const tool = toolUpdate(event); if (tool) enqueue(tool);
    } });
    try {
      const result = await this.#runtime.sendMessage(this.#workId, message, actor);
      if (!sawDelta && result.text) enqueue({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: result.text } });
      await queued;
      if (streamError) throw streamError;
      return { stopReason: this.#cancelledTurns.has(this.#workId) ? "cancelled" : "end_turn" };
    } catch (error) { await queued; if (this.#cancelledTurns.has(this.#workId)) return { stopReason: "cancelled" }; throw error; }
    finally { offLive(); offTrace(); this.#activeTurns.delete(this.#workId); this.#cancelledTurns.delete(this.#workId); }
  }
  async cancel(params: Parameters<Agent["cancel"]>[0]): Promise<void> {
    await this.#verify("interrupt"); await this.#requireSession(params.sessionId);
    this.#cancelledTurns.add(this.#workId); await this.#runtime.interrupt(this.#workId);
  }
  async #requireSession(sessionId: string): Promise<void> { if (await this.#store.get(this.#workId) !== sessionId) throw new RequestError(-32005, "ACP session does not belong to this Work"); }
  async #projectTrace(sessionId: string, event: TraceEvent): Promise<void> {
    let update: Parameters<AgentSideConnection["sessionUpdate"]>[0]["update"] | undefined;
    if (event.type === "message.user" || event.type === "message.agent") update = { sessionUpdate: event.type === "message.user" ? "user_message_chunk" : "agent_message_chunk", content: { type: "text", text: String((event.payload as { text?: string }).text ?? "") } };
    else if (event.type === "tool.execution") update = toolUpdate(event);
    if (update) await this.#connection.sessionUpdate({ sessionId, update });
  }
}

function toolUpdate(event: TraceEvent): Parameters<AgentSideConnection["sessionUpdate"]>[0]["update"] | undefined {
  const payload = event.payload as { phase?: string; name?: string; isError?: boolean; providerEventId?: string };
  if (!payload.providerEventId || !payload.name) return undefined;
  if (payload.phase === "start") return { sessionUpdate: "tool_call", toolCallId: payload.providerEventId, title: payload.name, status: "in_progress", kind: "other" };
  if (payload.phase === "end") return { sessionUpdate: "tool_call_update", toolCallId: payload.providerEventId, status: payload.isError ? "failed" : "completed" };
  return undefined;
}
